// Настройки распознавания Shade: «Язык встреч» и «Частые слова».
//
// Язык встреч хранится там же, где его хранит оригинал: localStorage `primaryLanguage` и
// команда ядра `set_language_preference` (ConfigContext.setSelectedLanguage). Формат тот же:
// `ru`, `en`, `auto`. Три пункта выбора ложатся на коды так: «Русский (с английскими
// словами)» это `ru`, «English» это `en`, «Определять сам» это `auto`. Ядро по `ru` и `en`
// ещё и отбрасывает реплики на чужих языках (src-tauri audio/transcript_quality.rs).
// Другие коды оригинала (`de`, `auto-translate`) остаются работать, но в Shade не предлагаются:
// если человек выбрал их раньше, выбор показывается и не теряется.
//
// «Частые слова» хранятся в localStorage `shade.speech.words` одной строкой, как ввёл человек,
// и уходят в ядро командой `set_vocabulary_hint` при запуске и при правке. Изменение во время
// записи ядро откладывает до следующей встречи.

import { invoke } from '@tauri-apps/api/core';

export const WORDS_KEY = 'shade.speech.words';
/** Те же пределы, что в ядре (parse_dictionary). */
export const MAX_WORDS = 80;
export const MAX_WORD_LEN = 60;

export type LangChoice = 'ru' | 'en' | 'auto';
export const LANG_CHOICES: readonly LangChoice[] = ['ru', 'en', 'auto'];

/** Код `primaryLanguage` в пункт выбора; `null`, если это не один из трёх (старый выбор). */
export function choiceOf(code: string | null | undefined): LangChoice | null {
  if (code === 'ru' || code === 'en' || code === 'auto') return code;
  return null;
}

/**
 * Язык встреч по умолчанию, пока человек его не выбирал. Русскому интерфейсу достаётся
 * «Русский (с английскими словами)», английскому «English»; без выбора интерфейса язык
 * системы (любой, который знает Whisper), а если и его нет, русский.
 */
export function defaultChoice(interfaceLang: string | null | undefined, systemLang: string | null | undefined): string {
  if (interfaceLang === 'ru' || interfaceLang === 'en') return interfaceLang;
  return systemLang || 'ru';
}

/** Разбор поля «Частые слова»: запятая, точка с запятой, перевод строки; без повторов. */
export function parseWords(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[,;\n]/)) {
    const word = piece.trim();
    if (!word || [...word].length > MAX_WORD_LEN) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

export function readWords(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(WORDS_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Сохраняет слова и отправляет в ядро. Возвращает число слов после разбора. */
export async function saveWords(raw: string): Promise<number> {
  try {
    window.localStorage.setItem(WORDS_KEY, raw);
  } catch {
    // localStorage недоступен: слова останутся только до закрытия окна, ядру отправим всё равно
  }
  await sendWords(raw);
  return parseWords(raw).length;
}

async function sendWords(raw: string): Promise<void> {
  await invoke('set_vocabulary_hint', { words: parseWords(raw).join(', ') });
}

/** При запуске: отдать ядру сохранённые слова. Ошибку только в журнал, запуск не ломается. */
export function syncWordsToCore(): void {
  const raw = readWords();
  if (!raw.trim()) return;
  sendWords(raw).catch((error) => console.warn('[shade] слова для распознавания не переданы ядру:', error));
}
