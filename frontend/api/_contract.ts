// Договор между Shade и функцией api/feedback (Vercel): что уходит и как проверяется.
// Один файл на обе стороны, чтобы пределы не разошлись. Без DOM, без React, без кириллицы.

/** Текст отзыва не длиннее, знаков (кодовых точек, эмодзи считается одним). */
export const MAX_TEXT = 2000;
/** Тело запроса не больше, байт: текст 2000 знаков по 4 байта плюс поля. */
export const MAX_BODY_BYTES = 9000;
export const MAX_FIELD = 40;
export const LOCALES = ['ru', 'en'] as const;
export type FeedbackLocale = (typeof LOCALES)[number];

/** Ровно то, что уходит: оценка, текст, версия Shade и macOS, язык интерфейса. */
export interface FeedbackPayload {
  rating: number;
  text: string;
  appVersion: string;
  macos: string;
  locale: FeedbackLocale;
}

export const textLength = (s: string) => Array.from(s).length;

/** Обрезать текст до MAX_TEXT знаков, не разрывая эмодзи и суррогатные пары. */
export function clampText(s: string): string {
  const chars = Array.from(s);
  return chars.length > MAX_TEXT ? chars.slice(0, MAX_TEXT).join('') : s;
}

const FIELD_RE = /^[\w .+()-]*$/;

export type Invalid = { ok: false; field: string };

/** Проверка тела запроса. Лишние поля не проходят дальше: возвращается только договор. */
export function validatePayload(v: unknown): { ok: true; value: FeedbackPayload } | Invalid {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, field: 'body' };
  const o = v as Record<string, unknown>;
  if (typeof o.rating !== 'number' || !Number.isInteger(o.rating) || o.rating < 1 || o.rating > 5) return { ok: false, field: 'rating' };
  if (typeof o.text !== 'string' || textLength(o.text) > MAX_TEXT) return { ok: false, field: 'text' };
  for (const f of ['appVersion', 'macos'] as const) {
    const x = o[f];
    if (typeof x !== 'string' || x.length > MAX_FIELD || !FIELD_RE.test(x)) return { ok: false, field: f };
  }
  if (typeof o.locale !== 'string' || !(LOCALES as readonly string[]).includes(o.locale)) return { ok: false, field: 'locale' };
  return {
    ok: true,
    value: {
      rating: o.rating,
      text: o.text,
      appVersion: o.appVersion as string,
      macos: o.macos as string,
      locale: o.locale as FeedbackLocale,
    },
  };
}
