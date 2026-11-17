// Обратная связь: хранение и связь со страницами. Правила в policy.ts, отправка в send.ts.
// Ключи localStorage (новые, префикс shade.):
//   shade.feedback.prompt.v1  когда спрашивать: завершённые встречи, последний показ, закрытия, оценка;
//   shade.feedback.ask        переключатель «Иногда спрашивать оценку» ('0' выключен, по умолчанию включён);
//   shade.feedback.queue.v1   очередь неотправленных отзывов (send.ts).
// Хранилище недоступно: карточка не показывается (не можем запомнить показ, значит не спрашиваем).
'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getLang } from '@/shade/lib/lang';
import { clampText, type FeedbackPayload } from './contract';
import {
  EMPTY_PROMPT,
  markCompleted,
  markDismissed,
  markRated,
  markShown,
  OFFER_DELAY_MS,
  offerVerdict,
  parsePrompt,
  unmarkCompleted,
  type OfferContext,
  type OfferVerdict,
  type PromptState,
} from './policy';
import { flushQueue, macosFromUserAgent, sendFeedback, type SendDeps, type SendResult } from './send';

export const PROMPT_KEY = 'shade.feedback.prompt.v1';
export const ASK_KEY = 'shade.feedback.ask';
export const GITHUB_URL = 'https://github.com/katanana23/shade';

const storage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let cache: { raw: string | null; state: PromptState } | null = null;

export function readPrompt(): PromptState {
  const raw = storage()?.getItem(PROMPT_KEY) ?? null;
  if (cache && cache.raw === raw) return cache.state;
  cache = { raw, state: parsePrompt(raw) };
  return cache.state;
}

function updatePrompt(fn: (s: PromptState) => PromptState): boolean {
  const st = storage();
  if (!st) return false;
  try {
    st.setItem(PROMPT_KEY, JSON.stringify(fn(readPrompt())));
    emit();
    return true;
  } catch (error) {
    console.warn('[shade] Отзыв: состояние не записано:', error);
    return false;
  }
}

export const noteMeetingCompleted = (id: string) => void updatePrompt((s) => markCompleted(s, id));
export const noteMeetingUncounted = (id: string) => void updatePrompt((s) => unmarkCompleted(s, id));
export const noteDismissed = () => void updatePrompt(markDismissed);
export const noteRated = () => void updatePrompt((s) => markRated(s, Date.now()));
/** Показ записан: только тогда карточка встаёт (не записали, не показываем: иначе спросим снова). */
export const noteShown = () => updatePrompt((s) => markShown(s, Date.now()));

export function askEnabled(): boolean {
  return storage()?.getItem(ASK_KEY) !== '0';
}
export function setAskEnabled(on: boolean) {
  try {
    storage()?.setItem(ASK_KEY, on ? '1' : '0');
  } catch (error) {
    console.warn('[shade] Отзыв: переключатель не записан:', error);
  }
  emit();
}
export const useAskEnabled = () => useSyncExternalStore(subscribe, askEnabled, () => true);

// ---------- Предложение: какая встреча сейчас просит карточку ----------

let offered: string | null = null;
const offerListeners = new Set<() => void>();
const subscribeOffer = (l: () => void) => {
  offerListeners.add(l);
  return () => offerListeners.delete(l);
};
const setOffered = (id: string | null) => {
  if (offered === id) return;
  offered = id;
  offerListeners.forEach((l) => l());
};
/** id встречи, для которой стоит карточка, или null. Читает док (RecordDock). */
export const useOfferedMeeting = () =>
  useSyncExternalStore(
    subscribeOffer,
    () => offered,
    () => null,
  );
/** Карточку закрыли или страница ушла: предложения больше нет. */
export const clearOffer = () => setOffered(null);

/**
 * Страница встречи сообщает, что человек видит итоги. Решение по правилам (policy.ts); «offer» ставит
 * карточку в док и записывает показ. Возвращает решение (журнал, тесты).
 */
export function considerOffer(ctx: Omit<OfferContext, 'askEnabled' | 'now'>): OfferVerdict {
  if (!storage()) return 'off';
  const verdict = offerVerdict(readPrompt(), {
    ...ctx,
    askEnabled: askEnabled(),
    now: Date.now(),
  });
  if (verdict === 'offer' && offered !== ctx.meetingId) {
    if (!noteShown()) return 'off';
    console.info('[shade] Отзыв: карточка «Как вам Shade?» для встречи', ctx.meetingId);
    setOffered(ctx.meetingId);
  }
  return verdict;
}

/**
 * Страница встречи: итоги видны дольше OFFER_DELAY_MS, тогда спрашиваем правила (сначала человек
 * видит итоги, карточка не прыгает навстречу открытию страницы). Ушли со страницы раньше: ничего.
 */
export function useFeedbackOffer(ctx: Omit<OfferContext, 'askEnabled' | 'now'> & { trashed?: boolean }) {
  const { meetingId, summaryReady, recovered, recording, durationSec, trashed } = ctx;
  useEffect(() => {
    if (!meetingId || !summaryReady || recording || recovered || trashed) return;
    const id = setTimeout(() => {
      const verdict = considerOffer({
        meetingId,
        summaryReady,
        recovered,
        recording,
        durationSec,
      });
      if (verdict !== 'offer') console.debug('[shade] Отзыв: карточку не показываю:', verdict);
    }, OFFER_DELAY_MS);
    return () => clearTimeout(id);
  }, [meetingId, summaryReady, recovered, recording, durationSec, trashed]);
}

// ---------- Отправка ----------

function inMock(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { __SHADE_MOCK__?: unknown }).__SHADE_MOCK__);
}

/**
 * Заглушки в браузере: в сеть не ходим. ?feedback=ok (по умолчанию), 503 (функция не настроена),
 * offline (нет сети), 400 (тело отвергнуто). Только для разработки и снимков.
 */
function mockFetch(): SendDeps['fetch'] {
  const mode = new URLSearchParams(window.location.search).get('feedback') ?? 'ok';
  return async () => {
    await new Promise((r) => setTimeout(r, 700));
    if (mode === 'offline') throw new TypeError('Failed to fetch');
    return { status: mode === '503' ? 503 : mode === '400' ? 400 : 200 };
  };
}

export function sendDeps(): SendDeps {
  return {
    fetch: inMock() ? mockFetch() : (url, init) => fetch(url, init),
    storage: storage(),
    online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    now: () => Date.now(),
  };
}

let appVersion: string | null = null;
async function version(): Promise<string> {
  if (appVersion) return appVersion;
  try {
    // Лениво: модуль нужен только при отправке (и тесты, подменяющие @tauri-apps/api/core, его не грузят)
    appVersion = inMock() ? '0.4.1' : await (await import('@tauri-apps/api/app')).getVersion();
  } catch {
    appVersion = 'unknown';
  }
  return appVersion;
}

export async function buildPayload(rating: number, text: string): Promise<FeedbackPayload> {
  return {
    rating,
    text: clampText(text.trim()),
    appVersion: await version(),
    macos: typeof navigator === 'undefined' ? 'unknown' : macosFromUserAgent(navigator.userAgent),
    locale: getLang(),
  };
}

/** Кнопка «Отправить»: собрать, отправить, при успехе или очереди запомнить, что оценка дана. */
export async function submitFeedback(rating: number, text: string): Promise<SendResult> {
  const result = await sendFeedback(await buildPayload(rating, text), sendDeps());
  if (result !== 'failed') noteRated();
  return result;
}

let flushed = false;
/** Один раз за запуск: отправить то, что не ушло в прошлый раз. */
export function flushFeedbackOnLaunch() {
  if (flushed || typeof window === 'undefined') return;
  flushed = true;
  void flushQueue(sendDeps());
}

export function resetFeedbackForTests() {
  cache = null;
  offered = null;
  flushed = false;
  appVersion = null;
  emit();
}

export { EMPTY_PROMPT };
