//! Надёжная запись файлов: после обрыва питания остаётся либо прежний файл, либо новый целиком.
//!
//! Порядок: временный файл рядом, запись, fsync файла, rename, fsync папки. Без fsync
//! rename может дойти до диска раньше данных, и после жёсткого выключения на месте
//! файла остаётся пустой или обрезанный. На macOS `File::sync_all` это `F_FULLFSYNC`
//! (до самого накопителя), около 8 мс на файл в 65 КБ.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Имя временного файла рядом с целевым: `.<имя>.tmp` (как было у `metadata.json` и `transcripts.json`).
pub fn temp_path(path: &Path) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!(".{}.tmp", name))
}

/// Записать файл целиком и надёжно. При любой ошибке (в том числе «нет места») прежний
/// файл остаётся как был, временный убирается.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = temp_path(path);
    let written = (|| -> io::Result<()> {
        let mut file = File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    if let Some(dir) = path.parent() {
        sync_dir(dir);
    }
    Ok(())
}

/// fsync папки: запись о новом имени файла тоже должна дойти до диска.
pub fn sync_dir(dir: &Path) {
    if let Ok(d) = File::open(dir) {
        let _ = d.sync_all();
    }
}

/// fsync файла, который записал не мы (ffmpeg).
pub fn sync_file(path: &Path) -> io::Result<()> {
    OpenOptions::new().read(true).open(path)?.sync_all()
}

/// Переименовать и сбросить запись о переименовании на диск.
pub fn rename_durable(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)?;
    if let Some(dir) = to.parent() {
        sync_dir(dir);
    }
    Ok(())
}
