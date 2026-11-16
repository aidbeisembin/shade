// Когда спросить оценку Shade (карточка «Как вам Shade?»). Чистые функции без DOM и
// хранилища: состояние приходит и уходит целиком, хранение в lib/feedback/store.ts.
// Правила (docs/ui/feedback.md):
//  - только после третьей успешно завершённой встречи (запись остановлена кнопкой, встреча
//    сохранена и не убрана проверкой моделью в корзину), когда человек открыл итоги этой
//    встречи (или любой более поздней такой же);
//  - не чаще раза в COOLDOWN_DAYS дней, считая от прошлого показа;
//  - никогда во время записи и для встречи, восстановленной после сбоя;
//  - после MAX_DISMISSALS закрытий без отправки больше не показывать;
//  - после отправленной оценки карточка больше не приходит (оценить снова можно в Настройках);
//  - переключатель «Иногда спрашивать оценку» выключен: не показывать.

/** С какой по счёту завершённой встречи можно спрашивать. */
export const MIN_COMPLETED = 3;
/** Не чаще раза в столько дней. */
export const COOLDOWN_DAYS = 14;
export const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
/** Сколько закрытий без отправки терпим, потом больше не спрашиваем. */
export const MAX_DISMISSALS = 2;
/** Сколько последних завершённых встреч помним (id и номер по счёту). */
export const COMPLETED_KEEP = 50;
/** Через сколько после открытия итогов появляется карточка: сначала человек видит итоги. */
export const OFFER_DELAY_MS = 1500;

export interface CompletedMeeting {
  id: string;
  /** Номер по счёту среди всех успешно завершённых встреч, с 1. */
  n: number;
}

export interface PromptState {
  /** Сколько встреч завершено успешно за всё время (не убывает, кроме отката проверкой моделью). */
  total: number;
  completed: CompletedMeeting[];
  /** Когда карточка показывалась в последний раз, мс. */
  shownAt: number | null;
  /** Закрытия без отправки. */
  dismissals: number;
  /** Когда ушла оценка (из карточки или из Настроек), мс. */
  ratedAt: number | null;
}

export const EMPTY_PROMPT: PromptState = {
  total: 0,
  completed: [],
  shownAt: null,
  dismissals: 0,
  ratedAt: null,
};

/** Встреча сохранена после «Остановить». Повтор с тем же id ничего не меняет. */
export function markCompleted(s: PromptState, id: string): PromptState {
  if (!id || s.completed.some((c) => c.id === id)) return s;
  const total = s.total + 1;
  const completed = [...s.completed, { id, n: total }].slice(-COMPLETED_KEEP);
  return { ...s, total, completed };
}

/** Проверка моделью убрала встречу в корзину («Мало содержания»): она не считается. */
export function unmarkCompleted(s: PromptState, id: string): PromptState {
  const hit = s.completed.find((c) => c.id === id);
  if (!hit) return s;
  // Номера тех, кто после неё, сдвигаются: третьей считается третья настоящая встреча
  const completed = s.completed.filter((c) => c.id !== id).map((c) => (c.n > hit.n ? { ...c, n: c.n - 1 } : c));
  return { ...s, total: Math.max(0, s.total - 1), completed };
}

export const markShown = (s: PromptState, now: number): PromptState => ({
  ...s,
  shownAt: now,
});
export const markDismissed = (s: PromptState): PromptState => ({
  ...s,
  dismissals: s.dismissals + 1,
});
export const markRated = (s: PromptState, now: number): PromptState => ({
  ...s,
  ratedAt: now,
});

export interface OfferContext {
  /** Открытая встреча, итоги которой человек видит. */
  meetingId: string | null;
  /** Итоги на странице готовы. */
  summaryReady: boolean;
  /** Встреча восстановлена после сбоя (метка recovered.json). */
  recovered: boolean;
  /** Идёт запись (или пауза записи). */
  recording: boolean;
  /** Переключатель «Иногда спрашивать оценку». */
  askEnabled: boolean;
  now: number;
}

export type OfferVerdict =
  | 'offer'
  | 'off'
  | 'no-meeting'
  | 'no-summary'
  | 'recovered'
  | 'recording'
  | 'not-completed'
  | 'too-early'
  | 'cooldown'
  | 'dismissed'
  | 'rated';

/** Показать ли карточку сейчас. Причина отказа для журнала и тестов. */
export function offerVerdict(s: PromptState, c: OfferContext): OfferVerdict {
  if (!c.askEnabled) return 'off';
  if (s.ratedAt !== null) return 'rated';
  if (s.dismissals >= MAX_DISMISSALS) return 'dismissed';
  if (c.recording) return 'recording';
  if (!c.meetingId) return 'no-meeting';
  if (c.recovered) return 'recovered';
  const hit = s.completed.find((x) => x.id === c.meetingId);
  if (!hit) return 'not-completed';
  if (hit.n < MIN_COMPLETED) return 'too-early';
  if (s.shownAt !== null && c.now - s.shownAt < COOLDOWN_MS) return 'cooldown';
  if (!c.summaryReady) return 'no-summary';
  return 'offer';
}

/** Состояние из хранилища: всё, что не похоже на себя, заменяется пустым, а не роняет приложение. */
export function parsePrompt(raw: string | null): PromptState {
  if (!raw) return EMPTY_PROMPT;
  try {
    const v = JSON.parse(raw) as Partial<PromptState>;
    const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : d);
    const stamp = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const completed = Array.isArray(v.completed)
      ? v.completed.filter((c): c is CompletedMeeting => !!c && typeof c.id === 'string' && typeof c.n === 'number').slice(-COMPLETED_KEEP)
      : [];
    return {
      total: num(v.total, completed.length),
      completed,
      shownAt: stamp(v.shownAt),
      dismissals: num(v.dismissals, 0),
      ratedAt: stamp(v.ratedAt),
    };
  } catch {
    return EMPTY_PROMPT;
  }
}
