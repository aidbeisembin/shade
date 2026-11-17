// Шаги карточки «Как вам Shade?» и формы отзыва. Чистый редуктор: что видно и что можно нажать.
//
//   ask ──звезда 1-2──> form(low) ──Отправить──> sending ──> sent | queued | failed
//    │                    └─Esc──> closed (ничего не ушло)
//    └─звезда 3-5──> sending (оценка без текста, сразу) ──> sent | queued | failed
// Наведение и стрелки только меняют оценку; ветку выбирает щелчок, Enter или пробел.
// Крестик на любом шаге до отправки: closed, ничего не уходит (dismissed: закрытие без оценки).
// «Отправить» на шаге sending и после него ничего не делает: второй запрос не уходит.

import { MAX_TEXT, clampText } from './contract';

export type Step = 'ask' | 'form' | 'sending' | 'sent' | 'queued' | 'failed' | 'closed';

export interface Flow {
  step: Step;
  rating: number;
  text: string;
  /** Откуда отправка: low (1-2 звезды, через «Что улучшить?») или null (3-5 звёзд, сразу с карточки). */
  origin: 'low' | null;
  /** Закрыто без отправки. */
  dismissed: boolean;
}

export type FlowEvent =
  | { type: 'rate'; rating: number }
  | { type: 'commit'; rating: number }
  | { type: 'text'; text: string }
  | { type: 'cancel' }
  | { type: 'send' }
  | { type: 'result'; result: 'sent' | 'queued' | 'failed' }
  | { type: 'close' };

export const START: Flow = {
  step: 'ask',
  rating: 0,
  text: '',
  origin: null,
  dismissed: false,
};

/** До этой оценки включительно карточка спрашивает «Что улучшить?»; выше оценка уходит сразу. */
export const FORM_MAX = 2;
export const sendsAtOnce = (rating: number) => rating > FORM_MAX;

const done = (s: Step) => s === 'sending' || s === 'sent' || s === 'queued' || s === 'failed' || s === 'closed';

export function canSend(f: Flow): boolean {
  return f.step === 'form' && f.rating >= 1 && f.rating <= 5 && f.text.length <= MAX_TEXT;
}

export function flowReducer(f: Flow, e: FlowEvent): Flow {
  switch (e.type) {
    case 'rate':
      // Стрелки по звёздам: оценка меняется, ветка ещё нет (её выбирает Enter, пробел или щелчок)
      return done(f.step) ? f : { ...f, rating: clamp(e.rating) };
    case 'commit': {
      if (done(f.step)) return f;
      const rating = clamp(e.rating);
      if (rating === 0) return f;
      // В форме оценку можно поправить, форма остаётся (уйдёт по «Отправить» вместе с текстом)
      if (f.step === 'form') return { ...f, rating };
      return sendsAtOnce(rating) ? { ...f, rating, text: '', step: 'sending', origin: null } : { ...f, rating, step: 'form', origin: 'low' };
    }
    case 'text':
      return f.step === 'form' ? { ...f, text: clampText(e.text) } : f;
    case 'cancel':
      return f.step === 'form' ? { ...f, step: 'closed', dismissed: true } : f;
    case 'send':
      return canSend(f) ? { ...f, step: 'sending' } : f;
    case 'result':
      return f.step === 'sending' ? { ...f, step: e.result } : f;
    case 'close':
      if (f.step === 'closed') return f;
      return {
        ...f,
        step: 'closed',
        dismissed: f.step !== 'sent' && f.step !== 'queued' && f.step !== 'sending' && f.step !== 'failed',
      };
  }
}

const clamp = (r: number) => (Number.isFinite(r) ? Math.max(0, Math.min(5, Math.round(r))) : 0);
