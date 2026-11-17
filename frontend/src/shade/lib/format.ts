// Форматирование дат, длительности, чисел и времени реплик.
// Язык и локаль берутся из lib/lang.ts в момент вызова (ru-RU или en-US), склонения
// через Intl.PluralRules (strings.ts). Зашитых окончаний и кодов локали здесь нет.

import { getLang, locale } from './lang';
import { t, tf, tp } from '../strings';

export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return m > 0 ? tf('durHM', { h, m }) : tf('durH', { h });
  if (m > 0) return tf('durM', { m });
  return tf('durS', { s: total });
}

/** Метка времени реплики от начала записи: 4:07 или 1:02:15 */
export function formatOffset(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Таймер записи: 04:07 или 1:02:15 */
export function formatTimer(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Время без секунд: «09:30» по-русски, «9:30 AM» по-английски. */
function clock(d: Date): string {
  return d.toLocaleTimeString(locale(), { hour: getLang() === 'ru' ? '2-digit' : 'numeric', minute: '2-digit' });
}

/** Русская локаль дописывает к году « г.»: в интерфейсе он лишний. */
function noYearSuffix(text: string): string {
  return getLang() === 'ru' ? text.replace(' г.', '') : text;
}

/** 3 октября 2026, 09:30 / October 3, 2026, 9:30 AM */
export function formatDateTime(value: string | Date | null | undefined): string | null {
  const d = toDate(value);
  if (!d) return null;
  const date = noYearSuffix(d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }));
  return `${date}, ${clock(d)}`;
}

/** Короткая дата для списка: «сегодня, 09:30», «вчера, 09:30», «3 окт.» / “today, 9:30 AM”, “Oct 3” */
export function formatShortDate(value: string | Date | null | undefined): string | null {
  const d = toDate(value);
  if (!d) return null;
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  const time = clock(d);
  if (days === 0) return tf('todayAt', { time });
  if (days === 1) return tf('yesterdayAt', { time });
  const sameYear = d.getFullYear() === now.getFullYear();
  return noYearSuffix(d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }));
}

/**
 * Дата и время для строки списка встреч: «16 нояб., 15:02», «сегодня, 15:02», «вчера, 15:02»;
 * из другого года с годом. Время есть всегда: по названию-теме дату встречи иначе не узнать.
 */
export function formatRowDate(value: string | Date | null | undefined): string | null {
  const d = toDate(value);
  if (!d) return null;
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  const time = clock(d);
  if (days === 0) return tf('todayAt', { time });
  if (days === 1) return tf('yesterdayAt', { time });
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = noYearSuffix(d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }));
  return `${date}, ${time}`;
}

export type DateGroup = 'today' | 'yesterday' | 'week' | 'earlier';

/** Группа списка встреч по дате: сегодня, вчера, последние 7 дней, раньше. */
export function dateGroup(value: string | Date | null | undefined, now = new Date()): DateGroup {
  const d = toDate(value);
  if (!d) return 'earlier';
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  return 'earlier';
}

/** Время встречи для строки в группе «Сегодня» и «Вчера»: дата уже в заголовке группы. */
export function formatTime(value: string | Date | null | undefined): string | null {
  const d = toDate(value);
  return d ? clock(d) : null;
}

/** Число с разрядами по локали: 33 434 (узкий неразрывный пробел) / 33,434. */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat(locale()).format(n);
}

/** Размер файла: «512 КБ», «1,5 МБ», “1.5 MB” (запятая или точка по локали). */
export function formatFileSize(bytes: number): string {
  const one = (value: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value);
  if (bytes < 1024 * 1024) return `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} ${t('unitKb')}`;
  if (bytes < 1024 * 1024 * 1024) return `${one(bytes / (1024 * 1024))} ${t('unitMb')}`;
  return `${one(bytes / (1024 * 1024 * 1024))} ${t('unitGb')}`;
}

// Автоматическое название из useRecordingStart: «Meeting ДД_ММ_ГГ_ЧЧ_ММ_СС».
const AUTO_TITLE = /^Meeting (\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})$/;

/**
 * Название для показа: автоматическое «Meeting 02_11_26_21_34_11» становится
 * «Встреча 2 ноября, 21:34». В базе название не меняется.
 */
export function displayTitle(title: string | null | undefined, now = new Date()): string {
  const raw = (title ?? '').trim();
  const m = raw.match(AUTO_TITLE);
  if (!m) return raw || t('untitledMeeting');
  const [, dd, mm, yy, hh, mi] = m;
  const d = new Date(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
  if (Number.isNaN(d.getTime())) return raw;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = noYearSuffix(d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) }));
  return tf('autoMeetingTitle', { date, time: clock(d) });
}

/**
 * Название для подписи под заголовком («Встреча сохранена» / подпись): у автоматического «Meeting …»
 * без слова «Встреча», оно уже стоит в заголовке: «17 ноября, 18:33». Своё название как есть.
 */
export function displayTitleBrief(title: string | null | undefined, now = new Date()): string {
  const raw = (title ?? '').trim();
  const m = raw.match(AUTO_TITLE);
  if (!m) return displayTitle(title, now);
  const [, dd, mm, yy, hh, mi] = m;
  const d = new Date(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
  if (Number.isNaN(d.getTime())) return raw;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = noYearSuffix(d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) }));
  return `${date}, ${clock(d)}`;
}

/** Название придумано приложением, а не человеком. */
export function isAutoTitle(title: string | null | undefined): boolean {
  return AUTO_TITLE.test((title ?? '').trim());
}

/**
 * Название для показа: своё название человека (или название из итогов ИИ) как есть;
 * автоматическое «Meeting …» становится датой «Встреча 7 ноября, 09:40». Из текста
 * встречи название не берётся: первая реплика бывает мусором (песня с компьютера,
 * «Thank you.» на тишине). Второй аргумент остался для совместимости и не используется.
 */
export function shownTitle(title: string | null | undefined, _fromContent?: string | null): string {
  return displayTitle(title);
}

/** Текст для поля переименования: своё название как есть, автоматическое датой. */
export function editableTitle(title: string | null | undefined, _fromContent?: string | null): string {
  return displayTitle(title);
}

/** «12 мин · 340 слов» для строки списка. */
export function formatVolume(durationSec: number | null | undefined, words: number | null | undefined): string | null {
  const parts = [formatDuration(durationSec), words ? tp('wordsCount', words) : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
