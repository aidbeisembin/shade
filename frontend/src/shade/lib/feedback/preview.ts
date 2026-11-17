// Разработка и снимки: карточка «Как вам Shade?» на заданном шаге без правил показа.
// ?feedback-card=ask|low|high|sent|queued (high: 5 звёзд уже нажаты, оценка уходит и карточка сворачивается в «Спасибо!»), только на заглушках (window.__SHADE_MOCK__).
// ?motion=0.25 замедляет движение (запись экрана ×0,25).
// Отправка из такой карточки идёт в заглушку отправки (?feedback=ok|503|offline, store.ts).

import { START, type Flow } from './flow';
import { setTimeScale } from '../motion/spring';

const STEPS: Record<string, Flow> = {
  ask: START,
  low: { ...START, step: 'form', rating: 2, origin: 'low' },
  high: { ...START, step: 'sending', rating: 5 },
  sent: { ...START, step: 'sent', rating: 2, origin: 'low' },
  queued: { ...START, step: 'queued', rating: 2 },
};

export function previewFeedback(params: URLSearchParams): Flow | null {
  if (typeof window === 'undefined' || !(window as unknown as { __SHADE_MOCK__?: unknown }).__SHADE_MOCK__) return null;
  const v = params.get('feedback-card');
  return v ? (STEPS[v] ?? null) : null;
}

/** ?motion=0.25: замедлить пружины и таймеры движка для записи экрана (только заглушки). */
export function previewMotion(params: URLSearchParams) {
  if (typeof window === 'undefined' || !(window as unknown as { __SHADE_MOCK__?: unknown }).__SHADE_MOCK__) return;
  const v = Number(params.get('motion'));
  if (Number.isFinite(v) && v > 0 && v <= 1) setTimeScale(v);
}
