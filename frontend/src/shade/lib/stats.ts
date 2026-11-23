// Анонимная статистика (Aptabase, регион EU). Три события, больше ничего:
//   app_started             запуск приложения, один раз за запуск
//   app_recording_started   началась запись
//   app_summary_ready       итоги, о которых человек попросил, готовы
// С каждым событием уходят версия Shade, macOS (по строке браузера окна; в WebKit она
// часто «unknown»), язык интерфейса и случайный номер сессии, живущий до закрытия приложения.
// Не уходят: звук, текст, названия и длительность встреч, имена файлов, идентификаторы
// устройства или человека. Выключается в Настройках → «Обратная связь»; выключено - не
// уходит ничего, в том числе запуск. Включено по умолчанию (решение владельца, 23.11.2026).
//
// Адрес: портфолио владельца пересылает /shade/e на Aptabase (next.config.ts в portfolio-site),
// поэтому в CSP окна (tauri.conf.json) ничего нового нет: aidbeisembin.com там уже разрешён.
// Отказ сети, CSP или Aptabase: событие теряется молча, повторов и очереди нет.
// В браузере на заглушках (?mock=) не уходит ничего.
'use client';

import { useSyncExternalStore } from 'react';
import { getLang } from './lang';
import { macosFromUserAgent } from './feedback/send';

export const STATS_URL = 'https://aidbeisembin.com/shade/e';
export const STATS_APP_KEY = 'A-EU-2286768688';
export const STATS_KEY = 'shade.stats.enabled';
export const STATS_TIMEOUT_MS = 8_000;

export const STATS_EVENTS = ['app_started', 'app_recording_started', 'app_summary_ready'] as const;
export type StatsEvent = (typeof STATS_EVENTS)[number];

export interface StatsDeps {
  fetch: (url: string, init: RequestInit) => Promise<unknown>;
  enabled: () => boolean;
  version: () => Promise<string>;
  userAgent: () => string;
  lang: () => string;
  now: () => Date;
  session: () => string;
  debug: () => boolean;
}

/** Тело запроса Aptabase (формат их SDK для веба, api/v0/event). */
export function statsBody(name: StatsEvent, version: string, deps: Pick<StatsDeps, 'userAgent' | 'lang' | 'now' | 'session' | 'debug'>) {
  return {
    timestamp: deps.now().toISOString(),
    sessionId: deps.session(),
    eventName: name,
    systemProps: { locale: deps.lang(), isDebug: deps.debug(), appVersion: version, sdkVersion: 'shade-stats@1' },
    props: { macos: macosFromUserAgent(deps.userAgent()) },
  };
}

/** Отправить событие. Выключено или событие не из списка: ничего. Ошибки не выходят наружу. */
export async function sendStat(name: StatsEvent, deps: StatsDeps): Promise<'sent' | 'off' | 'failed'> {
  if (!STATS_EVENTS.includes(name) || !deps.enabled()) return 'off';
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), STATS_TIMEOUT_MS) : null;
  try {
    const body = statsBody(name, await deps.version(), deps);
    await deps.fetch(STATS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'App-Key': STATS_APP_KEY },
      credentials: 'omit',
      body: JSON.stringify(body),
      signal: ctrl?.signal,
    });
    return 'sent';
  } catch {
    return 'failed';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------- Переключатель ----------

const listeners = new Set<() => void>();
function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
/** Включено, пока человек не выключил ('0'). */
export function statsEnabled(): boolean {
  return storage()?.getItem(STATS_KEY) !== '0';
}
export function setStatsEnabled(on: boolean) {
  try {
    storage()?.setItem(STATS_KEY, on ? '1' : '0');
  } catch (error) {
    console.warn('[shade] Статистика: переключатель не записан:', error);
  }
  listeners.forEach((fn) => fn());
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const useStatsEnabled = () => useSyncExternalStore(subscribe, statsEnabled, () => true);

// ---------- Настоящие зависимости ----------

function inMock(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { __SHADE_MOCK__?: unknown }).__SHADE_MOCK__);
}

const session = `${Math.floor(Date.now() / 1000)}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
let appVersion: string | null = null;

function realDeps(): StatsDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    enabled: statsEnabled,
    async version() {
      if (appVersion) return appVersion;
      try {
        appVersion = await (await import('@tauri-apps/api/app')).getVersion();
      } catch {
        appVersion = 'unknown';
      }
      return appVersion;
    },
    userAgent: () => (typeof navigator === 'undefined' ? '' : navigator.userAgent),
    lang: () => getLang(),
    now: () => new Date(),
    session: () => session,
    debug: () => process.env.NODE_ENV === 'development',
  };
}

/** Из окна: отправить событие в фоне. На заглушках и вне окна ничего. */
export function track(name: StatsEvent) {
  if (typeof window === 'undefined' || inMock()) return;
  void sendStat(name, realDeps());
}

let launched = false;
/** Один раз за запуск. */
export function trackLaunch() {
  if (launched) return;
  launched = true;
  track('app_started');
}
