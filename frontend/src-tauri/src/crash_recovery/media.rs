//! Звук после сбоя: список кусков, проверка каждого, склейка без перекодирования.
//!
//! ffmpeg зовётся как внешняя программа (тот же `find_ffmpeg_path`, что и при обычной
//! остановке). Путь к нему приходит параметром, чтобы тесты могли подставить свой.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Кусок звука из `.checkpoints`.
#[derive(Debug, Clone)]
pub struct Chunk {
    pub index: u32,
    pub path: PathBuf,
}

/// Куски `audio_chunk_NNN.mp4` по возрастанию номера. Недописанные `*.part` и всё чужое пропускаются.
pub fn list_chunks(checkpoints: &Path) -> Vec<Chunk> {
    let Ok(entries) = std::fs::read_dir(checkpoints) else { return Vec::new() };
    let mut chunks: Vec<Chunk> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let index = name.strip_prefix("audio_chunk_")?.strip_suffix(".mp4")?.parse::<u32>().ok()?;
            Some(Chunk { index, path: e.path() })
        })
        .collect();
    chunks.sort_by_key(|c| c.index);
    chunks
}

/// Недописанные куски (`audio_chunk_NNN.mp4.part`): запись оборвалась внутри них.
pub fn list_parts(checkpoints: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(checkpoints) else { return Vec::new() };
    entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map_or(false, |x| x == "part"))
        .collect()
}

fn run(ffmpeg: &Path, args: &[&std::ffi::OsStr]) -> Result<(bool, String), String> {
    let out = Command::new(ffmpeg)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("ffmpeg не запустился: {e}"))?;
    Ok((out.status.success(), String::from_utf8_lossy(&out.stderr).into_owned()))
}

/// Длительность `HH:MM:SS.xx` из последней строки статистики ffmpeg (`time=`).
fn last_time(stderr: &str) -> Option<f64> {
    let tail = &stderr[stderr.rfind("time=")? + 5..];
    let token = tail.split_whitespace().next()?;
    let mut parts = token.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Строки stderr, которые не статистика: это ошибки и предупреждения декодера.
fn error_lines(stderr: &str) -> Vec<String> {
    stderr
        .split(|c| c == '\r' || c == '\n')
        .map(str::trim)
        .filter(|l| !l.is_empty() && !(l.contains("time=") && l.contains("bitrate=")))
        .map(String::from)
        .collect()
}

/// Прочитать файл до конца декодером и вернуть длительность. Ошибка, если файл не открылся,
/// декодер сообщил о повреждении или времени нет: такой кусок считается битым.
pub fn probe(ffmpeg: &Path, file: &Path) -> Result<f64, String> {
    let args: Vec<&std::ffi::OsStr> = vec![
        "-nostdin".as_ref(),
        "-hide_banner".as_ref(),
        "-v".as_ref(),
        "error".as_ref(),
        "-stats".as_ref(),
        "-i".as_ref(),
        file.as_os_str(),
        "-vn".as_ref(),
        "-f".as_ref(),
        "null".as_ref(),
        "-".as_ref(),
    ];
    let (ok, stderr) = run(ffmpeg, &args)?;
    let errors = error_lines(&stderr);
    if !ok || !errors.is_empty() {
        let first = errors.first().cloned().unwrap_or_else(|| "ffmpeg завершился с ошибкой".into());
        return Err(first);
    }
    last_time(&stderr).filter(|d| *d > 0.0).ok_or_else(|| "длительность не определена".to_string())
}

/// Склеить куски в один файл без перекодирования (тот же `concat` с `-c copy`, что и при
/// обычной остановке). Результат пишется в `out` как есть: подмену имени делает вызывающий.
pub fn concat_copy(ffmpeg: &Path, files: &[PathBuf], list_file: &Path, out: &Path) -> Result<(), String> {
    let mut list = String::new();
    for f in files {
        let abs = f.canonicalize().map_err(|e| format!("{}: {e}", f.display()))?;
        list.push_str(&format!("file '{}'\n", abs.display().to_string().replace('\'', "'\\''")));
    }
    std::fs::write(list_file, list).map_err(|e| format!("список для склейки: {e}"))?;
    let args: Vec<&std::ffi::OsStr> = vec![
        "-nostdin".as_ref(),
        "-hide_banner".as_ref(),
        "-v".as_ref(),
        "error".as_ref(),
        "-f".as_ref(),
        "concat".as_ref(),
        "-safe".as_ref(),
        "0".as_ref(),
        "-i".as_ref(),
        list_file.as_os_str(),
        "-c".as_ref(),
        "copy".as_ref(),
        "-y".as_ref(),
        "-f".as_ref(),
        "mp4".as_ref(),
        out.as_os_str(),
    ];
    let (ok, stderr) = run(ffmpeg, &args)?;
    if !ok {
        return Err(error_lines(&stderr).into_iter().next().unwrap_or_else(|| "ffmpeg завершился с ошибкой".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_time_reads_final_stats_line() {
        let s = "size=N/A time=00:00:12.50 bitrate=N/A speed= 300x\rsize=N/A time=00:29:00.02 bitrate=N/A speed=1e+03x\r\n";
        assert!((last_time(s).unwrap() - 1740.02).abs() < 1e-6);
        assert!(last_time("nothing").is_none());
        assert!(error_lines(s).is_empty());
        assert_eq!(error_lines("[mov] moov atom not found\n"), vec!["[mov] moov atom not found"]);
    }
}
