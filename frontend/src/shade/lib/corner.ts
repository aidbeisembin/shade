// Правый нижний угол: всё, что не про текущую запись (docs/ui/notifications.md, «Угол»).
// Хранилище без React и DOM, чтобы правила проверялись тестом (corner.test.ts):
//  - новая карточка снизу; видно не больше MAX_VISIBLE, старшие сворачиваются в стопку «+N»
//    (раскладку считает stackView, рисует components/CornerStack.tsx);
//  - однотипные склеиваются: show с тем же group добавляет payload в ту же карточку
//    («2 встречи в корзине», «Восстановлено 2 встречи после сбоя») и запускает её срок заново;
//  - тот же id заменяет карточку на месте (ожидание → итог, прогресс загрузки оригинала);
//  - срок: по умолчанию итог 4 с, с действием 8 с (notice-timing.ts); null - без таймера;
//  - hold(причина, да/нет): пока есть хоть одна причина (указатель, фокус, свёрнутое окно),
//    время стоит у всех карточек, потом идёт с остатка.
// Часы подставляются (CornerClock), в тесте ручные.

import type { ReactNode } from 'react';
import { resultTimeout } from './notice-timing';

/** Сколько карточек видно сразу; остальные в стопке «+N». */
export const MAX_VISIBLE = 3;

/** Значок карточки по смыслу (components/ui/notice.tsx, NoticeGlyph). */
export type NoticeIconKind = 'done' | 'info' | 'problem' | 'progress' | 'recovery' | 'update';

export interface NoticeAction {
  label: ReactNode;
  onClick: () => void;
  /** Знак перед подписью (чат беты: TelegramLogo). */
  icon?: ReactNode;
}

export interface CornerView {
  icon?: NoticeIconKind;
  /** ok: зелёная галочка «Отзыв отправлен» (feedback.md); error: значок ошибки. */
  tone?: 'neutral' | 'ok' | 'error';
  title: ReactNode;
  hint?: ReactNode;
  /** Полный текст подсказкой, если подпись обрезана (ошибка ядра). */
  hintTitle?: string;
  action?: NoticeAction;
  /** alert только у ошибок, остальное status. */
  role?: 'status' | 'alert';
  /** Без крестика (ожидание). По умолчанию крестик есть. */
  closable?: boolean;
  /** Своя разметка вместо карточки: отзыв (FeedbackCard), загрузка моделей оригинала. */
  render?: (api: { dismiss: () => void }) => ReactNode;
}

export interface ShowOptions<P = unknown> {
  id?: string;
  group?: string;
  payload?: P;
  view: CornerView | ((payloads: P[]) => CornerView);
  /** мс; null - без таймера; не задано - по действию (resultTimeout). */
  timeout?: number | null;
  /** Карточка ушла (крестик, срок, действие, замена всех). */
  onDismiss?: () => void;
}

export interface CornerEntry {
  id: string;
  group?: string;
  payloads: unknown[];
  view: CornerView;
  timeout: number | null;
}

interface Internal extends CornerEntry {
  build: (payloads: unknown[]) => CornerView;
  explicitTimeout: number | null | undefined;
  remaining: number;
  startedAt: number | null;
  timer: unknown;
  onDismiss?: () => void;
}

export interface CornerClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: CornerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Раскладка стека: сколько карточек показать и сколько свёрнуто в «+N». */
export function stackView(count: number, expanded: boolean): { shown: number; hidden: number } {
  const shown = expanded ? count : Math.min(count, MAX_VISIBLE);
  return { shown, hidden: count - shown };
}

let seq = 0;

export class CornerStore {
  private items: Internal[] = [];
  private snapshot: CornerEntry[] = [];
  private holds = new Set<string>();
  private listeners = new Set<() => void>();

  constructor(private clock: CornerClock = realClock) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  /** Снимок: старшие сверху, новая последней. Тот же массив, пока ничего не изменилось. */
  getSnapshot = (): CornerEntry[] => this.snapshot;

  get held(): boolean {
    return this.holds.size > 0;
  }

  show<P>(opts: ShowOptions<P>): string {
    const build = (typeof opts.view === 'function' ? opts.view : () => opts.view) as (p: unknown[]) => CornerView;
    const byId = opts.id ? this.items.find((e) => e.id === opts.id) : undefined;
    const byGroup = !byId && opts.group ? this.items.find((e) => e.group === opts.group) : undefined;
    const prev = byId ?? byGroup;
    if (prev) {
      this.stop(prev);
      // Тот же id: замена (payload новый); та же группа: склейка (payload добавляется)
      const payloads = byId ? (opts.payload === undefined ? [] : [opts.payload]) : [...prev.payloads, ...(opts.payload === undefined ? [] : [opts.payload])];
      Object.assign(prev, { build, payloads, explicitTimeout: opts.timeout, onDismiss: opts.onDismiss ?? prev.onDismiss });
      prev.view = build(payloads);
      prev.timeout = this.timeoutOf(prev);
      prev.remaining = prev.timeout ?? 0;
      // Склеенная встаёт новой (вниз): это последнее событие
      if (byGroup) this.items = [...this.items.filter((e) => e !== prev), prev];
      this.start(prev);
      this.emit();
      return prev.id;
    }
    const payloads = opts.payload === undefined ? [] : [opts.payload];
    const view = build(payloads);
    const entry: Internal = {
      id: opts.id ?? `corner-${++seq}`,
      group: opts.group,
      payloads,
      view,
      build,
      explicitTimeout: opts.timeout,
      timeout: null,
      remaining: 0,
      startedAt: null,
      timer: null,
      onDismiss: opts.onDismiss,
    };
    entry.timeout = this.timeoutOf(entry);
    entry.remaining = entry.timeout ?? 0;
    this.items = [...this.items, entry];
    this.start(entry);
    this.emit();
    return entry.id;
  }

  /** Убрать карточку по id; без id - все. */
  dismiss(id?: string | number) {
    const gone = id === undefined ? this.items : this.items.filter((e) => e.id === String(id));
    if (gone.length === 0) return;
    gone.forEach((e) => this.stop(e));
    this.items = this.items.filter((e) => !gone.includes(e));
    this.emit();
    gone.forEach((e) => e.onDismiss?.());
  }

  has(id: string): boolean {
    return this.items.some((e) => e.id === id);
  }

  /** Остановить или пустить время у всех карточек (указатель, фокус, свёрнутое окно). */
  hold(reason: string, on: boolean) {
    const before = this.held;
    if (on) this.holds.add(reason);
    else this.holds.delete(reason);
    if (before === this.held) return;
    this.items.forEach((e) => (this.held ? this.stop(e) : this.start(e)));
  }

  /** Только для тестов. */
  reset() {
    this.items.forEach((e) => this.stop(e));
    this.items = [];
    this.holds.clear();
    this.emit();
  }

  private timeoutOf(e: Internal): number | null {
    if (e.explicitTimeout === null || e.explicitTimeout === Infinity) return null;
    if (typeof e.explicitTimeout === 'number') return e.explicitTimeout;
    // Своя разметка и ожидание без таймера: их закрывает тот, кто показал
    if (e.view.render || e.view.icon === 'progress') return null;
    return resultTimeout(Boolean(e.view.action));
  }

  private start(e: Internal) {
    if (e.timeout === null || this.held || e.startedAt !== null) return;
    e.startedAt = this.clock.now();
    e.timer = this.clock.setTimeout(() => this.dismiss(e.id), e.remaining);
  }

  private stop(e: Internal) {
    if (e.startedAt === null) return;
    e.remaining = Math.max(0, e.remaining - (this.clock.now() - e.startedAt));
    e.startedAt = null;
    this.clock.clearTimeout(e.timer);
    e.timer = null;
  }

  private emit() {
    this.snapshot = this.items.map(({ id, group, payloads, view, timeout }) => ({ id, group, payloads, view, timeout }));
    this.listeners.forEach((fn) => fn());
  }
}

/** Один угол на приложение. */
export const corner = new CornerStore();
