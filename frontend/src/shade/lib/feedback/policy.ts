// Когда спросить оценку Shade (карточка «Как вам Shade?»). Чистые функции без DOM и
// хранилища: состояние приходит и уходит целиком, хранение в lib/feedback/store.ts.
// Правила (docs/ui/feedback.md), решение владельца 17.11.2026:
//  - после полноценной записи: остановлена кнопкой, сохранена, не убрана проверкой моделью в корзину
//    и длится не меньше MIN_SECONDS (10 мин); спрашиваем, когда человек открыл её итоги;
//  - первый раз сразу после первой такой записи, второй не раньше чем через SECOND_GAP_DAYS (7 дней),
//    дальше не чаще раза в REPEAT_GAP_DAYS (30 дней), считая от последнего показа или оценки;
//  - отправленная оценка и закрытие крестиком цикл не останавливают, только сдвигают;
//  - никогда во время записи и для встречи, восстановленной после сбоя;
//  - длительность неизвестна: не спрашиваем (при сомнении не тревожим);
//  - переключатель «Иногда спрашивать оценку» выключен: не показывать.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Полноценная запись: не короче стольких секунд. */
export const MIN_SECONDS = 10 * 60;
/** Второй раз не раньше чем через столько дней после первого показа. */
export const SECOND_GAP_DAYS = 7;
/** Дальше не чаще раза в столько дней. */
export const REPEAT_GAP_DAYS = 30;
/** Сколько последних завершённых встреч помним (id и номер по счёту). */
export const COMPLETED_KEEP = 50;
/** Через сколько после открытия итогов появляется карточка: сначала человек видит итоги. */
export const OFFER_DELAY_MS = 1500;

/** Пауза до следующего показа после shows показов, мс: 0, неделя, потом месяц. */
export function gapAfter(shows: number): number {
  if (shows <= 0) return 0;
  return (shows === 1 ? SECOND_GAP_DAYS : REPEAT_GAP_DAYS) * DAY_MS;
}

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
  /** Сколько раз карточка показывалась (от него пауза до следующего: gapAfter). */
  shows: number;
  /** Закрытия без отправки (для журнала; показ не останавливают). */
  dismissals: number;
  /** Когда ушла оценка (из карточки или из Настроек), мс. */
  ratedAt: number | null;
}

export const EMPTY_PROMPT: PromptState = {
  total: 0,
  completed: [],
  shownAt: null,
  shows: 0,
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
  // Номера тех, кто после неё, сдвигаются: счёт только настоящих встреч
  const completed = s.completed.filter((c) => c.id !== id).map((c) => (c.n > hit.n ? { ...c, n: c.n - 1 } : c));
  return { ...s, total: Math.max(0, s.total - 1), completed };
}

export const markShown = (s: PromptState, now: number): PromptState => ({
  ...s,
  shownAt: now,
  shows: s.shows + 1,
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
  /** Длительность записи, с (длина файла звука, recording-duration.ts); null: неизвестна. */
  durationSec: number | null;
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
  | 'short'
  | 'cooldown';

/** Показать ли карточку сейчас. Причина отказа для журнала и тестов. */
export function offerVerdict(s: PromptState, c: OfferContext): OfferVerdict {
  if (!c.askEnabled) return 'off';
  if (c.recording) return 'recording';
  if (!c.meetingId) return 'no-meeting';
  if (c.recovered) return 'recovered';
  if (!s.completed.some((x) => x.id === c.meetingId)) return 'not-completed';
  if (c.durationSec === null || !(c.durationSec >= MIN_SECONDS)) return 'short';
  // Пауза от последнего касания: показа карточки или оценки (в том числе из Настроек)
  const last = Math.max(s.shownAt ?? -Infinity, s.ratedAt ?? -Infinity);
  if (Number.isFinite(last) && c.now - last < gapAfter(s.shows)) return 'cooldown';
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
      // Состояние до 17.11.2026 без счётчика: был показ, значит один
      shows: num(v.shows, stamp(v.shownAt) === null ? 0 : 1),
      dismissals: num(v.dismissals, 0),
      ratedAt: stamp(v.ratedAt),
    };
  } catch {
    return EMPTY_PROMPT;
  }
}
