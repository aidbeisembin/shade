//! Замер схем распознавания на настоящей встрече (вручную, `#[ignore]`).
//!
//! Запуск (звук и текст встречи только локально, в репозиторий и в отчёт идут одни цифры):
//! ```text
//! SHADE_BENCH_DIR=/tmp/shade-measure \
//! SHADE_BENCH_PARAKEET=~/Library/Application\ Support/io.github.katanana23.shade/models \
//! CMAKE_DISABLE_FIND_PACKAGE_OpenSSL=TRUE \
//! cargo test --release -p meetily --lib quality_bench::bench_real_meeting -- --ignored --nocapture
//! ```
//! В `SHADE_BENCH_DIR`: `meeting/audio.mp4`, `meeting/transcripts.json` (живое распознавание
//! Parakeet из настоящей записи), `models/ggml-large-v3-turbo-q5_0.bin`. Результат по репликам
//! пишется в `SHADE_BENCH_DIR/out/*.json` (локально), на экран идут только цифры.
//!
//! Схемы: А это живой текст Parakeet с чисткой; Б это Whisper на всей встрече с языком
//! `ru` (с подсказкой-словарём и без неё); В это живой текст Parakeet, у которого
//! подозрительные реплики перераспознаны Whisper по их времени в звуке.

use super::transcript_quality::*;
use crate::audio::decoder::decode_audio_file;
use crate::audio::vad::get_speech_chunks_with_progress;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Seg {
    start: f64,
    end: f64,
    text: String,
}

#[derive(Default)]
struct Cpu;

impl Cpu {
    fn new() -> Self {
        Cpu
    }
    /// (процессорное время процесса в секундах, память в МБ) через `ps`
    fn read(&mut self) -> (f64, f64) {
        let out = std::process::Command::new("ps")
            .args(["-o", "time=,rss=", "-p", &std::process::id().to_string()])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        let mut it = text.split_whitespace();
        let time = it.next().unwrap_or("0:00.00");
        let rss: f64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
        // [[ч:]м:]с.сотые
        let secs = time.split(':').fold(0.0, |acc, part| acc * 60.0 + part.parse::<f64>().unwrap_or(0.0));
        (secs, rss / 1024.0)
    }
}

fn load_live(dir: &PathBuf) -> Vec<Seg> {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("meeting/transcripts.json")).unwrap()).unwrap();
    v["segments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| Seg {
            start: s["audio_start_time"].as_f64().unwrap_or(0.0),
            end: s["audio_end_time"].as_f64().unwrap_or(0.0),
            text: s["text"].as_str().unwrap_or("").to_string(),
        })
        .collect()
}

#[derive(Default, Debug)]
struct Stats {
    total: usize,
    foreign: usize,
    unk: usize,
    nonsense: usize,
    union_bad: usize,
    kept: usize,
    kept_nonsense: usize,
    dropped: usize,
    dropped_secs: f64,
    words_kept: usize,
}

/// Считает по сырому тексту (до чистки) и по тому, что останется в тексте встречи.
fn stats(segs: &[Seg], policy: &MeetingLang, dict: &HashSet<String>) -> Stats {
    let mut s = Stats::default();
    for g in segs {
        if g.text.trim().is_empty() {
            continue;
        }
        s.total += 1;
        let raw_unk = g.text.to_lowercase().contains("<unk>");
        let v = check(&g.text, policy, dict, None);
        let foreign = v.reasons.contains(&Reason::Language);
        let nonsense = v.reasons.contains(&Reason::ShortNonsense);
        if foreign {
            s.foreign += 1;
        }
        if raw_unk {
            s.unk += 1;
        }
        if nonsense {
            s.nonsense += 1;
        }
        if foreign || raw_unk || nonsense {
            s.union_bad += 1;
        }
        if v.keep {
            s.kept += 1;
            s.words_kept += v.words;
            if nonsense {
                s.kept_nonsense += 1;
            }
        } else {
            s.dropped += 1;
            s.dropped_secs += g.end - g.start;
        }
    }
    s
}

fn pct(a: usize, b: usize) -> String {
    if b == 0 {
        "0.0%".into()
    } else {
        format!("{:.1}%", a as f64 * 100.0 / b as f64)
    }
}

fn print_stats(name: &str, s: &Stats) {
    println!(
        "[{name}] реплик {} | не тот язык {} ({}) | <unk> {} ({}) | бессмыслица 1-3 слова {} ({}) | мусор вместе {} ({}) | остаётся в тексте {} (из них бессмыслица {}, {}) | отброшено {} ({:.0} с) | слов в тексте {}",
        s.total,
        s.foreign,
        pct(s.foreign, s.total),
        s.unk,
        pct(s.unk, s.total),
        s.nonsense,
        pct(s.nonsense, s.total),
        s.union_bad,
        pct(s.union_bad, s.total),
        s.kept,
        s.kept_nonsense,
        pct(s.kept_nonsense, s.kept),
        s.dropped,
        s.dropped_secs,
        s.words_kept
    );
}

/// Термины для счёта англицизмов: (имя, строгая запись, широкая запись).
/// Строгая это правильное написание, широкая находит любое упоминание, в том числе ошибочное.
fn terms() -> Vec<(&'static str, Regex, Regex)> {
    let mk = |n: &'static str, strict: &str, loose: &str| (n, Regex::new(strict).unwrap(), Regex::new(loose).unwrap());
    vec![
        mk("PR", r"\bPRs?\b|[Pp]ull [Rr]equest", r"(?i)\bPRs?\b|pull request|пулл?-?реквест\w*|\bпи-?эр\w*"),
        mk("пуш", r"(?i)\bпуш\w*", r"(?i)\bпуш\w*|\bpush\w*"),
        mk("бизнес-эффект", r"(?i)бизнес-эффект\w*", r"(?i)бизнес[- ]?эффект\w*|бизнес[- ]?эфект\w*"),
        mk("Figma", r"\bFigma\b", r"(?i)\bfigma\b|фигм\w*|фигма"),
        mk("GitHub", r"\bGitHub\b", r"(?i)\bgit-?hub\b|гит-?хаб\w*"),
        mk("Slack", r"\bSlack\b", r"(?i)\bslack\b|слак\w*|слэк\w*"),
        mk("Jira", r"\bJira\b", r"(?i)\bjira\b|джир\w+"),
        mk("API", r"\bAPI\b", r"(?i)\bapi\b|\bапи\b|\bэйпиай\b"),
    ]
}

fn term_counts(text: &str) -> Vec<(usize, usize)> {
    terms()
        .iter()
        .map(|(_, strict, loose)| (strict.find_iter(text).count(), loose.find_iter(text).count()))
        .collect()
}

fn join_text(segs: &[Seg], policy: &MeetingLang, dict: &HashSet<String>, dict_words: &[String]) -> String {
    segs.iter()
        .filter_map(|g| {
            let v = check(&g.text, policy, dict, None);
            if v.keep {
                Some(apply_dictionary_case(&v.text, dict_words))
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn overlap(a: &Seg, b: &Seg) -> f64 {
    (a.end.min(b.end) - a.start.max(b.start)).max(0.0)
}

async fn run_whisper(
    wh: &crate::whisper_engine::WhisperEngine,
    chunks: &[(f64, f64, Vec<f32>)],
    label: &str,
    prompt: Option<String>,
    audio_secs: f64,
) -> Vec<Seg> {
    let mut cpu = Cpu::new();
    let (c0, _) = cpu.read();
    let t0 = Instant::now();
    let mut out: Vec<Seg> = Vec::new();
    let mut peak = 0.0f64;
    for (st, en, data) in chunks {
        if data.len() < 1600 {
            continue;
        }
        let (text, _, _) = wh
            .transcribe_audio_with_prompt(data.clone(), Some("ru".into()), prompt.clone())
            .await
            .unwrap_or_default();
        out.push(Seg { start: *st, end: *en, text });
        peak = peak.max(cpu.read().1);
    }
    let wall = t0.elapsed().as_secs_f64();
    let (c1, _) = cpu.read();
    println!(
        "Whisper {label}: {:.1} с на {:.1} мин = {:.1} с/мин, процессор {:.1} с (равно {:.0}% ядра при записи в темпе звука), память до {:.0} МБ",
        wall,
        audio_secs / 60.0,
        wall / (audio_secs / 60.0),
        c1 - c0,
        (c1 - c0) / audio_secs * 100.0,
        peak
    );
    out
}

#[tokio::test]
#[ignore]
async fn bench_real_meeting() {
    let dir = PathBuf::from(std::env::var("SHADE_BENCH_DIR").expect("SHADE_BENCH_DIR"));
    let parakeet_models = PathBuf::from(std::env::var("SHADE_BENCH_PARAKEET").expect("SHADE_BENCH_PARAKEET"));
    std::fs::create_dir_all(dir.join("out")).unwrap();
    let policy = MeetingLang::RuMixed;
    // Словарь замера: общие англицизмы из задачи, не слова владельца
    let dict_words: Vec<String> = ["PR", "push", "Figma", "GitHub", "Slack", "Jira", "API", "бизнес-эффект"].iter().map(|s| s.to_string()).collect();
    let dict = dictionary_set(&dict_words);
    let prompt = build_initial_prompt(&dict_words, &policy);
    let mut cpu = Cpu::new();

    // ---- звук ----
    let decoded = decode_audio_file(&dir.join("meeting/audio.mp4")).unwrap();
    let audio_secs = decoded.duration_seconds;
    let samples = decoded.to_whisper_format();
    println!("звук: {:.1} мин ({:.0} с)", audio_secs / 60.0, audio_secs);
    let vad = get_speech_chunks_with_progress(&samples, 2000, |_, _| true).unwrap();
    let mut chunks: Vec<(f64, f64, Vec<f32>)> = Vec::new();
    for s in &vad {
        if s.samples.len() > 25 * 16000 {
            for sub in crate::audio::common::split_segment_at_silence(s, 25 * 16000) {
                chunks.push((sub.start_timestamp_ms / 1000.0, sub.end_timestamp_ms / 1000.0, sub.samples));
            }
        } else {
            chunks.push((s.start_timestamp_ms / 1000.0, s.end_timestamp_ms / 1000.0, s.samples.clone()));
        }
    }
    println!("кусков речи после VAD: {}", chunks.len());

    // ---- А: живой Parakeet (настоящая запись владельца) ----
    let live = load_live(&dir);
    let live_stats = stats(&live, &MeetingLang::Auto, &dict);
    print_stats("сейчас (без чистки)", &live_stats);
    let a_stats = stats(&live, &policy, &dict);
    print_stats("А: Parakeet + чистка", &a_stats);

    // ---- Parakeet на тех же кусках: время и нагрузка ----
    let pk = crate::parakeet_engine::ParakeetEngine::new_with_models_dir(Some(parakeet_models)).unwrap();
    pk.discover_models().await.unwrap();
    pk.load_model("parakeet-tdt-0.6b-v3-int8").await.expect("модель Parakeet");
    let (c0, _) = cpu.read();
    let t0 = Instant::now();
    let mut pk_segs: Vec<Seg> = Vec::new();
    let mut peak_mb = 0.0f64;
    for (st, en, data) in &chunks {
        if data.len() < 1600 {
            continue;
        }
        let text = pk.transcribe_audio(data.clone()).await.unwrap_or_default();
        pk_segs.push(Seg { start: *st, end: *en, text });
        peak_mb = peak_mb.max(cpu.read().1);
    }
    let pk_wall = t0.elapsed().as_secs_f64();
    let (c1, _) = cpu.read();
    let pk_cpu = c1 - c0;
    println!(
        "Parakeet: {:.1} с на {:.1} мин звука = {:.1} с/мин, процессор {:.1} с (равно {:.0}% одного ядра при записи в темпе звука), память до {:.0} МБ",
        pk_wall,
        audio_secs / 60.0,
        pk_wall / (audio_secs / 60.0),
        pk_cpu,
        pk_cpu / audio_secs * 100.0,
        peak_mb
    );
    print_stats("Parakeet на кусках VAD (сырой)", &stats(&pk_segs, &MeetingLang::Auto, &dict));
    print_stats("Parakeet на кусках VAD + чистка", &stats(&pk_segs, &policy, &dict));
    pk.unload_model().await;
    std::fs::write(dir.join("out/parakeet-rerun.json"), serde_json::to_string(&pk_segs).unwrap()).unwrap();

    // ---- Whisper ----
    let wh = crate::whisper_engine::WhisperEngine::new_with_models_dir(Some(dir.join("models"))).unwrap();
    wh.discover_models().await.unwrap();
    wh.load_model("large-v3-turbo-q5_0").await.expect("модель Whisper");

    let b_noprompt = run_whisper(&wh, &chunks, "без подсказки", None, audio_secs).await;
    let b_prompt = run_whisper(&wh, &chunks, "с подсказкой", prompt.clone(), audio_secs).await;
    for (n, segs) in [("Б: Whisper ru без подсказки", &b_noprompt), ("Б: Whisper ru + словарь", &b_prompt)] {
        let cleaned: Vec<Seg> = segs.iter().filter(|g| !is_known_hallucination(&g.text)).cloned().collect();
        println!("  галлюцинаций Whisper отброшено: {}", segs.len() - cleaned.len());
        print_stats(n, &stats(&cleaned, &policy, &dict));
    }
    std::fs::write(dir.join("out/whisper-ru.json"), serde_json::to_string(&b_noprompt).unwrap()).unwrap();
    std::fs::write(dir.join("out/whisper-ru-prompt.json"), serde_json::to_string(&b_prompt).unwrap()).unwrap();

    // ---- В: гибрид по живым репликам ----
    let mut suspicious: Vec<usize> = Vec::new();
    for (i, g) in live.iter().enumerate() {
        let v = check(&g.text, &policy, &dict, None);
        if !v.reasons.is_empty() {
            suspicious.push(i);
        }
    }
    let sus_secs: f64 = suspicious.iter().map(|&i| live[i].end - live[i].start + 0.6).sum();
    println!("В: подозрительных реплик {} из {} ({}), звука в них {:.0} с ({:.1}% встречи)", suspicious.len(), live.len(), pct(suspicious.len(), live.len()), sus_secs, sus_secs / audio_secs * 100.0);
    let (c0, _) = cpu.read();
    let t0 = Instant::now();
    let mut hybrid = live.clone();
    let mut replaced = 0usize;
    let mut emptied = 0usize;
    for &i in &suspicious {
        let g = &live[i];
        let a = ((g.start - 0.3).max(0.0) * 16000.0) as usize;
        let b = (((g.end + 0.3) * 16000.0) as usize).min(samples.len());
        if b <= a + 1600 {
            continue;
        }
        let (text, _, _) = wh
            .transcribe_audio_with_prompt(samples[a..b].to_vec(), Some("ru".into()), prompt.clone())
            .await
            .unwrap_or_default();
        if is_known_hallucination(&text) {
            continue;
        }
        let v = check(&text, &policy, &dict, None);
        if v.keep && !v.text.is_empty() {
            hybrid[i].text = text;
            replaced += 1;
        } else if text.trim().is_empty() {
            emptied += 1;
        }
    }
    let h_wall = t0.elapsed().as_secs_f64();
    let (c1, _) = cpu.read();
    println!(
        "В: второй проход Whisper {:.1} с ({:.2} с на минуту встречи), процессор {:.1} с; заменено {} реплик, Whisper вернул пусто {}",
        h_wall,
        h_wall / (audio_secs / 60.0),
        c1 - c0,
        replaced,
        emptied
    );
    print_stats("В: гибрид", &stats(&hybrid, &policy, &dict));
    std::fs::write(dir.join("out/hybrid.json"), serde_json::to_string(&hybrid).unwrap()).unwrap();

    // ---- Потеря содержания в А: отброшенные реплики, на месте которых Whisper услышал русский текст ----
    let b_ok: Vec<Seg> = b_prompt.iter().filter(|g| !is_known_hallucination(&g.text) && check(&g.text, &policy, &dict, None).keep).cloned().collect();
    let mut lost = 0usize;
    let mut lost_words = 0usize;
    let mut a_dropped = 0usize;
    for g in &live {
        let v = check(&g.text, &policy, &dict, None);
        if v.keep || g.text.trim().is_empty() {
            continue;
        }
        a_dropped += 1;
        let covered: Vec<&Seg> = b_ok.iter().filter(|b| overlap(g, b) > 0.5 * (g.end - g.start).max(0.3)).collect();
        let w: usize = covered.iter().map(|b| word_count(&b.text)).sum();
        if w >= 4 {
            lost += 1;
            lost_words += w;
        }
    }
    println!("А: отброшено {a_dropped} реплик; на месте {lost} из них Whisper услышал русскую речь (≥4 слов, всего {lost_words} слов): чистка А теряет это содержание");

    // ---- Англицизмы ----
    let schemes: Vec<(&str, String)> = vec![
        ("сейчас (Parakeet)", join_text(&live, &MeetingLang::Auto, &dict, &[])),
        ("А: Parakeet + чистка", join_text(&live, &policy, &dict, &dict_words)),
        ("Б: Whisper ru без подсказки", join_text(&b_noprompt, &policy, &dict, &dict_words)),
        ("Б: Whisper ru + словарь", join_text(&b_prompt, &policy, &dict, &dict_words)),
        ("В: гибрид", join_text(&hybrid, &policy, &dict, &dict_words)),
    ];
    let names: Vec<&str> = terms().iter().map(|t| t.0).collect();
    let all_counts: Vec<Vec<(usize, usize)>> = schemes.iter().map(|(_, t)| term_counts(t)).collect();
    // Знаменатель: наибольшее число упоминаний термина в любой из схем (широкая запись)
    println!("Англицизмы: правильно записано / найдено упоминаний (знаменатель общий: максимум упоминаний по схемам)");
    let mut denom_total = 0usize;
    let mut denoms = Vec::new();
    for (ti, n) in names.iter().enumerate() {
        let d = all_counts.iter().map(|c| c[ti].1).max().unwrap_or(0);
        denom_total += d;
        denoms.push(d);
        println!("  термин {n}: упоминаний (макс.) {d}");
    }
    for (si, (n, _)) in schemes.iter().enumerate() {
        let strict: usize = all_counts[si].iter().map(|c| c.0).sum();
        let loose: usize = all_counts[si].iter().map(|c| c.1).sum();
        println!("  [{n}] правильно {strict}, найдено {loose}, из общего числа {denom_total}");
        for (ti, nm) in names.iter().enumerate() {
            if denoms[ti] > 0 {
                println!("      {nm}: правильно {} из {}", all_counts[si][ti].0, denoms[ti]);
            }
        }
    }
    // Сводка слов
    for (n, t) in &schemes {
        println!("[{n}] слов {} символов {}", t.split_whitespace().count(), t.chars().count());
    }
    let _ = (c1, Cpu::default());
}


/// Whisper с `ru` и словарём на границах живых реплик (как работал бы вживую: те же куски,
/// что режет живой детектор речи). Результат: `out/whisper-live-ranges.json`.
#[tokio::test]
#[ignore]
async fn bench_whisper_live_ranges() {
    let dir = PathBuf::from(std::env::var("SHADE_BENCH_DIR").expect("SHADE_BENCH_DIR"));
    let policy = MeetingLang::RuMixed;
    let dict_words: Vec<String> = ["PR", "push", "Figma", "GitHub", "Slack", "Jira", "API", "бизнес-эффект"].iter().map(|s| s.to_string()).collect();
    let dict = dictionary_set(&dict_words);
    let prompt = build_initial_prompt(&dict_words, &policy);
    let decoded = decode_audio_file(&dir.join("meeting/audio.mp4")).unwrap();
    let audio_secs = decoded.duration_seconds;
    let samples = decoded.to_whisper_format();
    let live = load_live(&dir);
    let wh = crate::whisper_engine::WhisperEngine::new_with_models_dir(Some(dir.join("models"))).unwrap();
    wh.discover_models().await.unwrap();
    wh.load_model("large-v3-turbo-q5_0").await.expect("модель Whisper");
    let mut cpu = Cpu::new();
    let (c0, _) = cpu.read();
    let t0 = Instant::now();
    let mut out = Vec::new();
    let mut peak = 0.0f64;
    for g in &live {
        let a = ((g.start - 0.3).max(0.0) * 16000.0) as usize;
        let b = (((g.end + 0.3) * 16000.0) as usize).min(samples.len());
        if b <= a + 1600 {
            out.push(Seg { start: g.start, end: g.end, text: String::new() });
            continue;
        }
        let (text, _, _) = wh
            .transcribe_audio_with_prompt(samples[a..b].to_vec(), Some("ru".into()), prompt.clone())
            .await
            .unwrap_or_default();
        out.push(Seg { start: g.start, end: g.end, text });
        peak = peak.max(cpu.read().1);
    }
    let wall = t0.elapsed().as_secs_f64();
    let (c1, _) = cpu.read();
    println!(
        "Whisper ru + словарь на границах живых реплик ({} шт.): {:.1} с на {:.1} мин = {:.1} с/мин, доля времени работы при записи в темпе звука {:.0}%, процессор {:.1} с, память до {:.0} МБ",
        live.len(),
        wall,
        audio_secs / 60.0,
        wall / (audio_secs / 60.0),
        wall / audio_secs * 100.0,
        c1 - c0,
        peak
    );
    std::fs::write(dir.join("out/whisper-live-ranges.json"), serde_json::to_string(&out).unwrap()).unwrap();
    let cleaned: Vec<Seg> = out.iter().filter(|g| !is_known_hallucination(&g.text)).cloned().collect();
    println!("  галлюцинаций отброшено: {}", out.len() - cleaned.len());
    print_stats("Б на живых границах: Whisper ru + словарь", &stats(&cleaned, &policy, &dict));
}

fn load_out(dir: &PathBuf, name: &str) -> Option<Vec<Seg>> {
    serde_json::from_str(&std::fs::read_to_string(dir.join("out").join(name)).ok()?).ok()
}

/// Слова Whisper в промежутке [a, b] пропорционально перекрытию (длинный кусок не раздувает счёт).
fn words_in(range: &Seg, other: &[Seg]) -> f64 {
    other
        .iter()
        .map(|o| {
            let len = (o.end - o.start).max(0.1);
            word_count(&o.text) as f64 * overlap(range, o) / len
        })
        .sum()
}

/// Разбор сохранённых результатов замера (быстро, без движков): потеря содержания в схеме А,
/// разбор «не того языка» по языкам, англицизмы.
#[test]
#[ignore]
fn bench_analyze() {
    let dir = PathBuf::from(std::env::var("SHADE_BENCH_DIR").expect("SHADE_BENCH_DIR"));
    let policy = MeetingLang::RuMixed;
    let dict_words: Vec<String> = ["PR", "push", "Figma", "GitHub", "Slack", "Jira", "API", "бизнес-эффект"].iter().map(|s| s.to_string()).collect();
    let dict = dictionary_set(&dict_words);
    let live = load_live(&dir);
    let b_prompt = load_out(&dir, "whisper-ru-prompt.json").unwrap();

    // Разбор чужих языков в живом тексте
    let (mut pl, mut en_short, mut en_long, mut latin_other, mut other) = (0, 0, 0, 0, 0);
    for g in &live {
        let v = check(&g.text, &policy, &dict, None);
        if !v.reasons.contains(&Reason::Language) {
            continue;
        }
        match v.lang {
            Lang::Pl => pl += 1,
            Lang::En if v.words < EN_KEEP_MIN_WORDS => en_short += 1,
            Lang::En => en_long += 1,
            Lang::LatinOther => latin_other += 1,
            _ => other += 1,
        }
    }
    println!("Не тот язык в живом тексте: польский {pl}, английский короче {EN_KEEP_MIN_WORDS} слов {en_short}, английский длиннее {en_long}, латиница без языка {latin_other}, другое {other}");

    // Потеря содержания в А: отброшенные реплики и сколько русских слов Whisper услышал на их месте
    let b_ok: Vec<Seg> = b_prompt.iter().filter(|g| !is_known_hallucination(&g.text)).cloned().collect();
    let (mut dropped, mut dropped_secs, mut lost_words, mut lost_reps) = (0usize, 0.0f64, 0.0f64, 0usize);
    let mut dropped_words = 0usize;
    for g in &live {
        let v = check(&g.text, &policy, &dict, None);
        if v.keep || g.text.trim().is_empty() {
            continue;
        }
        dropped += 1;
        dropped_secs += g.end - g.start;
        dropped_words += v.words;
        let w = words_in(g, &b_ok);
        lost_words += w;
        if w >= 4.0 {
            lost_reps += 1;
        }
    }
    let total_words: usize = live.iter().map(|g| word_count(&strip_special(&g.text).text)).sum();
    println!(
        "А: отброшено {dropped} реплик ({dropped_secs:.0} с звука, {dropped_words} слов из {total_words}); Whisper на этом звуке услышал примерно {lost_words:.0} слов речи, в {lost_reps} репликах не меньше 4 слов: столько содержания А выбрасывает вместе с чужим языком"
    );

    // Англицизмы по схемам на тех же файлах результатов
    let schemes: Vec<(&str, Vec<Seg>, MeetingLang, Vec<String>)> = vec![
        ("сейчас (Parakeet живой)", live.clone(), MeetingLang::Auto, vec![]),
        ("А: Parakeet + чистка", live.clone(), policy.clone(), dict_words.clone()),
        ("Б: Whisper ru без подсказки (по VAD встречи)", load_out(&dir, "whisper-ru.json").unwrap_or_default(), policy.clone(), dict_words.clone()),
        ("Б: Whisper ru + словарь (по VAD встречи)", b_ok.clone(), policy.clone(), dict_words.clone()),
        ("Б: Whisper ru + словарь (на живых границах)", load_out(&dir, "whisper-live-ranges.json").unwrap_or_default(), policy.clone(), dict_words.clone()),
        ("В: гибрид", load_out(&dir, "hybrid.json").unwrap_or_default(), policy.clone(), dict_words.clone()),
    ];
    let counts: Vec<Vec<(usize, usize)>> = schemes.iter().map(|(_, segs, p, d)| term_counts(&join_text(segs, p, &dict, d))).collect();
    let names: Vec<&str> = terms().iter().map(|t| t.0).collect();
    let denom: usize = (0..names.len()).map(|ti| counts.iter().map(|c| c[ti].1).max().unwrap_or(0)).sum();
    for (si, (n, ..)) in schemes.iter().enumerate() {
        let strict: usize = counts[si].iter().map(|c| c.0).sum();
        let loose: usize = counts[si].iter().map(|c| c.1).sum();
        println!("Англицизмы [{n}]: правильно {strict}, найдено любым написанием {loose}, из {denom} упоминаний");
    }

    // Сколько латинских слов осталось внутри русского текста (англицизмы вообще)
    let latin = Regex::new(r"[A-Za-z][A-Za-z'-]+").unwrap();
    for (name, segs) in [
        ("сейчас (Parakeet)", live.clone()),
        ("Б: Whisper ru + словарь", b_ok.clone()),
        ("Б на живых границах", load_out(&dir, "whisper-live-ranges.json").unwrap_or_default()),
        ("В: гибрид", load_out(&dir, "hybrid.json").unwrap_or_default()),
    ] {
        let text = join_text(&segs, &policy, &dict, &dict_words);
        let n = latin.find_iter(&text).count();
        let words = text.split_whitespace().count();
        println!("[{name}] латинских слов в тексте {n} из {words}");
    }
}
