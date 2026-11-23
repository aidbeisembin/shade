//! Замер нарезки живой записи на куски (вручную, `#[ignore]`), Shade 2026-11-22.
//!
//! Запуск (звук и тексты только локально, на экран идут одни цифры):
//! ```text
//! SHADE_VAD_BENCH_DIR=/tmp/shade-vad-bench \
//! SHADE_BENCH_PARAKEET=~/Library/Application\ Support/com.aidbeisembin.shade/models \
//! CMAKE_DISABLE_FIND_PACKAGE_OpenSSL=TRUE \
//! cargo test -p shade --lib vad_bench::bench_live_pieces -- --ignored --nocapture
//! ```
//! Без `--release`: зависимости и так собраны с `opt-level = 3` (корневой `Cargo.toml`), а
//! release-сборка proc-macro `sqlx-macros` на macOS 27 даёт битую библиотеку (22.11.2026).
//! В `SHADE_VAD_BENCH_DIR`: `audio/<имя>.wav` (16 кГц моно) и `ref/<имя>.txt` (что
//! сказано). Звук без эталона (шум) проверяется только на число кусков. Распознанный текст
//! пишется в `SHADE_VAD_BENCH_DIR/out/` (локально).
//!
//! Живой путь повторён как в `pipeline.rs`: звук окнами по 50 мс, куски короче 800 отсчётов
//! отбрасываются, один распознаватель берёт куски по очереди. «Первый текст» — момент, когда
//! первый непустой кусок распознан, в секундах от начала записи.

use crate::audio::decoder::decode_audio_file;
use crate::audio::vad::{ContinuousVadProcessor, LiveLimits};
use std::path::PathBuf;
use std::time::Instant;

const SR: usize = 16_000;

/// Вариант нарезки. `pad_ms` и `overlap_ms` применяются только к принудительным стыкам и
/// только здесь, в замере: так проверяется, нужен ли нахлёст или тишина по краям.
#[derive(Clone, Copy)]
struct Variant {
    name: &'static str,
    limits: Option<LiveLimits>,
    pad_ms: usize,
    overlap_ms: usize,
}

struct Piece {
    start_ms: f64,
    end_ms: f64,
    emitted_at_s: f64,
    samples: Vec<f32>,
}

fn run_vad(audio: &[f32], limits: Option<LiveLimits>) -> Vec<Piece> {
    let mut vad = ContinuousVadProcessor::new(SR as u32, 500).unwrap();
    if let Some(l) = limits {
        vad = vad.with_live_limits(l);
    }
    let mut out = Vec::new();
    let mut fed = 0usize;
    for window in audio.chunks(800) {
        fed += window.len();
        for s in vad.process_audio(window).unwrap() {
            out.push(Piece { start_ms: s.start_timestamp_ms, end_ms: s.end_timestamp_ms, emitted_at_s: fed as f64 / SR as f64, samples: s.samples });
        }
    }
    for s in vad.flush().unwrap() {
        out.push(Piece { start_ms: s.start_timestamp_ms, end_ms: s.end_timestamp_ms, emitted_at_s: fed as f64 / SR as f64, samples: s.samples });
    }
    out.retain(|p| p.samples.len() >= 800);
    out
}

fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .replace('ё', "е")
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

/// Доля расхождений по словам (WER): замены, пропуски и вставки на число слов эталона.
fn wer(reference: &[String], hypothesis: &[String]) -> f64 {
    let (n, m) = (reference.len(), hypothesis.len());
    let mut prev: Vec<usize> = (0..=m).collect();
    for i in 1..=n {
        let mut cur = vec![i; m + 1];
        for j in 1..=m {
            let sub = prev[j - 1] + usize::from(reference[i - 1] != hypothesis[j - 1]);
            cur[j] = sub.min(prev[j] + 1).min(cur[j - 1] + 1);
        }
        prev = cur;
    }
    prev[m] as f64 / n.max(1) as f64
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx]
}

struct Result {
    pieces: usize,
    median_s: f64,
    p90_s: f64,
    max_s: f64,
    words: usize,
    wer_ref: Option<f64>,
    first_text_s: Option<f64>,
    max_wait_s: f64,
    empty_pieces: usize,
    text: String,
    asr_s: f64,
}

async fn measure(
    pk: &crate::parakeet_engine::ParakeetEngine,
    audio: &[f32],
    reference: Option<&[String]>,
    v: Variant,
) -> Result {
    let pieces = run_vad(audio, v.limits);
    let mut lengths: Vec<f64> = pieces.iter().map(|p| (p.end_ms - p.start_ms) / 1000.0).collect();
    lengths.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut texts = Vec::new();
    let mut busy_until = 0.0f64;
    let mut ready_times = Vec::new();
    let mut first_text_s = None;
    let mut empty = 0;
    let mut asr_total = 0.0;
    for (i, p) in pieces.iter().enumerate() {
        let forced_start = i > 0 && pieces[i - 1].end_ms == p.start_ms;
        let forced_end = pieces.get(i + 1).is_some_and(|n| n.start_ms == p.end_ms);
        let mut data = Vec::new();
        // Нахлёст: кусок начинается раньше стыка, звук берётся из исходной записи
        if forced_start && v.overlap_ms > 0 {
            let from = ((p.start_ms - v.overlap_ms as f64).max(0.0) * 16.0) as usize;
            let to = (p.start_ms * 16.0) as usize;
            data.extend_from_slice(&audio[from..to.min(audio.len())]);
        }
        if forced_start && v.pad_ms > 0 {
            data.extend(std::iter::repeat(0.0).take(v.pad_ms * 16));
        }
        data.extend_from_slice(&p.samples);
        if forced_end && v.pad_ms > 0 {
            data.extend(std::iter::repeat(0.0).take(v.pad_ms * 16));
        }
        let t0 = Instant::now();
        let text = pk.transcribe_audio(data).await.unwrap_or_default();
        let asr = t0.elapsed().as_secs_f64();
        asr_total += asr;
        let start = busy_until.max(p.emitted_at_s);
        busy_until = start + asr;
        if text.trim().is_empty() {
            empty += 1;
        } else {
            ready_times.push(busy_until);
            if first_text_s.is_none() {
                first_text_s = Some(busy_until);
            }
        }
        texts.push(text);
    }
    // «‖» отмечает стык кусков в файле с текстом; для подсчёта слов это не буква
    let text = texts.join(" ‖ ");
    let hyp = words(&text);
    let speech_start = pieces.first().map(|p| p.start_ms / 1000.0).unwrap_or(0.0);
    let mut max_wait = 0.0f64;
    let mut last = speech_start;
    for t in &ready_times {
        max_wait = max_wait.max(t - last);
        last = *t;
    }
    Result {
        pieces: pieces.len(),
        median_s: percentile(&lengths, 0.5),
        p90_s: percentile(&lengths, 0.9),
        max_s: lengths.last().copied().unwrap_or(0.0),
        words: hyp.len(),
        wer_ref: reference.map(|r| wer(r, &hyp)),
        first_text_s,
        max_wait_s: max_wait,
        empty_pieces: empty,
        text,
        asr_s: asr_total,
    }
}

fn variants() -> Vec<Variant> {
    let d = LiveLimits::DEFAULT;
    let v = |name, limits| Variant { name, limits: Some(limits), pad_ms: 0, overlap_ms: 0 };
    let mut list = vec![Variant { name: "до (только пауза)", limits: None, pad_ms: 0, overlap_ms: 0 }];
    let set = std::env::var("SHADE_VAD_BENCH_SET").unwrap_or_default();
    // Прогоны 1 и 2 (досрочный разрез по провалу громкости: первый тихий кадр, затем тихо
    // ≥ 60/90/120 мс; тишина 300 мс по краям; нахлёст 250 мс) мерили прежние версии
    // `choose_cut`, их цифры в PR. Здесь остались окно поиска («windows») и итог.
    if set == "pad-overlap" {
        // Стык: тишина по краям и нахлёст, только в замере
        list.push(Variant { name: "после + тишина 300 мс по краям", limits: Some(d), pad_ms: 300, overlap_ms: 0 });
        list.push(Variant { name: "после + нахлёст 250 мс", limits: Some(d), pad_ms: 0, overlap_ms: 250 });
    } else if set == "windows" {
        // Третий прогон: окно поиска самого тихого места к 8 с
        let q = |soft_ms, hard_ms| LiveLimits { soft_ms, hard_ms, cut_at_first_gap: false, ..d };
        list.push(v("4/8, самое тихое к 8 с", q(4_000, 8_000)));
        list.push(v("5/8, самое тихое к 8 с", q(5_000, 8_000)));
        list.push(v("6/8, самое тихое к 8 с", q(6_000, 8_000)));
        list.push(v("5/8 + микропаузы ≥ 150 мс", LiveLimits { soft_ms: 5_000, ..d }));
    } else {
        // Итог: как в приложении
        list.push(v("после (LiveLimits::DEFAULT)", d));
    }
    list
}

#[tokio::test]
#[ignore]
async fn bench_live_pieces() {
    let dir = PathBuf::from(std::env::var("SHADE_VAD_BENCH_DIR").expect("SHADE_VAD_BENCH_DIR"));
    let models = PathBuf::from(std::env::var("SHADE_BENCH_PARAKEET").expect("SHADE_BENCH_PARAKEET"));
    std::fs::create_dir_all(dir.join("out")).unwrap();
    let pk = crate::parakeet_engine::ParakeetEngine::new_with_models_dir(Some(models)).unwrap();
    pk.discover_models().await.unwrap();
    pk.load_model("parakeet-tdt-0.6b-v3-int8").await.expect("модель Parakeet");

    let mut names: Vec<String> = std::fs::read_dir(dir.join("audio"))
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.ends_with(".wav"))
        .map(|n| n.trim_end_matches(".wav").to_string())
        .collect();
    names.sort();
    if let Ok(only) = std::env::var("SHADE_VAD_BENCH_ONLY") {
        names.retain(|n| only.split(',').any(|o| o == n));
    }

    println!("| запись | вариант | кусков | медиана, с | 90-й проц., с | макс., с | слов (эталон) | WER к эталону | WER к «до» | первый текст, с | дольше всего без текста, с | пустых кусков |");
    println!("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for name in &names {
        let decoded = decode_audio_file(&dir.join(format!("audio/{name}.wav"))).unwrap();
        let audio = decoded.to_whisper_format();
        let reference = std::fs::read_to_string(dir.join(format!("ref/{name}.txt"))).ok().map(|t| words(&t));
        let mut before_words: Option<Vec<String>> = None;
        for v in variants() {
            let r = measure(&pk, &audio, reference.as_deref(), v).await;
            let hyp = words(&r.text);
            let wer_before = match &before_words {
                None => {
                    before_words = Some(hyp.clone());
                    "—".to_string()
                }
                Some(b) => format!("{:.1} %", wer(b, &hyp) * 100.0),
            };
            std::fs::write(dir.join(format!("out/{name}--{}.txt", v.name.replace([' ', '/', ':', ',', '«', '»', '(', ')'], "_"))), &r.text).unwrap();
            println!(
                "| {name} ({:.0} с) | {} | {} | {:.1} | {:.1} | {:.1} | {} ({}) | {} | {} | {} | {:.1} | {} |",
                audio.len() as f64 / SR as f64,
                v.name,
                r.pieces,
                r.median_s,
                r.p90_s,
                r.max_s,
                r.words,
                reference.as_ref().map(|x| x.len().to_string()).unwrap_or("—".into()),
                r.wer_ref.map(|w| format!("{:.1} %", w * 100.0)).unwrap_or("—".into()),
                wer_before,
                r.first_text_s.map(|t| format!("{t:.1}")).unwrap_or("—".into()),
                r.max_wait_s,
                r.empty_pieces,
            );
            eprintln!("  ({name} / {}: распознавание {:.1} с)", v.name, r.asr_s);
        }
    }
    pk.unload_model().await;
}

/// Час записи через нарезку (без распознавания): растут ли память и время на окно.
/// `SHADE_VAD_BENCH_DIR/audio/<SHADE_VAD_HOUR_SOURCE>.wav` крутится по кругу 60 минут.
#[test]
#[ignore]
fn bench_hour_of_vad() {
    let dir = PathBuf::from(std::env::var("SHADE_VAD_BENCH_DIR").expect("SHADE_VAD_BENCH_DIR"));
    let source = std::env::var("SHADE_VAD_HOUR_SOURCE").unwrap_or("ru_pauses".into());
    let minutes: usize = std::env::var("SHADE_VAD_HOUR_MINUTES").ok().and_then(|m| m.parse().ok()).unwrap_or(60);
    let clip = decode_audio_file(&dir.join(format!("audio/{source}.wav"))).unwrap().to_whisper_format();
    let rss_mb = || {
        let out = std::process::Command::new("ps").args(["-o", "rss=", "-p", &std::process::id().to_string()]).output().unwrap();
        String::from_utf8_lossy(&out.stdout).trim().parse::<f64>().unwrap_or(0.0) / 1024.0
    };
    for limits in [None, Some(LiveLimits::DEFAULT)] {
        let mut vad = ContinuousVadProcessor::new(SR as u32, 500).unwrap();
        if let Some(l) = limits {
            vad = vad.with_live_limits(l);
        }
        let total = minutes * 60 * SR;
        let mut fed = 0usize;
        let mut pieces = 0usize;
        let mut minute_worst_ms = 0.0f64;
        let mut minute = 0usize;
        let rss0 = rss_mb();
        let mut line = Vec::new();
        while fed < total {
            let at = fed % clip.len();
            let end = (at + 800).min(clip.len());
            let t0 = Instant::now();
            pieces += vad.process_audio(&clip[at..end]).unwrap().len();
            minute_worst_ms = minute_worst_ms.max(t0.elapsed().as_secs_f64() * 1000.0);
            fed += end - at;
            if fed / (SR * 60) > minute {
                minute = fed / (SR * 60);
                if minute % 10 == 0 {
                    line.push(format!("{minute} мин: {:.0} МБ, худшее окно {:.1} мс", rss_mb() - rss0, minute_worst_ms));
                }
                minute_worst_ms = 0.0;
            }
        }
        pieces += vad.flush().unwrap().len();
        println!(
            "{} ({source}, {minutes} мин): кусков {pieces}; {}",
            if limits.is_some() { "после" } else { "до" },
            line.join("; ")
        );
    }
}
