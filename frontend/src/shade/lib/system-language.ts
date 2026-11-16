// Язык встреч по умолчанию: язык интерфейса (русский), а не «Определять автоматически».
//
// Выбор хранит оригинальный ConfigContext в localStorage под ключом `primaryLanguage`
// (код ISO 639-1, 'auto' или 'auto-translate') и при монтировании сам отправляет его
// в ядро командой `set_language_preference`. Если ключа нет, человек язык не выбирал,
// и оригинал подставляет 'auto': Whisper тогда определяет язык заново на каждом
// куске речи и на фоне музыки уходит в чужие языки.
//
// Поэтому до первого рендера провайдеров (вызов на уровне модуля в app/layout.tsx)
// записываем в тот же ключ язык системы, если Whisper его знает. ConfigContext читает
// его в начальном состоянии и сам синхронизирует с ядром: один вызов команды, без
// гонки с синхронизацией оригинала. Сохранённый выбор, в том числе 'auto', не трогаем.

import { LANGUAGES } from '@/constants/languages';
import { defaultChoice } from '@/shade/lib/speech-settings';
import { DEFAULT_LANG, LANG_KEY } from '@/shade/lib/lang';

/** Ключ оригинала (contexts/ConfigContext.tsx), формат не меняем. */
const STORAGE_KEY = 'primaryLanguage';

/** Устаревшие и региональные коды, которые Whisper знает под другим именем. */
const ALIASES: Record<string, string> = { nb: 'no', nn: 'no', iw: 'he', in: 'id' };

const SUPPORTED = new Set(LANGUAGES.map((l) => l.code).filter((c) => c !== 'auto' && c !== 'auto-translate'));

/** Код языка системы, который знает Whisper, или null. */
export function systemLanguageCode(): string | null {
  if (typeof navigator === 'undefined') return null;
  const tags: string[] = [];
  // В WKWebView на macOS navigator.languages повторяет порядок языков системы
  if (Array.isArray(navigator.languages)) tags.push(...navigator.languages);
  if (navigator.language) tags.push(navigator.language);
  try {
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // Intl недоступен: остаёмся на navigator
  }
  for (const tag of tags) {
    const base = tag?.toLowerCase().split(/[-_]/)[0];
    if (!base) continue;
    const code = ALIASES[base] ?? base;
    // Первый язык системы решает: если Whisper его не знает, не подменяем его следующим
    return SUPPORTED.has(code) ? code : null;
  }
  return null;
}

/**
 * Если язык встреч ещё не выбран, ставит язык интерфейса (русский по умолчанию).
 * Вызывать до монтирования ConfigProvider. Возвращает записанный код или null.
 */
export function applySystemLanguageDefault(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    if (window.localStorage.getItem(STORAGE_KEY) !== null) return null;
    // Язык встреч по умолчанию: язык интерфейса (русскому интерфейсу «Русский с английскими
    // словами»); интерфейс по умолчанию русский, поэтому без выбора это тоже русский (speech-settings.ts)
    const code = defaultChoice(window.localStorage.getItem(LANG_KEY) ?? DEFAULT_LANG, systemLanguageCode());
    window.localStorage.setItem(STORAGE_KEY, code);
    console.info('[shade] Язык встреч по умолчанию:', code);
    return code;
  } catch {
    // localStorage недоступен: оригинал останется на 'auto'
    return null;
  }
}
