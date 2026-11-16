//! Качество текста распознавания (Shade): служебные метки, язык реплики, «подозрительные» реплики.
//!
//! Зачем: Parakeet сам выбирает язык каждого куска речи и ошибается на коротких и
//! неразборчивых (польские и английские обрывки в русской встрече), а в слова
//! попадает служебная метка `<unk>` («Вс<unk>»). Здесь чистые функции без ввода-вывода:
//! их зовут живая запись, «Распознать заново», импорт и добор чистовика после «Стоп».
//!
//! Правила (подробно: `docs/ui/settings.md`, `docs/case/decisions.md`):
//! - служебные метки (`<unk>`, `<pad>`, `<s>` и подобные) в текст не попадают никогда;
//! - реплика на языке вне языков встречи в текст встречи не попадает (в журнал, без текста);
//! - при сомнении реплика остаётся: отбрасывается только то, что язык-вне-встречи по
//!   нескольким признакам сразу, а короткие и неразборчивые помечаются «подозрительными»
//!   для второго прохода, но не удаляются.

use std::collections::HashSet;

/// Язык реплики, как его видит чистка. Это не распознавание языка по звуку, а оценка текста.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    /// Кириллица (русский, в том числе с английскими терминами внутри).
    Ru,
    /// Латиница, узнаются английские служебные слова.
    En,
    /// Латиница, узнаются польские буквы или слова.
    Pl,
    /// Латиница, язык не узнан (одно-два слова вроде «Scour»).
    LatinOther,
    /// Другая письменность (иероглифы, арабица) или нет букв.
    Other,
}

/// Язык встречи из настроек: «Русский (с английскими словами)», «English», «Определять сам».
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MeetingLang {
    /// Код `ru`: русский, английские слова внутри фраз остаются.
    RuMixed,
    /// Код `en`.
    En,
    /// Код `auto` и `auto-translate`: язык не ограничен, ничего не отбрасывается по языку.
    Auto,
    /// Любой другой код ISO 639-1 из списка оригинала (`de`, `kk`): Whisper получает его,
    /// чистка по языку не отбрасывает (знаний о других алфавитах у неё нет).
    Other(String),
}

impl MeetingLang {
    /// Из значения настройки (`primaryLanguage` оригинала, команда `set_language_preference`).
    pub fn from_pref(code: Option<&str>) -> Self {
        match code.map(|c| c.trim().to_lowercase()).as_deref() {
            Some("ru") => MeetingLang::RuMixed,
            Some("en") => MeetingLang::En,
            None | Some("") | Some("auto") | Some("auto-translate") => MeetingLang::Auto,
            Some(other) => MeetingLang::Other(other.to_string()),
        }
    }

    /// Какой язык отдать Whisper: явный код или `None` (определять самому).
    pub fn whisper_code(&self) -> Option<String> {
        match self {
            MeetingLang::RuMixed => Some("ru".into()),
            MeetingLang::En => Some("en".into()),
            MeetingLang::Auto => None,
            MeetingLang::Other(c) => Some(c.clone()),
        }
    }

    /// Фильтр по языку включён.
    pub fn filters(&self) -> bool {
        matches!(self, MeetingLang::RuMixed | MeetingLang::En)
    }
}

/// Сколько слов должно быть в английской реплике, чтобы остаться в русской встрече.
/// Меньше: «What is it?», «Scour», «Okay»: обрывки, которые Parakeet дописывает на тишине
/// и музыке. Столько и больше при узнанных английских служебных словах: цитата или
/// фраза на английском целиком, её терять нельзя.
pub const EN_KEEP_MIN_WORDS: usize = 6;
/// Доля английских служебных слов, с которой латиница считается английским.
const EN_STOP_RATIO: f32 = 0.25;
/// Реплика из такого числа слов и короче считается «короткой» (кандидат на второй проход).
pub const SHORT_WORDS: usize = 3;
/// Ниже этой уверенности движок (если он её даёт) реплика подозрительна.
pub const LOW_CONFIDENCE: f32 = 0.4;

const SPECIAL_TOKENS: &[&str] = &["<unk>", "<pad>", "<s>", "</s>", "<blank>", "<eos>", "<bos>", "[unk]"];

/// Слова, из которых состоят короткие ответы русской речи. Реплика только из них
/// не «бессмыслица», а настоящий ответ («да», «угу»).
const RU_SHORT_OK: &[&str] = &[
    "да", "нет", "угу", "ага", "ну", "ок", "окей", "ладно", "хорошо", "понятно", "ясно", "так", "точно", "конечно",
    "спасибо", "привет", "пока", "давай", "отлично", "супер", "класс", "классно", "понял", "поняла", "согласен",
    "согласна", "здорово", "стоп", "да-да", "нет-нет", "ммм", "мм", "эм", "эээ", "аа", "а", "и", "о", "ой", "ах", "ох",
    "хм", "ладно-ладно", "верно", "правильно", "именно", "слушаю", "алло", "всё", "все", "да,", "вот", "итак",
    "смотри", "смотрите", "минуту", "секунду", "подожди", "подождите", "извини", "извините", "прости", "простите",
];

/// Короткие английские ответы, которые в русской встрече остаются как есть.
const EN_SHORT_OK: &[&str] = &["ok", "okay", "yes", "no", "hi", "hello", "bye", "thanks", "thank", "you", "wow", "cool", "nice", "sure", "great"];

const EN_STOP: &[&str] = &[
    "the", "is", "are", "was", "were", "be", "been", "am", "i", "i'm", "im", "you", "he", "she", "it", "we", "they", "my",
    "your", "his", "her", "our", "their", "this", "that", "these", "those", "and", "or", "but", "if", "so", "of", "to",
    "in", "on", "at", "for", "with", "from", "by", "about", "as", "do", "does", "did", "have", "has", "had", "will",
    "would", "can", "could", "should", "not", "no", "what", "which", "who", "when", "where", "why", "how", "going",
    "gonna", "just", "like", "really", "very", "there", "here", "me", "us", "them", "a", "an", "it's", "that's", "don't",
    "can't", "let's", "okay", "yeah", "thank", "please", "practice", "know", "think", "want", "need",
];

/// Польские слова, которых нет в английском и русском (латиницей). Дополняют польские буквы.
const PL_STOP: &[&str] = &[
    "się", "nie", "jest", "że", "dla", "ale", "już", "czy", "jak", "tak", "ten", "tego", "który", "która", "bardzo",
    "tylko", "proszę", "dzięki", "dobrze", "dobra", "dobrze", "więc", "po", "przez", "też", "mam", "masz", "jestem",
    "żeby", "będzie", "było", "tutaj", "teraz", "dziękuję", "cześć", "no", "to", "ja", "ty", "my", "wy", "co", "gdzie",
    "kiedy", "dlaczego", "jeszcze", "wszystko", "nic", "coś", "mnie", "ciebie", "naprawdę", "ponieważ", "dobry",
];

const PL_LETTERS: &[char] = &['ą', 'ć', 'ę', 'ł', 'ń', 'ś', 'ź', 'ż'];

/// Результат чистки одной реплики.
#[derive(Debug, Clone, PartialEq)]
pub struct Cleaned {
    /// Текст без служебных меток, с одиночными пробелами.
    pub text: String,
    /// Метки были (слово могло быть повреждено: реплика подозрительна).
    pub had_special: bool,
}

/// Убирает служебные метки. Метка внутри слова склеивает его части («Вс<unk>ё» → «Всё»),
/// метка между словами просто пропадает, пробелы схлопываются.
pub fn strip_special(text: &str) -> Cleaned {
    let mut out = text.to_string();
    let mut had = false;
    for tok in SPECIAL_TOKENS {
        // Без учёта регистра: «<UNK>» тоже метка
        loop {
            let lower = out.to_lowercase();
            let Some(idx) = lower.find(tok) else { break };
            // to_lowercase может сдвинуть байты у экзотических символов: ищем по символам
            if lower.len() != out.len() {
                out = out.replace(tok, "");
                had = true;
                break;
            }
            out.replace_range(idx..idx + tok.len(), "");
            had = true;
        }
    }
    // Пробелы и пробел перед знаками препинания после выпавшей метки
    let mut collapsed = String::with_capacity(out.len());
    let mut prev_space = true;
    for ch in out.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                collapsed.push(' ');
            }
            prev_space = true;
        } else {
            if matches!(ch, '.' | ',' | '!' | '?' | ';' | ':') && collapsed.ends_with(' ') && had {
                collapsed.pop();
            }
            collapsed.push(ch);
            prev_space = false;
        }
    }
    Cleaned { text: collapsed.trim().to_string(), had_special: had }
}

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !(c.is_alphabetic() || c == '\'' || c == '’' || c == '-' || c.is_numeric()))
        .map(|w| w.trim_matches(|c: char| c == '\'' || c == '’' || c == '-').to_string())
        .filter(|w| !w.is_empty())
        .collect()
}

/// Число слов реплики.
pub fn word_count(text: &str) -> usize {
    words(text).len()
}

fn is_cyrillic(c: char) -> bool {
    ('\u{0400}'..='\u{052F}').contains(&c)
}

fn is_latin(c: char) -> bool {
    c.is_alphabetic() && (c.is_ascii_alphabetic() || ('\u{00C0}'..='\u{024F}').contains(&c))
}

/// Определяет язык текста реплики по письменности и служебным словам.
pub fn detect_lang(text: &str) -> Lang {
    let ws = words(text);
    let letters: Vec<char> = text.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.is_empty() {
        return Lang::Other;
    }
    let cyr_words = ws.iter().filter(|w| w.chars().any(is_cyrillic)).count();
    if cyr_words > 0 && (cyr_words as f32 / ws.len().max(1) as f32) >= 0.34 {
        return Lang::Ru;
    }
    let latin = letters.iter().filter(|c| is_latin(**c)).count();
    let cyr = letters.iter().filter(|c| is_cyrillic(**c)).count();
    if cyr > latin {
        return Lang::Ru;
    }
    if latin * 2 < letters.len() {
        return Lang::Other;
    }
    let lower = text.to_lowercase();
    let low_words: Vec<String> = words(&lower);
    let pl_letters = lower.chars().any(|c| PL_LETTERS.contains(&c));
    let pl_set: HashSet<&str> = PL_STOP.iter().copied().collect();
    let en_set: HashSet<&str> = EN_STOP.iter().copied().collect();
    let n = low_words.len().max(1) as f32;
    let pl_hits = low_words.iter().filter(|w| pl_set.contains(w.as_str()) && !en_set.contains(w.as_str())).count();
    let en_hits = low_words.iter().filter(|w| en_set.contains(w.as_str())).count();
    if pl_letters || (pl_hits > 0 && pl_hits >= en_hits) {
        return Lang::Pl;
    }
    if (en_hits as f32 / n) >= EN_STOP_RATIO {
        return Lang::En;
    }
    Lang::LatinOther
}

/// Реплика целиком из коротких ответов (русских или английских), без смысловой нагрузки.
fn is_short_ack(words: &[String]) -> bool {
    !words.is_empty()
        && words.iter().all(|w| {
            let l = w.to_lowercase();
            RU_SHORT_OK.contains(&l.as_str()) || EN_SHORT_OK.contains(&l.as_str())
        })
}

/// Слово похоже на аббревиатуру или имя собственное: `PR`, `API`, `GitHub`, `iOS`.
fn looks_like_term(w: &str) -> bool {
    let letters: Vec<char> = w.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.len() < 2 || !letters.iter().all(|c| is_latin(*c)) {
        return false;
    }
    let upper = letters.iter().filter(|c| c.is_uppercase()).count();
    // PR, API, SaaS (две заглавных и больше), iOS; «Scour» (одна заглавная в начале) не термин
    upper >= 2
}

/// Фразы, которые Whisper дописывает на тишине и музыке (следы обучающих субтитров).
/// Реплика целиком из такой фразы не текст встречи.
const HALLUCINATIONS: &[&str] = &[
    "субтитры сделал",
    "субтитры создавал",
    "субтитры подогнал",
    "редактор субтитров",
    "корректор",
    "продолжение следует",
    "спасибо за просмотр",
    "подписывайтесь на канал",
    "thanks for watching",
    "thank you for watching",
    "subtitles by",
    "dimatorzok",
];

/// Реплика состоит из известной «галлюцинации» второго распознавания.
pub fn is_known_hallucination(text: &str) -> bool {
    let low = text.to_lowercase();
    HALLUCINATIONS.iter().any(|h| low.contains(h)) && word_count(&low) <= 12
}

/// Множество слов из словаря «Частые слова» в нижнем регистре.
pub fn dictionary_set(dictionary: &[String]) -> HashSet<String> {
    dictionary
        .iter()
        .flat_map(|w| words(w))
        .map(|w| w.to_lowercase())
        .collect()
}

/// Почему реплику стоит распознать второй раз (чистовик гибрида).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    /// Язык вне языков встречи.
    Language,
    /// В реплике была служебная метка.
    SpecialToken,
    /// Одно-три слова, не похожие на настоящий короткий ответ.
    ShortNonsense,
    /// Движок сам сомневается (если даёт уверенность).
    LowConfidence,
}

/// Вердикт по реплике.
#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub text: String,
    pub lang: Lang,
    pub words: usize,
    /// Показывать как текст встречи.
    pub keep: bool,
    pub reasons: Vec<Reason>,
}

/// Проверка реплики: очистка, язык, решение «показывать или нет», причины подозрения.
///
/// Решение `keep` (в текст встречи) и список `reasons` (стоит перераспознать) независимы:
/// короткая «бессмыслица» остаётся в тексте (при сомнении данные сохраняются), но
/// попадает в второй проход; а реплика на польском не показывается и тоже идёт во второй проход,
/// чтобы Whisper с языком встречи мог вернуть настоящий текст на её месте.
pub fn check(raw: &str, meeting: &MeetingLang, dictionary: &HashSet<String>, confidence: Option<f32>) -> Verdict {
    let cleaned = strip_special(raw);
    let text = cleaned.text;
    let ws = words(&text);
    let lang = detect_lang(&text);
    let n = ws.len();
    let mut reasons = Vec::new();
    let mut keep = !text.is_empty();

    if cleaned.had_special {
        reasons.push(Reason::SpecialToken);
    }

    if keep && meeting.filters() {
        let allowed = match (meeting, lang) {
            (MeetingLang::RuMixed, Lang::Ru) => true,
            (MeetingLang::En, Lang::En) => true,
            // Английская реплика в русской встрече: остаётся, если это фраза целиком
            (MeetingLang::RuMixed, Lang::En) => n >= EN_KEEP_MIN_WORDS || is_short_ack(&ws),
            // Латиница без узнанного языка: только слова из словаря, аббревиатуры и короткие ответы
            (_, Lang::LatinOther) => {
                is_short_ack(&ws)
                    || ws.iter().all(|w| dictionary.contains(&w.to_lowercase()) || looks_like_term(w))
            }
            // Английский в английской встрече и русский в английской: кириллица в «English» встрече
            // не отбрасывается по языку (двуязычная речь), остаётся
            (MeetingLang::En, Lang::Ru) => true,
            _ => false,
        };
        if !allowed {
            keep = false;
            reasons.push(Reason::Language);
        }
    }

    if !text.is_empty() && n <= SHORT_WORDS && !is_short_ack(&ws) && lang != Lang::Other {
        let all_dict = ws.iter().all(|w| dictionary.contains(&w.to_lowercase()) || looks_like_term(w));
        if !all_dict && !reasons.contains(&Reason::Language) {
            reasons.push(Reason::ShortNonsense);
        }
    }
    if let Some(c) = confidence {
        if c < LOW_CONFIDENCE && !text.is_empty() {
            reasons.push(Reason::LowConfidence);
        }
    }
    Verdict { text, lang, words: n, keep, reasons }
}

/// Итог чистки реплики перед тем, как она станет текстом встречи.
#[derive(Debug, Clone, PartialEq)]
pub struct Finalized {
    /// Текст встречи; пусто: реплику показывать не нужно.
    pub text: String,
    /// Отброшена потому, что язык вне языков встречи или это «галлюцинация» распознавания.
    pub dropped: bool,
    /// Реплика осталась, но стоит её перераспознать (короткая, были метки).
    pub suspicious: bool,
}

/// Всё, что делается с текстом реплики между движком и текстом встречи: метки, язык,
/// «галлюцинации», написание слов словаря. Один вход для живой записи, «Распознать заново»
/// и импорта. В журнал идёт только причина и число слов, текст реплики не пишется.
pub fn finalize_text(raw: &str, meeting: &MeetingLang, dictionary: &[String], confidence: Option<f32>) -> Finalized {
    if raw.trim().is_empty() {
        return Finalized { text: String::new(), dropped: false, suspicious: false };
    }
    let dict = dictionary_set(dictionary);
    let v = check(raw, meeting, &dict, confidence);
    if v.text.is_empty() {
        log::info!("[shade] реплика из одних служебных меток отброшена");
        return Finalized { text: String::new(), dropped: true, suspicious: false };
    }
    if is_known_hallucination(&v.text) {
        log::info!("[shade] реплика-галлюцинация отброшена ({} слов)", v.words);
        return Finalized { text: String::new(), dropped: true, suspicious: false };
    }
    if !v.keep {
        log::info!("[shade] реплика вне языка встречи отброшена: язык {:?}, слов {}", v.lang, v.words);
        return Finalized { text: String::new(), dropped: true, suspicious: false };
    }
    Finalized { text: apply_dictionary_case(&v.text, dictionary), dropped: false, suspicious: !v.reasons.is_empty() }
}

/// Живая запись: язык и слова, действующие для идущей записи.
pub fn finalize_live(raw: &str, confidence: Option<f32>) -> Finalized {
    let meeting = MeetingLang::from_pref(crate::get_language_preference_internal().as_deref());
    finalize_text(raw, &meeting, &crate::get_vocabulary_internal(), confidence)
}

/// Пакетные задачи («Распознать заново», импорт): язык и слова по настройке на сейчас.
/// `language`: язык, который задан задаче явно, иначе настройка.
pub fn finalize_batch(raw: &str, language: Option<&str>, confidence: Option<f32>) -> Finalized {
    let pref = language.map(|l| l.to_string()).or_else(crate::get_language_setting_now);
    let meeting = MeetingLang::from_pref(pref.as_deref());
    finalize_text(raw, &meeting, &crate::get_vocabulary_setting_now(), confidence)
}

/// Приводит написание слов из словаря к виду из словаря: «figma» → «Figma», «github» → «GitHub».
/// Только латиница и только целые слова, остальной текст не трогается.
pub fn apply_dictionary_case(text: &str, dictionary: &[String]) -> String {
    let terms: Vec<String> = dictionary
        .iter()
        .flat_map(|t| words(t))
        .filter(|w| w.chars().all(|c| is_latin(c) || c.is_numeric() || c == '-'))
        .collect();
    if terms.is_empty() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut cur = String::new();
    let flush = |cur: &mut String, out: &mut String| {
        if cur.is_empty() {
            return;
        }
        let low = cur.to_lowercase();
        match terms.iter().find(|t| t.to_lowercase() == low) {
            Some(t) => out.push_str(t),
            None => out.push_str(cur),
        }
        cur.clear();
    };
    for ch in text.chars() {
        if is_latin(ch) || ch.is_numeric() || ch == '-' {
            cur.push(ch);
        } else {
            flush(&mut cur, &mut out);
            out.push(ch);
        }
    }
    flush(&mut cur, &mut out);
    out
}

/// Подсказка Whisper (`initial_prompt`): словарь через запятую в начале связной русской фразы.
/// Пусто, если словаря нет: пустая подсказка не передаётся (её отсутствие не вредит).
/// Лимит whisper.cpp на подсказку около 224 токенов, режем по словам с запасом.
pub fn build_initial_prompt(dictionary: &[String], meeting: &MeetingLang) -> Option<String> {
    let terms: Vec<&str> = dictionary.iter().map(|t| t.trim()).filter(|t| !t.is_empty()).collect();
    let mut joined = String::new();
    for t in terms {
        if joined.chars().count() + t.chars().count() + 2 > 480 {
            break;
        }
        if !joined.is_empty() {
            joined.push_str(", ");
        }
        joined.push_str(t);
    }
    if joined.is_empty() {
        return None;
    }
    Some(match meeting {
        MeetingLang::En => format!("Meeting notes. Terms: {}.", joined),
        _ => format!("Рабочая встреча. Термины: {}.", joined),
    })
}

/// Разбор поля «Частые слова»: через запятую, точку с запятой и перевод строки.
pub fn parse_dictionary(raw: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    raw.split(|c| c == ',' || c == ';' || c == '\n')
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty() && t.chars().count() <= 60)
        .filter(|t| seen.insert(t.to_lowercase()))
        .take(80)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dict(words: &[&str]) -> HashSet<String> {
        dictionary_set(&words.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    fn ru() -> MeetingLang {
        MeetingLang::RuMixed
    }

    // Случай «<unk>» в начале, в середине и в конце слова, и отдельным словом
    #[test]
    fn unk_at_start_middle_end_and_alone() {
        assert_eq!(strip_special("<unk>ешь это").text, "ешь это");
        assert_eq!(strip_special("Вс<unk>ё готово").text, "Всё готово");
        assert_eq!(strip_special("Вс<unk>").text, "Вс");
        assert_eq!(strip_special("давай <unk> сделаем").text, "давай сделаем");
        assert_eq!(strip_special("<unk>").text, "");
        assert!(strip_special("Вс<unk>").had_special);
        assert!(!strip_special("Всё").had_special);
        assert_eq!(strip_special("слово <UNK>, дальше").text, "слово, дальше");
        assert_eq!(strip_special("a<unk><unk>b").text, "ab");
    }

    #[test]
    fn unk_never_survives_check() {
        let v = check("Вс<unk>ё <unk> готово <unk>", &ru(), &dict(&[]), None);
        assert!(!v.text.contains("unk"));
        assert!(v.reasons.contains(&Reason::SpecialToken));
        assert!(v.keep);
    }

    // Случай «да» / «угу»: короткий настоящий ответ остаётся и не подозрителен
    #[test]
    fn short_replies_stay_and_are_not_suspicious() {
        for s in ["Да.", "угу", "Угу, да", "Ага", "Ну да", "Ок"] {
            let v = check(s, &ru(), &dict(&[]), None);
            assert!(v.keep, "{s}");
            assert!(v.reasons.is_empty(), "{s}: {:?}", v.reasons);
        }
    }

    // Случай «бессмыслица из 1-3 слов»: остаётся (данные сохраняются), но идёт на второй проход
    #[test]
    fn short_nonsense_is_kept_but_suspicious() {
        let v = check("Дворец шейх", &ru(), &dict(&[]), None);
        assert!(v.keep);
        assert!(v.reasons.contains(&Reason::ShortNonsense));
    }

    // Случай «польская реплика»
    #[test]
    fn polish_is_dropped_in_russian_meeting() {
        let v = check("Dwijm się dań", &ru(), &dict(&[]), None);
        assert_eq!(v.lang, Lang::Pl);
        assert!(!v.keep);
        assert!(v.reasons.contains(&Reason::Language));
        let v2 = check("Dziękuję bardzo za uwagę", &ru(), &dict(&[]), None);
        assert!(!v2.keep);
    }

    // Случай «реплика целиком на английском во встрече с языком Русский (с английскими словами)»
    #[test]
    fn english_only_replica_in_russian_meeting() {
        // Обрывок: не показываем
        assert!(!check("What is it?", &ru(), &dict(&[]), None).keep);
        assert!(!check("Scour", &ru(), &dict(&[]), None).keep);
        // Фраза целиком (6 слов и больше при узнанном английском): оставляем
        let long = check("I'm going to practice it every single day", &ru(), &dict(&[]), None);
        assert_eq!(long.lang, Lang::En);
        assert!(long.keep);
        // Пять слов уже подозрительны: не оставляем (граница EN_KEEP_MIN_WORDS)
        assert!(!check("I'm going to practice it", &ru(), &dict(&[]), None).keep);
    }

    // Случай «англицизм внутри фразы»
    #[test]
    fn anglicism_inside_russian_phrase_is_kept() {
        for s in [
            "Сделай пуш и открой PR до обеда",
            "Макет в Figma обновили, нужен бизнес-эффект",
            "Давай в Slack напишем",
        ] {
            let v = check(s, &ru(), &dict(&[]), None);
            assert_eq!(v.lang, Lang::Ru, "{s}");
            assert!(v.keep, "{s}");
        }
    }

    #[test]
    fn latin_terms_from_dictionary_and_acronyms_survive() {
        assert!(check("Figma", &ru(), &dict(&["Figma"]), None).keep);
        assert!(check("PR", &ru(), &dict(&[]), None).keep);
        assert!(!check("Figma", &ru(), &dict(&[]), None).keep);
        assert!(check("ok", &ru(), &dict(&[]), None).keep);
    }

    #[test]
    fn auto_language_filters_nothing() {
        let v = check("Dwijm się dań", &MeetingLang::Auto, &dict(&[]), None);
        assert!(v.keep);
        let v = check("Scour", &MeetingLang::from_pref(Some("de")), &dict(&[]), None);
        assert!(v.keep);
    }

    #[test]
    fn english_meeting_keeps_english_drops_polish() {
        let en = MeetingLang::En;
        assert!(check("What is it?", &en, &dict(&[]), None).keep);
        assert!(check("Это нормально, давай продолжим", &en, &dict(&[]), None).keep);
        assert!(!check("Dziękuję bardzo", &en, &dict(&[]), None).keep);
    }

    #[test]
    fn low_confidence_is_suspicious_only_when_engine_gives_it() {
        let v = check("нормальная длинная фраза про планы на неделю", &ru(), &dict(&[]), Some(0.2));
        assert!(v.reasons.contains(&Reason::LowConfidence));
        let v = check("нормальная длинная фраза про планы на неделю", &ru(), &dict(&[]), None);
        assert!(v.reasons.is_empty());
    }

    #[test]
    fn pref_codes_map_to_policy() {
        assert_eq!(MeetingLang::from_pref(Some("ru")), MeetingLang::RuMixed);
        assert_eq!(MeetingLang::from_pref(Some("en")), MeetingLang::En);
        assert_eq!(MeetingLang::from_pref(Some("auto")), MeetingLang::Auto);
        assert_eq!(MeetingLang::from_pref(Some("auto-translate")), MeetingLang::Auto);
        assert_eq!(MeetingLang::from_pref(None), MeetingLang::Auto);
        assert_eq!(MeetingLang::RuMixed.whisper_code().as_deref(), Some("ru"));
        assert_eq!(MeetingLang::Auto.whisper_code(), None);
    }

    #[test]
    fn known_hallucinations_are_recognized() {
        assert!(is_known_hallucination("Продолжение следует..."));
        assert!(is_known_hallucination("Субтитры сделал DimaTorzok"));
        assert!(!is_known_hallucination("Давай продолжим, это следует сделать завтра"));
    }

    #[test]
    fn dictionary_case_and_prompt() {
        let d = vec!["Figma".to_string(), "GitHub".to_string(), "бизнес-эффект".to_string()];
        assert_eq!(apply_dictionary_case("открой figma и github.", &d), "открой Figma и GitHub.");
        assert_eq!(apply_dictionary_case("фигма", &d), "фигма");
        let p = build_initial_prompt(&d, &ru()).unwrap();
        assert!(p.contains("Figma, GitHub, бизнес-эффект"));
        assert!(build_initial_prompt(&[], &ru()).is_none());
        assert_eq!(parse_dictionary(" Figma, github ;\n Figma, , Slack"), vec!["Figma", "github", "Slack"]);
    }
}
