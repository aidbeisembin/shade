//! Восстановление встречи после сбоя (Shade).
//!
//! Что случилось 16.11: Mac завис посреди записи. Звук лежал на диске кусками
//! (`.checkpoints/audio_chunk_NNN.mp4`), реплики в `transcripts.json`, но строка
//! встречи в базе создаётся только при «Остановить», поэтому в списке встречи не было.
//!
//! Что делает этот модуль при запуске (команда [`recover_interrupted_meetings`]):
//! 1. Ищет в папке записей папки с `metadata.json`, у которых запись не завершена
//!    (`status` не `completed` или нет `completed_at`) и которых нет в таблице `meetings`
//!    (ключ: `folder_path`).
//! 2. Проверяет каждый кусок звука декодером, склеивает годные без перекодирования
//!    (`-c copy`, как при обычной остановке) в `audio.mp4`, сверяет длительность.
//! 3. Читает реплики (в том числе из обрезанного файла), создаёт встречу с исходной
//!    датой, пишет `recovered.json` (метка «восстановлена», частично или нет) и
//!    доводит `metadata.json` до `completed`.
//! 4. Куски звука удаляет только после проверки, что итог собран, читается и сходится
//!    по длительности. При любом сомнении куски остаются, встреча помечается частичной.
//!
//! Итоги (summary) не запускаются. Ничего не спрашивается. Все шаги повторяемы:
//! повторный запуск после обрыва на любом месте не создаёт дублей и не теряет данных.

pub mod fsio;
pub mod media;
pub mod transcript;

#[cfg(test)]
mod tests;

use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use log::{info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Mutex;

/// Метка в папке встречи: встреча восстановлена после сбоя.
pub const MARK_FILE: &str = "recovered.json";
/// Сколько раз пробовать собрать звук заново, если помешало временное (нет места, нет ffmpeg).
pub const MAX_ATTEMPTS: u32 = 3;
/// Папка, в которой писали последние `FRESH_SECS` секунд, считается живой записью
/// (в том числе из второго экземпляра Shade): её не трогаем, вернёмся позже.
pub const FRESH_SECS: u64 = 60;

/// Одновременно работает только одно восстановление (двойной вызов из интерфейса, два окна).
static RUN_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

pub struct Options {
    /// Путь к ffmpeg. `None`: звук собрать нельзя, куски остаются как есть.
    pub ffmpeg: Option<PathBuf>,
    /// Не трогать папки, в которых писали позже этого срока назад.
    pub min_idle: Duration,
}

/// Метка `recovered.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mark {
    pub version: u32,
    /// `done` (всё сделано), `retry` (встреча создана, звук не собрался по временной причине,
    /// следующий запуск попробует ещё раз), `nothing` (восстанавливать нечего).
    pub state: String,
    pub meeting_id: Option<String>,
    pub recovered_at: String,
    pub partial: bool,
    pub reasons: Vec<String>,
    pub segments: usize,
    pub audio_seconds: Option<f64>,
    #[serde(default)]
    pub attempts: u32,
}

/// Что вернуть интерфейсу про восстановленную встречу.
#[derive(Debug, Clone, Serialize)]
pub struct Recovered {
    pub meeting_id: String,
    pub title: String,
    pub created_at: String,
    pub duration_seconds: Option<f64>,
    pub segments: usize,
    pub partial: bool,
    pub reasons: Vec<String>,
    pub folder: String,
}

/// Встреча, которой при каком-то из запусков дали метку «восстановлена» (для подписи в списке).
#[derive(Debug, Clone, Serialize)]
pub struct Marked {
    pub meeting_id: String,
    pub partial: bool,
    pub recovered_at: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Report {
    /// База готова (на первом запуске её ещё нет: восстанавливать некуда).
    pub ready: bool,
    /// Идёт запись: ничего не трогали.
    pub recording: bool,
    pub recovered: Vec<Recovered>,
    /// Папки, в которых писали только что: повторить позже.
    pub deferred: usize,
    /// Папки, где восстанавливать было нечего (нет ни реплик, ни звука).
    pub nothing: usize,
    /// «папка: причина» для того, что не удалось (данные на месте, следующий запуск повторит).
    pub failed: Vec<String>,
    pub marked: Vec<Marked>,
}

#[derive(Debug)]
pub enum Outcome {
    /// Не прерванная запись, уже обработана или не наша.
    Skipped,
    /// Писали недавно.
    Fresh,
    /// Нечего восстанавливать.
    Nothing,
    Recovered(Recovered),
}

// ---------------------------------------------------------------------------
// Метаданные папки

fn read_json_map(path: &Path) -> Option<Map<String, Value>> {
    let bytes = std::fs::read(path).ok()?;
    match serde_json::from_slice::<Value>(&bytes).ok()? {
        Value::Object(m) => Some(m),
        _ => None,
    }
}

fn text<'a>(meta: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    meta.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

/// `metadata.json`, затем `.metadata.json.tmp` (обрыв между записью и переименованием).
fn read_meta(folder: &Path) -> Option<Map<String, Value>> {
    read_json_map(&folder.join("metadata.json")).or_else(|| read_json_map(&fsio::temp_path(&folder.join("metadata.json"))))
}

fn is_interrupted(meta: &Map<String, Value>) -> bool {
    let completed = text(meta, "status") == Some("completed") && text(meta, "completed_at").is_some();
    !completed
}

/// Имя папки вида `Meeting 16_11_26_15_02_17_2026-11-16_10-02` → (`Meeting 16_11_26_15_02_17`, время UTC).
fn split_folder_name(name: &str) -> (String, Option<DateTime<Utc>>) {
    // хвост `_YYYY-MM-DD_HH-MM` (create_meeting_folder, UTC)
    if name.len() > 17 {
        let (head, tail) = name.split_at(name.len() - 17);
        if let Some(stamp) = tail.strip_prefix('_') {
            if let Ok(naive) = NaiveDateTime::parse_from_str(stamp, "%Y-%m-%d_%H-%M") {
                return (head.to_string(), Some(Utc.from_utc_datetime(&naive)));
            }
        }
    }
    (name.to_string(), None)
}

/// Файлы, которые пишет сама запись. Чужое в папке (ручные «(восстановлена)», наши метки)
/// не считается: иначе время «когда оборвалась запись» уехало бы на момент, когда в папку кто-то зашёл.
const RECORDING_FILES: [&str; 5] = ["metadata.json", ".metadata.json.tmp", "transcripts.json", ".transcripts.json.tmp", "audio.mp4"];

/// Время последней записи самой записью: метаданные, реплики, итоговый звук, куски и их `.part`.
fn newest_mtime(folder: &Path) -> Option<SystemTime> {
    let mut newest: Option<SystemTime> = None;
    let mut take = |path: PathBuf| {
        if let Some(m) = std::fs::metadata(&path).ok().filter(|m| m.is_file()).and_then(|m| m.modified().ok()) {
            newest = Some(newest.map_or(m, |n| n.max(m)));
        }
    };
    for name in RECORDING_FILES {
        take(folder.join(name));
    }
    if let Ok(entries) = std::fs::read_dir(folder.join(".checkpoints")) {
        for entry in entries.filter_map(|e| e.ok()) {
            take(entry.path());
        }
    }
    newest
}

pub fn read_mark(folder: &Path) -> Option<Mark> {
    serde_json::from_slice(&std::fs::read(folder.join(MARK_FILE)).ok()?).ok()
}

fn write_mark(folder: &Path, mark: &Mark) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(mark).map_err(|e| e.to_string())?;
    fsio::write_atomic(&folder.join(MARK_FILE), &json).map_err(|e| format!("recovered.json: {e}"))
}

// ---------------------------------------------------------------------------
// Звук

#[derive(Debug, Default)]
struct AudioPlan {
    /// Итоговый `audio.mp4`, если он есть и читается.
    audio: Option<PathBuf>,
    /// Длительность итогового звука.
    duration: Option<f64>,
    /// Коды причин «частично».
    reasons: Vec<String>,
    /// Причина временная (нет места, нет ffmpeg): стоит повторить при следующем запуске.
    transient: bool,
    /// Куски можно удалить: итог собран, читается, длительность сходится, битых и пропусков нет.
    safe_to_clean: bool,
    /// Есть годные куски или звук, то есть что сохранять.
    has_data: bool,
}

/// Проверить и собрать звук. Блокирующая: вызывать через `spawn_blocking`.
fn prepare_audio(folder: &Path, ffmpeg: Option<&Path>, expects_audio: bool) -> AudioPlan {
    let ckdir = folder.join(".checkpoints");
    let audio = folder.join("audio.mp4");
    let chunks = media::list_chunks(&ckdir);
    let mut plan = AudioPlan::default();

    if chunks.is_empty() && !audio.exists() {
        if expects_audio {
            plan.reasons.push("no-audio".into());
        }
        return plan;
    }
    plan.has_data = true;
    let Some(ff) = ffmpeg else {
        // Проверить и склеить нечем: ничего не трогаем.
        plan.reasons.push("no-ffmpeg".into());
        plan.transient = true;
        return plan;
    };

    let existing = if audio.exists() { media::probe(ff, &audio).ok() } else { None };

    if chunks.is_empty() {
        match existing {
            Some(d) => {
                plan.audio = Some(audio);
                plan.duration = Some(d);
                plan.safe_to_clean = true;
            }
            None => plan.reasons.push("audio-damaged".into()),
        }
        return plan;
    }

    // Каждый кусок читаем до конца: «битый» это не открывается или декодер жалуется.
    let mut valid: Vec<(PathBuf, f64)> = Vec::new();
    let mut damaged = false;
    for c in &chunks {
        match media::probe(ff, &c.path) {
            Ok(d) => valid.push((c.path.clone(), d)),
            Err(e) => {
                warn!("[recovery] кусок {} не читается: {}", c.path.display(), e);
                damaged = true;
            }
        }
    }
    // Куски нумеруются подряд с нуля; дыра в нумерации значит, что файл пропал.
    let gap = chunks.iter().enumerate().any(|(i, c)| c.index as usize != i);
    if damaged {
        plan.reasons.push("chunk-damaged".into());
    }
    if gap {
        plan.reasons.push("chunk-missing".into());
    }
    let sum: f64 = valid.iter().map(|(_, d)| d).sum();
    let tol = 0.25 + 0.01 * valid.len() as f64;

    // Уже собранный `audio.mp4` годится, если читается и не короче кусков.
    if let Some(d) = existing {
        if !valid.is_empty() && d >= sum - tol {
            plan.audio = Some(audio);
            plan.duration = Some(d);
            plan.safe_to_clean = !damaged && !gap;
            return plan;
        }
        if valid.is_empty() {
            plan.audio = Some(audio);
            plan.duration = Some(d);
            return plan;
        }
    }
    if valid.is_empty() {
        return plan;
    }

    let part = folder.join("audio.mp4.part");
    let list = ckdir.join("concat_list.txt");
    let files: Vec<PathBuf> = valid.iter().map(|(p, _)| p.clone()).collect();
    let _ = std::fs::remove_file(&part);
    if let Err(e) = media::concat_copy(ff, &files, &list, &part) {
        warn!("[recovery] склейка не удалась: {e}");
        let _ = std::fs::remove_file(&part);
        let _ = std::fs::remove_file(&list);
        plan.reasons.push("merge-failed".into());
        plan.transient = true;
        return plan;
    }
    let _ = std::fs::remove_file(&list);
    let merged = match media::probe(ff, &part) {
        Ok(d) => d,
        Err(e) => {
            warn!("[recovery] склеенный файл не читается: {e}");
            let _ = std::fs::remove_file(&part);
            plan.reasons.push("merge-failed".into());
            plan.transient = true;
            return plan;
        }
    };
    let mismatch = (merged - sum).abs() > tol;
    if mismatch {
        plan.reasons.push("duration-mismatch".into());
    }
    if let Err(e) = fsio::sync_file(&part) {
        warn!("[recovery] fsync итога: {e}");
    }
    // Прежний `audio.mp4` (оборванная склейка при обычной остановке) не затираем, а откладываем в сторону.
    if audio.exists() {
        let aside = folder.join("audio.interrupted.mp4");
        let _ = std::fs::remove_file(&aside);
        let _ = fsio::rename_durable(&audio, &aside);
    }
    if let Err(e) = fsio::rename_durable(&part, &audio) {
        warn!("[recovery] не удалось поставить audio.mp4: {e}");
        plan.reasons.push("merge-failed".into());
        plan.transient = true;
        return plan;
    }
    plan.audio = Some(audio);
    plan.duration = Some(merged);
    plan.safe_to_clean = !damaged && !gap && !mismatch;
    plan
}

/// Удалить куски. Только когда `safe_to_clean` и итоговый файл на месте и не пустой.
fn clean_chunks(folder: &Path, plan: &AudioPlan) {
    if !plan.safe_to_clean {
        return;
    }
    let Some(audio) = &plan.audio else { return };
    if std::fs::metadata(audio).map_or(true, |m| m.len() == 0) {
        return;
    }
    let ckdir = folder.join(".checkpoints");
    for c in media::list_chunks(&ckdir) {
        let _ = std::fs::remove_file(c.path);
    }
    for p in media::list_parts(&ckdir) {
        let _ = std::fs::remove_file(p);
    }
    let _ = std::fs::remove_file(ckdir.join("concat_list.txt"));
    let _ = std::fs::remove_dir(&ckdir); // только пустую
    fsio::sync_dir(folder);
}

// ---------------------------------------------------------------------------
// База

async fn db_find(pool: &SqlitePool, folder: &str) -> Result<Option<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT id FROM meetings WHERE folder_path = ?")
        .bind(folder)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("база: {e}"))
}

/// Встреча и реплики одной транзакцией (как `TranscriptsRepository::save_transcript`, но с датой начала).
async fn db_insert(
    pool: &SqlitePool,
    title: &str,
    created: DateTime<Utc>,
    updated: DateTime<Utc>,
    folder: &str,
    segments: &[transcript::Segment],
) -> Result<String, String> {
    let id = format!("meeting-{}", uuid::Uuid::new_v4());
    let mut tx = pool.begin().await.map_err(|e| format!("база: {e}"))?;
    // Повторная проверка внутри транзакции: дубль по папке невозможен.
    let dup: Option<String> = sqlx::query_scalar("SELECT id FROM meetings WHERE folder_path = ?")
        .bind(folder)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| format!("база: {e}"))?;
    if let Some(existing) = dup {
        return Ok(existing);
    }
    sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES (?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(title)
        .bind(created)
        .bind(updated)
        .bind(folder)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("база: {e}"))?;
    for seg in segments {
        let timestamp = if seg.display_time.is_empty() {
            format!("{:02}:{:02}", (seg.audio_start_time as u64) / 60, (seg.audio_start_time as u64) % 60)
        } else {
            seg.display_time.clone()
        };
        sqlx::query(
            "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(format!("transcript-{}", uuid::Uuid::new_v4()))
        .bind(&id)
        .bind(&seg.text)
        .bind(timestamp)
        .bind(seg.audio_start_time)
        .bind(seg.audio_end_time)
        .bind(seg.duration)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("база: {e}"))?;
    }
    tx.commit().await.map_err(|e| format!("база: {e}"))?;
    Ok(id)
}

// ---------------------------------------------------------------------------
// Одна папка

pub async fn recover_folder(pool: &SqlitePool, folder: &Path, opts: &Options) -> Result<Outcome, String> {
    let folder_name = folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let meta = read_meta(folder);
    let has_checkpoints = !media::list_chunks(&folder.join(".checkpoints")).is_empty();
    let has_transcript = folder.join("transcripts.json").exists() || fsio::temp_path(&folder.join("transcripts.json")).exists();

    // Не наша папка или запись завершена как обычно.
    match &meta {
        Some(m) if !is_interrupted(m) => return Ok(Outcome::Skipped),
        None if !has_checkpoints && !has_transcript => return Ok(Outcome::Skipped),
        _ => {}
    }
    let prior = read_mark(folder);
    if matches!(&prior, Some(m) if m.state == "nothing") {
        return Ok(Outcome::Skipped);
    }

    // Когда запись оборвалась: последняя запись в папку, до того как мы сами что-то в ней поменяем.
    let last_activity = newest_mtime(folder);
    // Писали только что: живая запись (своя или другого экземпляра).
    if let Some(newest) = last_activity {
        if SystemTime::now().duration_since(newest).unwrap_or_default() < opts.min_idle {
            return Ok(Outcome::Fresh);
        }
    }

    let folder_str = folder.to_string_lossy().into_owned();
    let attempts = prior.as_ref().map_or(0, |m| m.attempts) + 1;
    let mut reasons: Vec<String> = Vec::new();
    if meta.is_none() {
        reasons.push("metadata-missing".into());
    }

    // Реплики
    let parsed = transcript::load(folder);
    if parsed.damaged {
        reasons.push("transcript-damaged".into());
    }
    let mut segments: Vec<transcript::Segment> = parsed.segments.into_iter().filter(|s| !s.text.trim().is_empty()).collect();
    segments.sort_by(|a, b| a.sequence_id.cmp(&b.sequence_id).then(a.audio_start_time.total_cmp(&b.audio_start_time)));

    // Звук
    let expects_audio = meta.as_ref().map_or(true, |m| text(m, "audio_file").is_some() || has_checkpoints);
    let plan = {
        let folder = folder.to_path_buf();
        let ffmpeg = opts.ffmpeg.clone();
        tokio::task::spawn_blocking(move || prepare_audio(&folder, ffmpeg.as_deref(), expects_audio))
            .await
            .map_err(|e| format!("склейка звука: {e}"))?
    };
    reasons.extend(plan.reasons.iter().cloned());
    // «Нет звука» не причина «частично», если запись и не должна была его сохранять.
    if !expects_audio {
        reasons.retain(|r| r != "no-audio");
    }

    let existing = db_find(pool, &folder_str).await?;
    if segments.is_empty() && !plan.has_data && existing.is_none() {
        info!("[recovery] {folder_name}: ни реплик, ни звука, восстанавливать нечего");
        let mark = Mark {
            version: 1,
            state: "nothing".into(),
            meeting_id: None,
            recovered_at: Utc::now().to_rfc3339(),
            partial: false,
            reasons: vec![],
            segments: 0,
            audio_seconds: None,
            attempts,
        };
        write_mark(folder, &mark)?;
        return Ok(Outcome::Nothing);
    }

    // Название и даты
    let (derived_title, derived_start) = split_folder_name(&folder_name);
    let title = meta.as_ref().and_then(|m| text(m, "meeting_name")).map(String::from).unwrap_or(derived_title);
    let created = meta
        .as_ref()
        .and_then(|m| text(m, "created_at"))
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc))
        .or(derived_start)
        .or_else(|| last_activity.map(DateTime::<Utc>::from))
        .unwrap_or_else(Utc::now);
    let last_end = segments.iter().map(|s| s.audio_end_time).fold(0.0_f64, f64::max);
    let duration = plan.duration.or(if last_end > 0.0 { Some(last_end) } else { None });
    let updated = duration.map_or(created, |d| created + chrono::Duration::milliseconds((d * 1000.0) as i64));

    // Встреча в базе (не дублируется)
    let meeting_id = match existing {
        Some(id) => id,
        None => db_insert(pool, &title, created, updated, &folder_str, &segments).await?,
    };

    // Звук не собрался по временной причине: встреча уже есть, метка «повторить»,
    // `metadata.json` остаётся `recording`, следующий запуск попробует ещё раз
    let retry = plan.transient && plan.audio.is_none() && attempts < MAX_ATTEMPTS;
    let partial = !reasons.is_empty();
    let mark = Mark {
        version: 1,
        state: if retry { "retry".into() } else { "done".into() },
        meeting_id: Some(meeting_id.clone()),
        recovered_at: Utc::now().to_rfc3339(),
        partial,
        reasons: reasons.clone(),
        segments: segments.len(),
        audio_seconds: plan.duration,
        attempts,
    };
    write_mark(folder, &mark)?;

    if !retry {
        let mut m = meta.clone().unwrap_or_else(|| {
            let mut m = Map::new();
            m.insert("version".into(), "1.0".into());
            m.insert("meeting_name".into(), title.clone().into());
            m.insert("created_at".into(), created.to_rfc3339().into());
            m.insert("devices".into(), serde_json::json!({ "microphone": null, "system_audio": null }));
            m.insert("transcript_file".into(), "transcripts.json".into());
            m.insert("sample_rate".into(), 48000.into());
            m
        });
        let completed_at = last_activity.map(DateTime::<Utc>::from).unwrap_or(updated);
        m.insert("status".into(), "completed".into());
        m.insert("completed_at".into(), completed_at.to_rfc3339().into());
        m.insert("duration_seconds".into(), duration.map_or(Value::Null, |d| d.into()));
        m.insert("meeting_id".into(), meeting_id.clone().into());
        m.insert("audio_file".into(), if plan.audio.is_some() { "audio.mp4".into() } else { m.get("audio_file").cloned().unwrap_or("".into()) });
        let json = serde_json::to_vec_pretty(&Value::Object(m)).map_err(|e| e.to_string())?;
        fsio::write_atomic(&folder.join("metadata.json"), &json).map_err(|e| format!("metadata.json: {e}"))?;
        clean_chunks(folder, &plan);
    }

    info!(
        "[recovery] {folder_name}: встреча {meeting_id}, реплик {}, звук {:?} с, частично: {partial} {reasons:?}",
        segments.len(),
        plan.duration
    );
    Ok(Outcome::Recovered(Recovered {
        meeting_id,
        title,
        created_at: created.to_rfc3339(),
        duration_seconds: duration,
        segments: segments.len(),
        partial,
        reasons,
        folder: folder_str,
    }))
}

/// Папки записей по порядку имён (то есть по времени начала).
pub fn scan(recordings: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(recordings) else { return Vec::new() };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map_or(false, |t| t.is_dir()))
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| e.path())
        .collect();
    dirs.sort();
    dirs
}

pub async fn recover_all(pool: &SqlitePool, recordings: &Path, opts: &Options) -> Report {
    let _guard = RUN_LOCK.lock().await;
    let mut report = Report { ready: true, ..Default::default() };
    for folder in scan(recordings) {
        match recover_folder(pool, &folder, opts).await {
            Ok(Outcome::Recovered(r)) => report.recovered.push(r),
            Ok(Outcome::Fresh) => report.deferred += 1,
            Ok(Outcome::Nothing) => report.nothing += 1,
            Ok(Outcome::Skipped) => {}
            Err(e) => {
                warn!("[recovery] {}: {e}", folder.display());
                report.failed.push(format!("{}: {e}", folder.display()));
            }
        }
    }
    report.marked = list_marked(pool).await;
    report
}

/// Все встречи с меткой «восстановлена после сбоя» (для подписи в списке и на странице встречи).
pub async fn list_marked(pool: &SqlitePool) -> Vec<Marked> {
    let rows: Vec<(String, Option<String>)> = sqlx::query_as("SELECT id, folder_path FROM meetings WHERE folder_path IS NOT NULL")
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    rows.into_iter()
        .filter_map(|(id, folder)| {
            let mark = read_mark(Path::new(&folder?))?;
            (mark.state != "nothing" && mark.meeting_id.as_deref() == Some(id.as_str())).then(|| Marked {
                meeting_id: id,
                partial: mark.partial,
                recovered_at: mark.recovered_at,
            })
        })
        .collect()
}

/// Вызывается интерфейсом при запуске, когда база готова.
#[tauri::command]
pub async fn recover_interrupted_meetings<R: Runtime>(app: AppHandle<R>) -> Result<Report, String> {
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return Ok(Report::default());
    };
    if crate::audio::recording_commands::is_recording().await {
        return Ok(Report { ready: true, recording: true, ..Default::default() });
    }
    let folder = crate::audio::recording_preferences::load_recording_preferences(&app)
        .await
        .map(|p| p.save_folder)
        .unwrap_or_else(|_| crate::audio::recording_preferences::get_default_recordings_folder());
    let opts = Options {
        ffmpeg: crate::audio::ffmpeg::find_ffmpeg_path(),
        min_idle: Duration::from_secs(FRESH_SECS),
    };
    Ok(recover_all(state.db_manager.pool(), &folder, &opts).await)
}
