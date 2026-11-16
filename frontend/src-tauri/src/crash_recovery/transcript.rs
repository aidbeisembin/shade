//! Разбор `transcripts.json` после сбоя, в том числе обрезанного посередине.

use serde::Deserialize;
use std::path::Path;

/// Реплика в том виде, как её пишет `RecordingSaver` (`TranscriptSegment`). Все поля
/// необязательны: из повреждённого файла берём всё, что читается.
#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct Segment {
    pub id: String,
    pub text: String,
    pub audio_start_time: f64,
    pub audio_end_time: f64,
    pub duration: f64,
    pub display_time: String,
    pub sequence_id: u64,
}

#[derive(Debug, Clone, Default)]
pub struct Parsed {
    pub segments: Vec<Segment>,
    /// Файл прочитан не целиком (обрезан, битый JSON) или число реплик не сошлось с `total_segments`.
    pub damaged: bool,
}

#[derive(Deserialize)]
struct Whole {
    segments: Vec<Segment>,
    #[serde(default)]
    total_segments: Option<usize>,
}

/// Разобрать текст файла. Целый JSON берётся как есть; иначе из массива `segments`
/// читаются подряд все целые объекты до первого оборванного.
pub fn parse(raw: &str) -> Parsed {
    if let Ok(whole) = serde_json::from_str::<Whole>(raw) {
        let mismatch = whole.total_segments.map_or(false, |n| n != whole.segments.len());
        return Parsed { segments: whole.segments, damaged: mismatch };
    }
    Parsed { segments: salvage(raw), damaged: true }
}

fn salvage(raw: &str) -> Vec<Segment> {
    let Some(key) = raw.find("\"segments\"") else { return Vec::new() };
    let after = &raw[key + "\"segments\"".len()..];
    let Some(open) = after.find('[') else { return Vec::new() };
    let mut rest = &after[open + 1..];
    let mut out = Vec::new();
    loop {
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == ',');
        if rest.is_empty() || rest.starts_with(']') {
            break;
        }
        let mut stream = serde_json::Deserializer::from_str(rest).into_iter::<Segment>();
        match stream.next() {
            Some(Ok(seg)) => {
                let used = stream.byte_offset();
                out.push(seg);
                rest = &rest[used..];
            }
            _ => break,
        }
    }
    out
}

/// Прочитать лучшее из `transcripts.json` и `.transcripts.json.tmp` (обрыв между записью и
/// переименованием оставляет новую версию во временном файле): где реплик больше, то и берём.
pub fn load(folder: &Path) -> Parsed {
    let read = |name: &str| std::fs::read(folder.join(name)).ok().map(|b| parse(&String::from_utf8_lossy(&b)));
    let main = read("transcripts.json");
    let tmp = read(".transcripts.json.tmp");
    match (main, tmp) {
        (Some(m), Some(t)) if t.segments.len() > m.segments.len() => t,
        (Some(m), _) => m,
        (None, Some(t)) => t,
        (None, None) => Parsed::default(),
    }
}
