// Восстановление встречи после сбоя: часть интерфейса. Саму работу делает ядро
// (src-tauri/src/crash_recovery, команда recover_interrupted_meetings): находит
// прерванные записи в папке записей, собирает звук, создаёт встречу. Здесь:
// 1. при запуске один вызов команды;
// 2. тихое уведомление «Встреча от 16 ноября, 15:02 / Восстановлена после сбоя · 29 мин»
//    с «Открыть»: без модальных окон и без вопроса «восстановить?», данные
//    сохраняются всегда;
// 3. пометки встреч (список, страница встречи), прочитанные из recovered.json папки
//    встречи (источник правды диск, здесь только копия в памяти);
// 4. повтор через минуту, если ядро нашло папку, в которую писали только что (живая
//    запись или второй экземпляр): её не трогают.
// Док: docs/ui/recording-outcome.md, «Восстановление после сбоя».
'use client';

import { createElement, useSyncExternalStore } from 'react';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { invoke } from '@tauri-apps/api/core';
import { displayTitle, formatDuration } from './format';
import { openMeeting } from './open-meeting';
import { shadeToast } from './toasts';
import { t, tp } from '@/shade/strings';

export interface RecoveredMeeting {
  meeting_id: string;
  title: string;
  created_at: string;
  duration_seconds: number | null;
  segments: number;
  partial: boolean;
  reasons: string[];
  folder: string;
}

export interface RecoveryReport {
  ready: boolean;
  recording: boolean;
  recovered: RecoveredMeeting[];
  deferred: number;
  nothing: number;
  failed: string[];
  marked: Array<{ meeting_id: string; partial: boolean; recovered_at: string }>;
}

export interface RecoveredMark {
  partial: boolean;
}

/** Сколько ждать перед повтором, если ядро отложило папку, в которую писали только что (ядро: FRESH_SECS = 60). */
export const RETRY_AFTER_MS = 65_000;
/** Сколько повторов за запуск: дальше это не живая запись, а то, что подберёт следующий запуск. */
export const MAX_RETRIES = 3;
/** Уведомление не пропадает за секунды: после сбоя человек может смотреть в окно не сразу. Под курсором стоит. */
export const RECOVERED_NOTICE_MS = 20_000;
/** Больше стольких встреч сразу: одно сводное уведомление вместо стопки. */
export const MAX_NOTICES = 2;

// --- пометки --------------------------------------------------------------

let marks = new Map<string, RecoveredMark>();
const listeners = new Set<() => void>();

function setMarks(items: Array<{ meeting_id: string; partial: boolean }>) {
  const next = new Map<string, RecoveredMark>();
  for (const m of items) {
    const prev = marks.get(m.meeting_id);
    // тот же объект, пока ничего не изменилось: useSyncExternalStore сравнивает по ссылке
    next.set(m.meeting_id, prev && prev.partial === m.partial ? prev : { partial: m.partial });
  }
  marks = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function recoveredMark(id: string | null | undefined): RecoveredMark | null {
  return (id && marks.get(id)) || null;
}

/** Встреча восстановлена после сбоя (и насколько). Перерисовывает, когда пометки пришли из ядра. */
export function useRecoveredMark(id: string | null | undefined): RecoveredMark | null {
  return useSyncExternalStore(subscribe, () => recoveredMark(id), () => null);
}

/** Подпись для списка и страницы встречи. */
export function recoveredLabel(mark: RecoveredMark): string {
  return mark.partial ? t('recoveredPartialHint') : t('recoveredHint');
}

// --- уведомление ----------------------------------------------------------

export function announceRecovered(items: RecoveredMeeting[]) {
  if (items.length === 0) return;
  const icon = createElement(ClockCounterClockwise, { weight: 'fill' });
  if (items.length > MAX_NOTICES) {
    shadeToast.info(t('recoveredManyTitle'), { icon, description: tp('recoveredManyHint', items.length), duration: RECOVERED_NOTICE_MS });
    return;
  }
  for (const m of items) {
    const duration = formatDuration(m.duration_seconds);
    const what = recoveredLabel({ partial: m.partial });
    shadeToast.info(displayTitle(m.title), {
      icon,
      description: [what, duration].filter(Boolean).join(' · '),
      duration: RECOVERED_NOTICE_MS,
      action: { label: t('finishOpen'), onClick: () => openMeeting(m.meeting_id) },
    });
  }
}

// --- запуск ---------------------------------------------------------------

let attempt = 0;

/**
 * Один вызов при запуске (и повторы, пока ядро откладывает свежие папки). Ошибка команды
 * (старое ядро, заглушка) только в журнал: восстановление не должно мешать запуску.
 * `onRecovered` вызывается, когда в базе появились новые встречи (перечитать список), с их id:
 * по ним придумываются названия (recording-outcome.tsx, title-service.ts).
 */
export async function runCrashRecovery(onRecovered: (recoveredIds?: string[]) => void): Promise<void> {
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV === 'development' && (await previewRecovery(onRecovered))) return;
  try {
    const report = await invoke<RecoveryReport | null | undefined>('recover_interrupted_meetings');
    if (!report) return;
    setMarks(report.marked ?? []);
    if (report.recovered?.length) {
      announceRecovered(report.recovered);
      onRecovered(report.recovered.map((m) => m.meeting_id));
    }
    if (report.failed?.length) console.warn('[shade] Восстановление после сбоя: не всё удалось, данные на месте:', report.failed);
    if (report.deferred > 0 && attempt < MAX_RETRIES) {
      attempt += 1;
      setTimeout(() => void runCrashRecovery(onRecovered), RETRY_AFTER_MS);
    }
  } catch (error) {
    console.info('[shade] Восстановление после сбоя не запущено:', error);
  }
}

/**
 * Только в разработке: уведомление и пометки без настоящего сбоя.
 * ?recovery=done|partial|two|many (русский и английский: ?lang=…).
 */
async function previewRecovery(onRecovered: (recoveredIds?: string[]) => void): Promise<boolean> {
  const kind = new URLSearchParams(window.location.search).get('recovery');
  if (!kind) return false;
  const ids = await invoke<Array<{ id: string }>>('api_get_meetings').then((list) => (list ?? []).map((m) => m.id)).catch(() => [] as string[]);
  const make = (n: number, partial: boolean): RecoveredMeeting => ({
    meeting_id: ids[n] ?? `preview-${n}`,
    title: `Meeting 16_11_26_${15 + n}_02_17`,
    created_at: '2026-11-16T10:02:19+00:00',
    duration_seconds: 1740 - n * 600,
    segments: 181,
    partial,
    reasons: partial ? ['chunk-damaged'] : [],
    folder: '/preview',
  });
  const items =
    kind === 'partial' ? [make(0, true)] : kind === 'two' ? [make(0, false), make(1, true)] : kind === 'many' ? [make(0, false), make(1, true), make(2, false)] : [make(0, false)];
  setMarks(items.map((m) => ({ meeting_id: m.meeting_id, partial: m.partial })));
  announceRecovered(items);
  onRecovered();
  return true;
}

/** Только для тестов: счётчик повторов и пометки. */
export function resetCrashRecoveryForTests() {
  attempt = 0;
  setMarks([]);
}
