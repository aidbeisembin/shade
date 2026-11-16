// Язык интерфейса: русский по умолчанию, второй английский.
//
// Откуда берётся язык (сверху вниз, первый найденный):
//   1. ?lang=en|ru в адресе: язык этой вкладки, запоминается в sessionStorage
//      (router.push теряет query), сохранённый выбор в localStorage не трогает;
//   2. язык вкладки из sessionStorage (так ?lang переживает переходы);
//   3. язык сценария заглушек (?mock=demo-en кладёт его в sessionStorage, dev);
//   4. сохранённый выбор из «Настройки → Общие» (localStorage, ключ shade.lang);
//   5. русский.
// Переключатель в настройках пишет в localStorage и сбрасывает язык вкладки:
// явный выбор человека сильнее адреса.
//
// Это язык интерфейса. Язык речи для распознавания (primaryLanguage, system-language.ts)
// другая настройка и от этой не зависит.
//
// Единственное место, где пишутся коды локали (ru-RU, en-US): их проверяет
// scripts/check-i18n.mjs. Остальной код берёт locale() и форматирует через Intl.

import { useSyncExternalStore } from 'react';

export type Lang = 'ru' | 'en';

export const LANGS: readonly Lang[] = ['ru', 'en'];
export const DEFAULT_LANG: Lang = 'ru';

/** Сохранённый выбор (localStorage). Префикс shade. как у остальных ключей. */
export const LANG_KEY = 'shade.lang';
/** Язык этой вкладки: ?lang из адреса (sessionStorage). */
export const LANG_TAB_KEY = 'shade.lang.tab';
/** Язык сценария заглушек, пишет mock-tauri/install.ts (sessionStorage). */
export const LANG_DEMO_KEY = 'shade.lang.demo';

const LOCALES: Record<Lang, string> = { ru: 'ru-RU', en: 'en-US' };

export function parseLang(value: unknown): Lang | null {
  return value === 'ru' || value === 'en' ? value : null;
}

export interface LangSources {
  /** Значение ?lang из адреса. */
  url?: string | null;
  /** Язык вкладки (sessionStorage). */
  tab?: string | null;
  /** Язык сценария заглушек. */
  demo?: string | null;
  /** Сохранённый выбор (localStorage). */
  saved?: string | null;
}

/** Чистая функция выбора языка: что поверх чего, см. шапку файла. Мусор в источнике пропускается. */
export function resolveLang(s: LangSources): Lang {
  return parseLang(s.url) ?? parseLang(s.tab) ?? parseLang(s.demo) ?? parseLang(s.saved) ?? DEFAULT_LANG;
}

/** Код локали для Intl: ru-RU или en-US. */
export function localeOf(lang: Lang): string {
  return LOCALES[lang];
}

// ---------- хранилище ----------

let current: Lang = DEFAULT_LANG;
const listeners = new Set<() => void>();

function safe<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    // хранилище недоступно (приватный режим, запрет): живём в памяти
    return null;
  }
}

function readSources(): LangSources {
  if (typeof window === 'undefined') return {};
  const url = safe(() => new URLSearchParams(window.location.search).get('lang'));
  return {
    url,
    tab: safe(() => window.sessionStorage.getItem(LANG_TAB_KEY)),
    demo: safe(() => window.sessionStorage.getItem(LANG_DEMO_KEY)),
    saved: safe(() => window.localStorage.getItem(LANG_KEY)),
  };
}

function apply(next: Lang) {
  if (next === current) return;
  current = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((cb) => cb());
}

export function getLang(): Lang {
  return current;
}

/** Локаль текущего языка. */
export function locale(): string {
  return LOCALES[current];
}

export function subscribeLang(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Определяет язык на клиенте. Вызывать после гидратации (LangSync): на первом проходе
 * язык русский, как в статической выгрузке, иначе текст не совпал бы с разметкой.
 */
export function initLang(): Lang {
  const sources = readSources();
  const fromUrl = parseLang(sources.url);
  // ?lang запоминаем на вкладку: переходы внутри приложения теряют query
  if (fromUrl) safe(() => window.sessionStorage.setItem(LANG_TAB_KEY, fromUrl));
  apply(resolveLang(sources));
  return current;
}

/** Выбор человека (переключатель в настройках): запоминается и действует сразу, без перезапуска. */
export function setLang(next: Lang) {
  safe(() => window.localStorage.setItem(LANG_KEY, next));
  // адрес и вкладка больше не перебивают явный выбор
  safe(() => window.sessionStorage.removeItem(LANG_TAB_KEY));
  apply(next);
}

/** Язык сценария заглушек (mock-tauri/install.ts): null снимает его. Только для dev. */
export function setDemoLang(next: Lang | null) {
  if (next) safe(() => window.sessionStorage.setItem(LANG_DEMO_KEY, next));
  else safe(() => window.sessionStorage.removeItem(LANG_DEMO_KEY));
}

/** Другое окно приложения сменило язык: подхватываем, если вкладку не держит ?lang. */
export function onStorage(e: { key: string | null }) {
  if (e.key !== LANG_KEY && e.key !== null) return;
  apply(resolveLang(readSources()));
}

/**
 * Подписка компонента на смену языка. Любой .tsx, который берёт тексты из словаря
 * или форматирует числа и даты, вызывает useLang() и тем перерисовывается при смене.
 * Возвращает текущий язык.
 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, () => DEFAULT_LANG);
}

/** Только для тестов: вернуть хранилище в исходное состояние. */
export function resetLangForTests(next: Lang = DEFAULT_LANG) {
  current = next;
  listeners.clear();
}
