// Название встречи по сути разговора: чистая часть (без Tauri, без интерфейса), один файл
// на всё, что решает «годится ли ответ модели»: запрос, чистка, отказ от пустого и общего
// названия, язык, обрезка до 6 слов. Тесты: meeting-title.test.ts. Решения, кому и когда
// можно отправлять текст, лежат в title-service.ts; тексты запроса и образцы отбраковки
// (русские слова) в meeting-title-text.ts.
//
// Правило отказа одно: если ответ не годится, название встречи не меняется (остаётся
// дата), а причина идёт в журнал. Подбирать «почти подходящее» не пытаемся.

import {
  DEFAULT_TITLE_RE,
  FUNCTION_WORDS,
  GENERIC_STEMS,
  LABEL_RE,
  MAX_TITLE_WORDS_IN_NAME,
  MIN_TITLE_WORDS_IN_NAME,
  MONEY_RE,
  PROMPTS,
  REFUSAL_RE,
  type TitleLang,
} from './meeting-title-text';

export type { TitleLang } from './meeting-title-text';

/** Короче этого (в секундах) встреча названия не получает: в минуте нет темы, только проба микрофона. */
export const MIN_TITLE_SECONDS = 60;
/** Меньше слов в тексте встречи не из чего придумывать (после чистки галлюцинаций). */
export const MIN_TITLE_TEXT_WORDS = 20;
/** Сколько знаков расшифровки уходит в запрос: влезает в окно маленькой встроенной модели. */
export const PROMPT_TEXT_CHARS = 3000;
/** Название не длиннее этого (знаков): запасной предел после 6 слов. */
export const MAX_TITLE_CHARS = 60;

// --- название по умолчанию ----------------------------------------------------

/** Название придумало приложение при записи («Meeting 16_11_26_15_02_11», «Встреча 16 ноября, 15:02»). */
export function isDefaultTitle(title: string | null | undefined): boolean {
  const raw = (title ?? '').trim();
  return raw.length > 0 && raw.length <= 48 && DEFAULT_TITLE_RE.test(raw);
}

// --- язык встречи ---------------------------------------------------------------

const LETTERS = /\p{L}/gu;
const CYRILLIC = /\p{Script=Cyrillic}/gu;
const LATIN = /\p{Script=Latin}/gu;

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

/** Язык разговора по буквам расшифровки; если букв мало или поровну, запасной (язык интерфейса). */
export function detectMeetingLang(text: string, fallback: TitleLang): TitleLang {
  const letters = count(text, LETTERS);
  if (letters < 20) return fallback;
  const cyr = count(text, CYRILLIC);
  const lat = count(text, LATIN);
  if (cyr >= letters * 0.5) return 'ru';
  if (lat >= letters * 0.5) return 'en';
  return fallback;
}

// --- запрос ------------------------------------------------------------------------

/** Фрагменты расшифровки для запроса: начало, середина, конец, чтобы тема не терялась на длинной встрече. */
export function sampleTranscript(texts: string[], maxChars = PROMPT_TEXT_CHARS): string {
  const all = texts.map((x) => x.trim()).filter(Boolean).join(' ');
  if (all.length <= maxChars) return all;
  const part = Math.floor((maxChars - 10) / 3);
  const chunk = (from: number) => {
    // границы по пробелу: слово пополам не режем
    let start = from;
    if (start > 0) {
      const space = all.indexOf(' ', start);
      if (space !== -1) start = space + 1;
    }
    let end = Math.min(all.length, start + part);
    if (end < all.length) {
      const space = all.lastIndexOf(' ', end);
      if (space > start) end = space;
    }
    return all.slice(start, end).trim();
  };
  return [chunk(0), chunk(Math.floor(all.length / 2 - part / 2)), chunk(all.length - part)].join(' … ');
}

export interface TitlePrompt {
  system: string;
  user: string;
}

/** Запрос на языке встречи: требования к названию и фрагменты расшифровки. */
export function buildTitlePrompt(sample: string, lang: TitleLang): TitlePrompt {
  const p = PROMPTS[lang];
  return {
    system: p.system,
    user: [...p.rules, '', p.transcriptLabel, '<<<', sample.trim(), '>>>', '', p.answerLabel].join('\n'),
  };
}

// --- ответ модели ------------------------------------------------------------------

export type TitleReject = 'empty' | 'refusal' | 'too-short' | 'generic' | 'wrong-language' | 'money';

export type TitleCheck = { ok: true; title: string } | { ok: false; reason: TitleReject };

const QUOTES = /[«»"“”„‟″]/gu;
const EDGE_QUOTES = /^['‘’`]+|['‘’`]+$/gu;
const TRAILING_PUNCT = /[\s.,;:!?…–—\-]+$/u;
const LEADING_MARKS = /^[\s#>*\-–—•\d.)]+/u;
const THINK = /<think>[\s\S]*?<\/think>/giu;

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

const norm = (w: string) => w.toLowerCase().replace(/\u0451/g, String.fromCharCode(0x435)).replace(/[^\p{L}\p{N}]/gu, '');

/** Название ничего не говорит: все слова общие или служебные («Обсуждение», «Встреча по вопросам»). */
export function isGenericTitle(title: string, lang: TitleLang): boolean {
  const words = wordsOf(title).map(norm).filter(Boolean);
  if (words.length === 0) return true;
  const stems = GENERIC_STEMS[lang];
  const functional = FUNCTION_WORDS[lang];
  return words.every((w) => functional.includes(w) || stems.some((s) => w.startsWith(s)));
}

/** Название на языке встречи: русское с хотя бы одним русским словом, английское без кириллицы. */
function inLanguage(title: string, lang: TitleLang): boolean {
  const cyr = count(title, CYRILLIC);
  if (lang === 'en') return cyr === 0;
  const letters = count(title, LETTERS);
  return cyr >= 2 && cyr >= letters / 3;
}

/**
 * Ответ модели → название или причина отказа. Порядок: первая строка без разметки, меток и
 * кавычек; обрезка до 6 слов по границе слова (и до 60 знаков); хвостовые предлоги и знаки
 * убираются; заглавная буква; отказ от пустого, «не могу», слишком короткого, общего,
 * не на языке встречи и с суммой денег. Имена людей по ответу не распознать: их держит запрос.
 */
export function checkTitleAnswer(raw: string | null | undefined, lang: TitleLang): TitleCheck {
  const withoutThink = (raw ?? '').replace(THINK, ' ');
  const line = withoutThink
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !/^```/.test(l));
  if (!line) return { ok: false, reason: 'empty' };

  let text = line.replace(LEADING_MARKS, '').replace(LABEL_RE, '');
  if (REFUSAL_RE.test(text)) return { ok: false, reason: 'refusal' };
  text = text
    .replace(QUOTES, '')
    .replace(/[*_`~]+/g, '')
    .replace(EDGE_QUOTES, '')
    .replace(/\s+/g, ' ')
    .replace(TRAILING_PUNCT, '')
    .trim();
  if (!text) return { ok: false, reason: 'empty' };

  // деньги проверяем до обрезки: цифра суммы могла уйти в хвост, но модель её назвала
  if (MONEY_RE.test(text)) return { ok: false, reason: 'money' };

  let words = wordsOf(text).slice(0, MAX_TITLE_WORDS_IN_NAME);
  const functional = FUNCTION_WORDS[lang];
  const trim = () => {
    while (words.length > 0 && functional.includes(norm(words[words.length - 1]))) words.pop();
    if (words.length > 0) words[words.length - 1] = words[words.length - 1].replace(TRAILING_PUNCT, '');
  };
  trim();
  while (words.length > 1 && words.join(' ').length > MAX_TITLE_CHARS) {
    words.pop();
    trim();
  }
  words = words.filter(Boolean);
  if (words.length < MIN_TITLE_WORDS_IN_NAME) return { ok: false, reason: 'too-short' };

  const title = words.join(' ');
  if (isGenericTitle(title, lang)) return { ok: false, reason: 'generic' };
  if (!inLanguage(title, lang)) return { ok: false, reason: 'wrong-language' };
  return { ok: true, title: title.charAt(0).toUpperCase() + title.slice(1) };
}

// --- кому положено название --------------------------------------------------------

export interface TitleFacts {
  title: string;
  /** Секунды записи (длина звука или конец последней реплики); null, если неизвестно. */
  durationSec: number | null;
  /** Слова в тексте встречи без галлюцинаций. */
  words: number;
}

export type Ineligible = 'not-default' | 'too-short' | 'no-text';

/**
 * Автоматике положено только название по умолчанию у встречи от минуты с текстом.
 * `force` («Придумать заново» по нажатию): любое название и любая длина, нужен лишь текст.
 */
export function ineligibleReason(f: TitleFacts, force = false): Ineligible | null {
  if (!force && !isDefaultTitle(f.title)) return 'not-default';
  if (f.words < MIN_TITLE_TEXT_WORDS) return 'no-text';
  if (!force && !(typeof f.durationSec === 'number' && f.durationSec >= MIN_TITLE_SECONDS)) return 'too-short';
  return null;
}
