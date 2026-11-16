//! Тесты восстановления после сбоя. Нужны ffmpeg (как у приложения) и ничего больше:
//! база временная, папка записей временная, настоящие данные не трогаются.
//!
//! `kill9_mid_recording` запускает этот же тестовый файл дочерним процессом, пишет в
//! него настоящим кодом записи (`RecordingSaver` + `IncrementalAudioSaver`) и убивает
//! `SIGKILL` посреди записи.

use super::*;
use crate::audio::encode::encode_single_audio;
use crate::audio::ffmpeg::find_ffmpeg_path;
use crate::database::manager::DatabaseManager;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use tempfile::TempDir;

const SR: u32 = 48_000;

fn ffmpeg() -> PathBuf {
    find_ffmpeg_path().expect("для тестов нужен ffmpeg")
}

fn opts() -> Options {
    Options { ffmpeg: Some(ffmpeg()), min_idle: Duration::ZERO }
}

async fn new_pool(dir: &Path) -> SqlitePool {
    DatabaseManager::new(dir.join("test.sqlite").to_str().unwrap(), "none").await.unwrap().pool().clone()
}

async fn count(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sql).fetch_one(pool).await.unwrap()
}

/// Кусок звука из тона, закодированный тем же кодом, что и при записи.
fn make_chunk(path: &Path, seconds: f32) {
    let samples: Vec<f32> = (0..(SR as f32 * seconds) as usize).map(|i| (i as f32 * 0.05).sin() * 0.3).collect();
    encode_single_audio(bytemuck::cast_slice(&samples), SR, 1, &path.to_path_buf()).unwrap();
}

fn transcripts_json(n: usize) -> String {
    let segs: Vec<Value> = (0..n)
        .map(|i| {
            serde_json::json!({
                "audio_end_time": 4.0 * i as f64 + 3.0, "audio_start_time": 4.0 * i as f64, "confidence": 0.85,
                "display_time": format!("10:02:{:02}", i % 60), "duration": 3.0, "id": format!("seg_{i}"),
                "sequence_id": i, "text": format!("Реплика номер {i}.")
            })
        })
        .collect();
    serde_json::to_string_pretty(&serde_json::json!({
        "last_updated": "2026-11-16T10:31:28+00:00", "segments": segs, "total_segments": n, "version": "1.0"
    }))
    .unwrap()
}

/// Папка прерванной записи, как её оставляет `RecordingSaver`: `status: recording`, куски, реплики.
fn interrupted(root: &Path, name: &str, chunks: usize, chunk_secs: f32, segments: usize) -> PathBuf {
    let folder = root.join(name);
    fs::create_dir_all(folder.join(".checkpoints")).unwrap();
    fs::write(
        folder.join("metadata.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "version": "1.0", "meeting_id": null, "meeting_name": name.split("_2026").next().unwrap().to_string(),
            "created_at": "2026-11-16T10:02:19.113228+00:00", "completed_at": null, "duration_seconds": null,
            "devices": { "microphone": "AirPods", "system_audio": "AirPods" },
            "audio_file": "audio.mp4", "transcript_file": "transcripts.json", "sample_rate": 48000, "status": "recording"
        }))
        .unwrap(),
    )
    .unwrap();
    if segments > 0 {
        fs::write(folder.join("transcripts.json"), transcripts_json(segments)).unwrap();
    }
    for i in 0..chunks {
        make_chunk(&folder.join(format!(".checkpoints/audio_chunk_{i:03}.mp4")), chunk_secs);
    }
    folder
}

fn meta(folder: &Path) -> Map<String, Value> {
    read_json_map(&folder.join("metadata.json")).expect("metadata.json читается")
}

const NAME: &str = "Meeting 16_11_26_15_02_17_2026-11-16_10-02";

// ---------------------------------------------------------------------------
// Основной путь

#[tokio::test]
async fn recovers_interrupted_meeting() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 3, 4.0, 5);
    let last_write: DateTime<Utc> = newest_mtime(&folder).unwrap().into();

    let report = recover_all(&pool, root.path(), &opts()).await;
    assert_eq!(report.recovered.len(), 1);
    let r = &report.recovered[0];
    assert!(!r.partial, "полный сбой без повреждений не «частично»: {:?}", r.reasons);
    assert_eq!(r.segments, 5);
    assert_eq!(r.title, "Meeting 16_11_26_15_02_17");
    assert_eq!(r.created_at, "2026-11-16T10:02:19.113228+00:00".parse::<DateTime<Utc>>().unwrap().to_rfc3339());
    let d = r.duration_seconds.unwrap();
    assert!((d - 12.0).abs() < 0.3, "длительность по звуку: {d}");

    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM transcripts").await, 5);
    // итоги не запускались
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM summary_processes").await, 0);
    // звук собран, куски убраны, метка и метаданные как у обычной встречи
    assert!(media::probe(&ffmpeg(), &folder.join("audio.mp4")).is_ok());
    assert!(!folder.join(".checkpoints").exists());
    let m = meta(&folder);
    assert_eq!(text(&m, "status"), Some("completed"));
    // «закончена» тогда, когда оборвалась запись, а не когда мы её восстановили
    let completed: DateTime<Utc> = text(&m, "completed_at").unwrap().parse().unwrap();
    assert_eq!(completed, last_write);
    assert_eq!(text(&m, "meeting_id"), Some(r.meeting_id.as_str()));
    assert_eq!(text(&m, "audio_file"), Some("audio.mp4"));
    let mark = read_mark(&folder).unwrap();
    assert_eq!((mark.state.as_str(), mark.partial, mark.segments), ("done", false, 5));
    assert_eq!(report.marked.len(), 1);
    assert_eq!(report.marked[0].meeting_id, r.meeting_id);
}

#[tokio::test]
async fn rerun_after_recovery_creates_nothing() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    interrupted(root.path(), NAME, 2, 3.0, 4);
    let first = recover_all(&pool, root.path(), &opts()).await;
    assert_eq!(first.recovered.len(), 1);
    let second = recover_all(&pool, root.path(), &opts()).await;
    assert!(second.recovered.is_empty());
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM transcripts").await, 4);
}

/// Запуск дважды одновременно (двойной вызов эффекта, второе окно): одна встреча.
#[tokio::test]
async fn concurrent_runs_create_one_meeting() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    interrupted(root.path(), NAME, 2, 3.0, 4);
    let (o1, o2) = (opts(), opts());
    let (a, b) = tokio::join!(recover_all(&pool, root.path(), &o1), recover_all(&pool, root.path(), &o2));
    assert_eq!(a.recovered.len() + b.recovered.len(), 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 1);
}

// ---------------------------------------------------------------------------
// Повреждения

#[tokio::test]
async fn damaged_last_chunk_keeps_chunks_and_marks_partial() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 3, 4.0, 3);
    // последний кусок оборван посередине записи: без moov он не открывается
    let last = folder.join(".checkpoints/audio_chunk_002.mp4");
    let bytes = fs::read(&last).unwrap();
    fs::write(&last, &bytes[..bytes.len() / 2]).unwrap();

    let report = recover_all(&pool, root.path(), &opts()).await;
    let r = &report.recovered[0];
    assert!(r.partial);
    assert!(r.reasons.contains(&"chunk-damaged".to_string()));
    let d = r.duration_seconds.unwrap();
    assert!((d - 8.0).abs() < 0.3, "собраны два годных куска: {d}");
    // сомнение: ничего не удалено, в том числе битый кусок
    assert_eq!(media::list_chunks(&folder.join(".checkpoints")).len(), 3);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 1);
}

#[tokio::test]
async fn missing_chunk_in_the_middle_marks_partial() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 4, 3.0, 2);
    fs::remove_file(folder.join(".checkpoints/audio_chunk_001.mp4")).unwrap();
    let report = recover_all(&pool, root.path(), &opts()).await;
    let r = &report.recovered[0];
    assert!(r.partial && r.reasons.contains(&"chunk-missing".to_string()));
    assert_eq!(media::list_chunks(&folder.join(".checkpoints")).len(), 3);
}

#[test]
fn transcript_parse_whole_truncated_and_garbage() {
    let full = transcripts_json(6);
    let p = transcript::parse(&full);
    assert_eq!((p.segments.len(), p.damaged), (6, false));

    // обрезан посередине пятой реплики
    let cut = full.find("\"seg_4\"").unwrap() + 3;
    let p = transcript::parse(&full[..cut]);
    assert!(p.damaged);
    assert_eq!(p.segments.len(), 4, "целые четыре реплики читаются, пятая оборвана");
    assert_eq!(p.segments[3].text, "Реплика номер 3.");

    // обрезан до массива, пустой, мусор
    assert!(transcript::parse("{\"version\": \"1.0\", \"segme").segments.is_empty());
    assert!(transcript::parse("").segments.is_empty());
    assert!(transcript::parse("\u{0}\u{0}\u{0}").damaged);

    // число реплик не сошлось с total_segments
    let lying = full.replace("\"total_segments\": 6", "\"total_segments\": 9");
    assert!(transcript::parse(&lying).damaged);
}

#[tokio::test]
async fn truncated_transcripts_json_recovers_readable_part() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 2, 3.0, 8);
    let full = fs::read_to_string(folder.join("transcripts.json")).unwrap();
    fs::write(folder.join("transcripts.json"), &full[..full.find("\"seg_6\"").unwrap() + 5]).unwrap();

    let report = recover_all(&pool, root.path(), &opts()).await;
    let r = &report.recovered[0];
    assert_eq!(r.segments, 6);
    assert!(r.partial && r.reasons.contains(&"transcript-damaged".to_string()));
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM transcripts").await, 6);
}

/// Обрыв между записью `.transcripts.json.tmp` и переименованием: новее временный файл.
#[tokio::test]
async fn newer_tmp_transcript_wins() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 1, 3.0, 3);
    fs::write(folder.join(".transcripts.json.tmp"), transcripts_json(5)).unwrap();
    let report = recover_all(&pool, root.path(), &opts()).await;
    assert_eq!(report.recovered[0].segments, 5);
}

#[tokio::test]
async fn metadata_missing_uses_folder_name() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 2, 3.0, 3);
    fs::remove_file(folder.join("metadata.json")).unwrap();
    let report = recover_all(&pool, root.path(), &opts()).await;
    let r = &report.recovered[0];
    assert_eq!(r.title, "Meeting 16_11_26_15_02_17");
    assert!(r.created_at.starts_with("2026-11-16T10:02:00"), "время из имени папки (UTC): {}", r.created_at);
    assert!(r.reasons.contains(&"metadata-missing".to_string()));
    assert_eq!(text(&meta(&folder), "status"), Some("completed"));
}

// ---------------------------------------------------------------------------
// Пустое, чужое, живое

#[tokio::test]
async fn interrupted_without_any_replica_keeps_audio() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 2, 3.0, 0);
    let report = recover_all(&pool, root.path(), &opts()).await;
    let r = &report.recovered[0];
    assert_eq!(r.segments, 0);
    assert!(!r.partial);
    assert!(folder.join("audio.mp4").exists());
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM transcripts").await, 0);
}

#[tokio::test]
async fn nothing_to_recover_creates_no_meeting_and_is_not_retried() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 0, 0.0, 0);
    let report = recover_all(&pool, root.path(), &opts()).await;
    assert_eq!((report.recovered.len(), report.nothing), (0, 1));
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 0);
    assert_eq!(read_mark(&folder).unwrap().state, "nothing");
    // папка не тронута: метаданные прежние
    assert_eq!(text(&meta(&folder), "status"), Some("recording"));
    let again = recover_all(&pool, root.path(), &opts()).await;
    assert_eq!(again.nothing, 0);
}

/// Завершённая запись без строки в базе (удалили сами): не воскрешается.
#[tokio::test]
async fn completed_meeting_without_db_row_is_left_alone() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 0, 0.0, 3);
    let mut m = meta(&folder);
    m.insert("status".into(), "completed".into());
    m.insert("completed_at".into(), "2026-11-16T10:40:00+00:00".into());
    fs::write(folder.join("metadata.json"), serde_json::to_vec(&m).unwrap()).unwrap();
    let report = recover_all(&pool, root.path(), &opts()).await;
    assert!(report.recovered.is_empty());
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 0);
}

/// Папка, в которую только что писали (живая запись, второй экземпляр): не трогаем.
#[tokio::test]
async fn freshly_written_folder_is_deferred_untouched() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 2, 3.0, 3);
    let live = Options { ffmpeg: Some(ffmpeg()), min_idle: Duration::from_secs(FRESH_SECS) };
    let report = recover_all(&pool, root.path(), &live).await;
    assert_eq!((report.recovered.len(), report.deferred), (0, 1));
    assert!(folder.join(".checkpoints/audio_chunk_000.mp4").exists());
    assert!(!folder.join("audio.mp4").exists() && read_mark(&folder).is_none());
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 0);
}

/// Ручные файлы штаба рядом: не трогаются и не дублируют звук, собираем из исходных кусков.
#[tokio::test]
async fn manual_recovered_files_are_untouched() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 2, 3.0, 3);
    let manual_audio = folder.join("Запись (восстановлена).mp4");
    let manual_text = folder.join("Транскрипт (восстановлен).md");
    make_chunk(&manual_audio, 6.0);
    fs::write(&manual_text, "# Транскрипт\nвручную").unwrap();
    let (a, t) = (fs::read(&manual_audio).unwrap(), fs::read(&manual_text).unwrap());
    // ручные файлы свежее записи: время «когда оборвалась» от них не зависит
    let last_write: DateTime<Utc> = newest_mtime(&folder).unwrap().into();
    std::thread::sleep(Duration::from_millis(1100));
    fs::write(&manual_text, &t).unwrap();

    let report = recover_all(&pool, root.path(), &opts()).await;
    assert_eq!(report.recovered.len(), 1);
    assert_eq!(fs::read(&manual_audio).unwrap(), a);
    assert_eq!(fs::read(&manual_text).unwrap(), t);
    let completed: DateTime<Utc> = text(&meta(&folder), "completed_at").unwrap().parse().unwrap();
    assert_eq!(completed, last_write, "completed_at по записи, а не по ручным файлам");
    // звук один: `audio.mp4` из исходных кусков, не копия ручного
    let d = media::probe(&ffmpeg(), &folder.join("audio.mp4")).unwrap();
    assert!((d - 6.0).abs() < 0.3);
    assert!(!folder.join(".checkpoints").exists());
}

#[tokio::test]
async fn two_interrupted_sessions_are_recovered_separately() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    interrupted(root.path(), "Meeting 16_11_26_15_02_17_2026-11-16_10-02", 2, 3.0, 4);
    interrupted(root.path(), "Meeting 16_11_26_16_20_00_2026-11-16_11-20", 3, 3.0, 7);
    let report = recover_all(&pool, root.path(), &opts()).await;
    assert_eq!(report.recovered.len(), 2);
    assert_eq!(report.recovered[0].segments, 4);
    assert_eq!(report.recovered[1].segments, 7);
    assert_ne!(report.recovered[0].meeting_id, report.recovered[1].meeting_id);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 2);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM transcripts").await, 11);
}

// ---------------------------------------------------------------------------
// Отказы: склейка, диск, база

fn fake_ffmpeg(dir: &Path, concat_message: &str) -> PathBuf {
    let script = dir.join("ffmpeg-fake.sh");
    fs::write(
        &script,
        format!(
            "#!/bin/sh\nfor a in \"$@\"; do\n  if [ \"$a\" = concat ]; then\n    eval out=\\${{$#}}\n    head -c 4000 /dev/zero > \"$out\"\n    echo \"{}\" >&2\n    exit 1\n  fi\ndone\nexec \"{}\" \"$@\"\n",
            concat_message,
            ffmpeg().display()
        ),
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    script
}

/// Склейка оборвалась (нет места, обрыв): куски целы, встреча с репликами есть, при следующем
/// запуске звук собирается и дублей нет.
#[tokio::test]
async fn interrupted_merge_keeps_chunks_and_retries_next_start() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 3, 3.0, 4);
    let tools = TempDir::new().unwrap();
    let broken = Options { ffmpeg: Some(fake_ffmpeg(tools.path(), "No space left on device")), min_idle: Duration::ZERO };

    let first = recover_all(&pool, root.path(), &broken).await;
    let r = &first.recovered[0];
    assert!(r.partial && r.reasons.contains(&"merge-failed".to_string()));
    assert_eq!(media::list_chunks(&folder.join(".checkpoints")).len(), 3, "куски на месте");
    assert!(!folder.join("audio.mp4").exists() && !folder.join("audio.mp4.part").exists());
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM transcripts").await, 4);
    assert_eq!(read_mark(&folder).unwrap().state, "retry");
    assert_eq!(text(&meta(&folder), "status"), Some("recording"), "доделаем при следующем запуске");

    // место появилось: тот же запуск с настоящим ffmpeg
    let second = recover_all(&pool, root.path(), &opts()).await;
    assert_eq!(second.recovered.len(), 1);
    assert_eq!(second.recovered[0].meeting_id, r.meeting_id, "та же встреча, без дубля");
    assert!(!second.recovered[0].partial);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 1);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM transcripts").await, 4, "реплики не задвоились");
    assert!(media::probe(&ffmpeg(), &folder.join("audio.mp4")).is_ok());
    assert!(!folder.join(".checkpoints").exists());
    assert_eq!(read_mark(&folder).unwrap().state, "done");
}

/// ffmpeg нет вовсе: встреча с репликами создаётся, куски не трогаются.
#[tokio::test]
async fn without_ffmpeg_audio_is_left_for_later() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 2, 3.0, 3);
    let none = Options { ffmpeg: None, min_idle: Duration::ZERO };
    let report = recover_all(&pool, root.path(), &none).await;
    let r = &report.recovered[0];
    assert!(r.partial && r.reasons.contains(&"no-ffmpeg".to_string()));
    assert_eq!(media::list_chunks(&folder.join(".checkpoints")).len(), 2);
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 1);
}

/// Обычная остановка оборвалась на склейке: на месте `audio.mp4` обрубок. Он откладывается в сторону.
#[tokio::test]
async fn half_written_audio_from_interrupted_stop_is_replaced() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 3, 3.0, 3);
    fs::write(folder.join("audio.mp4"), vec![0u8; 5000]).unwrap();
    let report = recover_all(&pool, root.path(), &opts()).await;
    assert!(!report.recovered[0].partial, "{:?}", report.recovered[0].reasons);
    let d = media::probe(&ffmpeg(), &folder.join("audio.mp4")).unwrap();
    assert!((d - 9.0).abs() < 0.3);
    assert!(folder.join("audio.interrupted.mp4").exists(), "обрубок не стёрт");
    assert!(!folder.join(".checkpoints").exists());
}

/// Запись в базу не удалась (нет места, база занята): папка не изменена ни на байт, следующий запуск восстановит.
#[tokio::test]
async fn database_failure_leaves_folder_for_next_start() {
    let root = TempDir::new().unwrap();
    let pool = new_pool(root.path()).await;
    let folder = interrupted(root.path(), NAME, 2, 3.0, 3);
    let before = fs::read(folder.join("metadata.json")).unwrap();
    pool.close().await;
    let report = recover_all(&pool, root.path(), &opts()).await;
    assert_eq!(report.recovered.len(), 0);
    assert_eq!(report.failed.len(), 1);
    assert_eq!(fs::read(folder.join("metadata.json")).unwrap(), before);
    assert!(read_mark(&folder).is_none());
    assert_eq!(media::list_chunks(&folder.join(".checkpoints")).len(), 2, "куски на месте");

    let pool2 = new_pool(root.path()).await;
    let again = recover_all(&pool2, root.path(), &opts()).await;
    assert_eq!(again.recovered.len(), 1);
    assert_eq!(count(&pool2, "SELECT COUNT(*) FROM meetings").await, 1);
}

// ---------------------------------------------------------------------------
// Надёжная запись файлов

#[test]
fn write_atomic_replaces_whole_file_and_cleans_up() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("transcripts.json");
    fsio::write_atomic(&path, b"{\"v\":1}").unwrap();
    fsio::write_atomic(&path, b"{\"v\":2}").unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"{\"v\":2}");
    assert!(!fsio::temp_path(&path).exists());
}

#[test]
fn write_atomic_failure_keeps_previous_file() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("metadata.json");
    fsio::write_atomic(&path, b"old").unwrap();
    // временный файл не создать: на его месте папка (то же, что «нет места» для записи)
    fs::create_dir(fsio::temp_path(&path)).unwrap();
    assert!(fsio::write_atomic(&path, b"new").is_err());
    assert_eq!(fs::read(&path).unwrap(), b"old");
}

// ---------------------------------------------------------------------------
// Настоящий обрыв: kill -9 посреди записи

/// Дочерний процесс: пишет встречу настоящим кодом записи, пока его не убьют. Запускается
/// только из `kill9_mid_recording` (`SHADE_CRASH_CHILD`), сам по себе ничего не делает.
#[test]
fn recording_child_writes_until_killed() {
    if std::env::var("SHADE_CRASH_CHILD").is_err() {
        return;
    }
    use crate::audio::recording_saver::{RecordingSaver, TranscriptSegment};
    use crate::audio::recording_state::{AudioChunk, DeviceType};
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
    rt.block_on(async {
        let mut saver = RecordingSaver::new();
        saver.set_meeting_name(Some("Meeting kill9".into()));
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<AudioChunk>();
        saver.start_accumulation(true, rx);
        let progress = PathBuf::from(std::env::var("SHADE_PROGRESS").unwrap());
        // По умолчанию в 10 раз быстрее реального времени. Для замера нагрузки
        // `SHADE_CHILD_MS=500 SHADE_CHILD_SEG_EVERY=16`: реальное время, реплика раз в 8 с
        let pace: u64 = std::env::var("SHADE_CHILD_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(50);
        let seg_every: u64 = std::env::var("SHADE_CHILD_SEG_EVERY").ok().and_then(|v| v.parse().ok()).unwrap_or(2);
        let filler = "слово ".repeat(if seg_every > 2 { 25 } else { 0 });
        for i in 0u64.. {
            let data: Vec<f32> = (0..24_000).map(|k| ((k as f32 + i as f32) * 0.05).sin() * 0.3).collect();
            tx.send(AudioChunk { data, sample_rate: SR, timestamp: i as f64 * 0.5, chunk_id: i, device_type: DeviceType::Microphone }).unwrap();
            if i % seg_every == seg_every - 1 {
                let seq = i / seg_every;
                saver.add_transcript_segment(TranscriptSegment {
                    id: format!("seg_{seq}"),
                    text: format!("Реплика {seq} из убитого процесса. {filler}"),
                    audio_start_time: seq as f64 * seg_every as f64 / 2.0,
                    audio_end_time: seq as f64 * seg_every as f64 / 2.0 + 1.0,
                    duration: 1.0,
                    display_time: "10:02:29".into(),
                    confidence: 0.85,
                    sequence_id: seq,
                });
                // реплика на диске (add вернулся после fsync и rename): записать счёт
                std::fs::write(&progress, (seq + 1).to_string()).unwrap();
            }
            tokio::time::sleep(Duration::from_millis(pace)).await;
        }
    });
}

/// Когда убивать дочерний процесс.
#[derive(Clone, Copy)]
enum KillAt {
    /// Когда на диске уже три куска, и ещё через столько миллисекунд.
    After(u64),
    /// В тот момент, когда появился недописанный `*.part` (идёт кодирование куска).
    Encoding,
}

async fn kill_round(round: usize, at: KillAt) {
    let home = TempDir::new().unwrap();
    let progress = home.path().join("progress.txt");
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["crash_recovery::tests::recording_child_writes_until_killed", "--exact", "--nocapture"])
        .env("SHADE_CRASH_CHILD", "1")
        .env("SHADE_PROGRESS", &progress)
        .env("HOME", home.path())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let recordings = home.path().join("Movies").join(crate::config::RECORDINGS_DIR_NAME);
    let checkpoints = || scan(&recordings).first().map(|f| f.join(".checkpoints"));

    // ждём, пока на диске будет минимум три куска (для Encoding: два куска и недописанный)
    let started = std::time::Instant::now();
    loop {
        let ck = checkpoints();
        let chunks = ck.as_ref().map_or(0, |d| media::list_chunks(d).len());
        let parts = ck.as_ref().map_or(0, |d| media::list_parts(d).len());
        match at {
            KillAt::After(_) if chunks >= 3 => break,
            KillAt::Encoding if chunks >= 2 && parts > 0 => break,
            _ => {}
        }
        assert!(started.elapsed() < Duration::from_secs(60), "дочерний процесс не пишет");
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    if let KillAt::After(ms) = at {
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }
    child.kill().unwrap(); // SIGKILL: процесс не успевает ни flush, ни Drop
    child.wait().unwrap();
    let had_part = checkpoints().map_or(false, |d| !media::list_parts(&d).is_empty());
    let written: usize = fs::read_to_string(&progress).unwrap().trim().parse().unwrap();
    if matches!(at, KillAt::Encoding) {
        assert!(had_part, "раунд {round}: убили не посреди кодирования куска");
    }

    let folder = scan(&recordings).remove(0);
    // 1. файлы на диске читаются целиком, полузаписанного JSON нет
    let m = meta(&folder);
    assert_eq!(text(&m, "status"), Some("recording"), "раунд {round}: запись не завершалась");
    let parsed = transcript::load(&folder);
    assert!(!parsed.damaged, "раунд {round}: transcripts.json обрезан");
    assert!(parsed.segments.len() >= written, "раунд {round}: на диске {} реплик, сказано {written}", parsed.segments.len());

    // 2. восстановление
    let pool = new_pool(home.path()).await;
    let report = recover_all(&pool, &recordings, &opts()).await;
    assert_eq!(report.recovered.len(), 1, "раунд {round}: {:?}", report.failed);
    let r = &report.recovered[0];
    assert!(!r.partial, "раунд {round}: {:?}", r.reasons);
    assert!(r.segments >= written);
    let d = r.duration_seconds.unwrap();
    // не меньше закрытых кусков: оборванный `.part` не считается, его звук потерян (не больше 10 с)
    assert!(d >= 19.9 && (d / 10.0).fract() < 0.05, "раунд {round}: звука {d} с, должно быть целое число кусков по 10 с");
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 1);
    assert!(media::probe(&ffmpeg(), &folder.join("audio.mp4")).is_ok());
    eprintln!(
        "раунд {round}: kill -9 {}; реплик записано {written}, восстановлено {}; звука {d:.1} с; оборванный .part: {had_part}",
        match at { KillAt::After(ms) => format!("через +{ms} мс после третьего куска"), KillAt::Encoding => "посреди кодирования куска".into() },
        r.segments
    );
    // всё годное собрано, куски и недописанный `.part` убраны
    assert!(!folder.join(".checkpoints").exists(), "раунд {round}: остались куски");
}

#[tokio::test]
async fn kill9_mid_recording() {
    if std::env::var("SHADE_CRASH_CHILD").is_ok() {
        return;
    }
    // несколько обрывов в разные моменты: между кусками и в записи реплик
    for (round, extra_ms) in [0u64, 130, 310, 520, 770].into_iter().enumerate() {
        kill_round(round, KillAt::After(extra_ms)).await;
    }
}

/// Самый тяжёлый обрыв: кусок звука закодирован не до конца.
#[tokio::test]
async fn kill9_during_chunk_encoding() {
    if std::env::var("SHADE_CRASH_CHILD").is_ok() {
        return;
    }
    for round in 0..3 {
        kill_round(round, KillAt::Encoding).await;
    }
}

// ---------------------------------------------------------------------------
// Настоящие данные (вручную): `SHADE_REAL_ROOT=<копия папки записей> cargo test ... real_copy -- --ignored --nocapture`

/// Прогон на копии настоящей папки встречи. Папка записей и база временные; сам тест ничего
/// не знает про содержимое, только печатает итог и проверяет инварианты.
#[tokio::test]
#[ignore]
async fn real_copy() {
    let root = PathBuf::from(std::env::var("SHADE_REAL_ROOT").expect("SHADE_REAL_ROOT: копия папки записей"));
    let db = TempDir::new().unwrap();
    let pool = new_pool(db.path()).await;
    let opts = opts();
    let before: Vec<(String, u64)> = fs::read_dir(root.join(std::env::var("SHADE_REAL_FOLDER").unwrap()))
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains("восстановл"))
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.metadata().unwrap().len()))
        .collect();

    let report = recover_all(&pool, &root, &opts).await;
    eprintln!("{}", serde_json::to_string_pretty(&report).unwrap());
    assert_eq!(report.recovered.len(), 1, "{:?}", report.failed);
    let r = &report.recovered[0];
    let folder = PathBuf::from(&r.folder);
    eprintln!("реплик в базе: {}", count(&pool, "SELECT COUNT(*) FROM transcripts").await);
    eprintln!("встреч в базе: {}", count(&pool, "SELECT COUNT(*) FROM meetings").await);
    eprintln!("{}", fs::read_to_string(folder.join("metadata.json")).unwrap());
    eprintln!("{}", fs::read_to_string(folder.join(MARK_FILE)).unwrap());
    let mut files: Vec<_> = fs::read_dir(&folder).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    files.sort();
    eprintln!("файлы: {files:?}");
    for (name, len) in before {
        assert_eq!(fs::metadata(folder.join(&name)).unwrap().len(), len, "ручной файл {name} изменён");
    }

    // повторный запуск: ничего нового
    let again = recover_all(&pool, &root, &opts).await;
    assert!(again.recovered.is_empty());
    assert_eq!(count(&pool, "SELECT COUNT(*) FROM meetings").await, 1);
}
