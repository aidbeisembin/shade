// Автообновление Shade (Tauri updater, docs/release.md, «Обновления»).
// - Проверка при запуске (через START_DELAY_MS) и раз в сутки, пока Shade открыт. Запрос идёт из ядра
//   на постоянный адрес latest.json релиза, без идентификаторов пользователя (только версия плагина
//   в User-Agent).
// - Найдена новая версия: архив скачивается в фоне, ядро сверяет его подпись с ключом из
//   tauri.conf.json. Только после этого карточка «Доступна версия X» с кнопкой «Обновить».
// - Нет сети, нет latest.json, битая подпись: тихо пропускаем (в журнал), следующая попытка по
//   расписанию. Карточки и тостов нет.
// - Во время записи не проверяем, не скачиваем и не ставим: проверка откладывается до конца записи,
//   карточка прячется, «Обновить» перед установкой ещё раз спрашивает ядро, не идёт ли запись.
// - «Обновить»: установка поверх Shade.app и перезапуск. Не вышло: «Не получилось обновить»,
//   текущая версия на месте (плагин заменяет приложение только целиком).
'use client';

import { useSyncExternalStore } from 'react';

export const START_DELAY_MS = 5_000;
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const CHECK_TIMEOUT_MS = 30_000;

/** Найденное обновление: то, что нужно от Update плагина. */
export interface UpdateHandle {
  version: string;
  /** Скачать и проверить подпись (ошибка: сеть или подпись не сошлась). */
  download(): Promise<void>;
  /** Поставить скачанное поверх приложения. */
  install(): Promise<void>;
}

export interface UpdateDeps {
  /** null: обновлений нет. Исключение: сеть, адрес, разбор latest.json. */
  check(): Promise<UpdateHandle | null>;
  /** Идёт ли запись по данным ядра (последняя проверка перед установкой). */
  isRecording(): Promise<boolean>;
  relaunch(): Promise<void>;
  log?(message: string, error?: unknown): void;
}

export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'downloading'; version: string }
  | { kind: 'ready'; version: string }
  | { kind: 'installing'; version: string }
  | { kind: 'failed'; version: string };

/** Чем кончилась проверка: none нет новой, ready карточка, skipped тихо пропущено, deferred идёт запись, busy уже идёт. */
export type CheckOutcome = 'none' | 'ready' | 'skipped' | 'deferred' | 'busy';
export type InstallOutcome = 'installed' | 'blocked' | 'failed' | 'nothing';

export class UpdateController {
  private phase: UpdatePhase = { kind: 'idle' };
  private handle: UpdateHandle | null = null;
  private recording = false;
  private deferred = false;
  private dismissed: string | null = null;
  private listeners = new Set<() => void>();

  constructor(private deps: UpdateDeps) {}

  getPhase = (): UpdatePhase => this.phase;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  /** Карточка видна: обновление готово (или ставится, или не встало), не идёт запись, не закрыта человеком. */
  visible(): boolean {
    const p = this.phase;
    if (this.recording) return false;
    if (p.kind === 'ready') return this.dismissed !== p.version;
    return p.kind === 'installing' || p.kind === 'failed';
  }

  /** Запись началась или кончилась (из RecordDock). После записи отложенная проверка идёт сразу. */
  setRecording(on: boolean) {
    if (this.recording === on) return;
    this.recording = on;
    this.emit();
    if (!on && this.deferred) {
      this.deferred = false;
      void this.check();
    }
  }

  async check(): Promise<CheckOutcome> {
    const k = this.phase.kind;
    if (k === 'checking' || k === 'downloading' || k === 'installing') return 'busy';
    if (k === 'ready') return 'ready';
    if (this.recording) {
      this.deferred = true;
      return 'deferred';
    }
    this.set({ kind: 'checking' });
    let handle: UpdateHandle | null;
    try {
      handle = await this.deps.check();
    } catch (error) {
      this.deps.log?.('check skipped', error);
      this.set({ kind: 'idle' });
      return 'skipped';
    }
    if (!handle) {
      this.set({ kind: 'idle' });
      return 'none';
    }
    // Запись началась, пока ждали ответа: скачивать после неё
    if (this.recording) {
      this.deferred = true;
      this.set({ kind: 'idle' });
      return 'deferred';
    }
    this.set({ kind: 'downloading', version: handle.version });
    try {
      await handle.download();
    } catch (error) {
      this.deps.log?.(`${handle.version} skipped: download failed or signature mismatch`, error);
      this.set({ kind: 'idle' });
      return 'skipped';
    }
    this.handle = handle;
    this.set({ kind: 'ready', version: handle.version });
    return 'ready';
  }

  async install(): Promise<InstallOutcome> {
    const p = this.phase;
    if (p.kind !== 'ready' || !this.handle) return 'nothing';
    // Не доверяем только состоянию интерфейса: ядро говорит, идёт ли запись
    let recording = this.recording;
    try {
      recording = recording || (await this.deps.isRecording());
    } catch {
      recording = true; // не знаем: не ставим
    }
    if (recording) return 'blocked';
    this.set({ kind: 'installing', version: p.version });
    try {
      await this.handle.install();
    } catch (error) {
      this.deps.log?.(`${p.version} install failed`, error);
      this.handle = null;
      this.set({ kind: 'failed', version: p.version });
      return 'failed';
    }
    await this.deps.relaunch();
    return 'installed';
  }

  /** Крестик: эта версия до следующего запуска не показывается; после «не получилось» карточка уходит. */
  dismiss() {
    const p = this.phase;
    if (p.kind === 'ready') this.dismissed = p.version;
    if (p.kind === 'failed') this.set({ kind: 'idle' });
    else this.emit();
  }

  private set(phase: UpdatePhase) {
    this.phase = phase;
    this.emit();
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
}

/** Проверка через delay после запуска и затем каждые interval. Возвращает отмену. */
export function scheduleChecks(run: () => void, delay = START_DELAY_MS, interval = CHECK_INTERVAL_MS): () => void {
  let every: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    run();
    every = setInterval(run, interval);
  }, delay);
  return () => {
    clearTimeout(first);
    if (every) clearInterval(every);
  };
}

/** Зависимости из Tauri: плагины updater и process, команда ядра is_recording. */
export function tauriUpdateDeps(): UpdateDeps {
  return {
    async check() {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      if (!update) return null;
      return {
        version: update.version,
        download: () => update.download(),
        install: () => update.install(),
      };
    },
    async isRecording() {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<boolean>('is_recording');
    },
    async relaunch() {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
    log: (message, error) => console.info(`[shade] updates: ${message}`, error ?? ''),
  };
}

let shared: UpdateController | null = null;
/** Один контроллер на приложение. */
export function updateController(): UpdateController {
  if (!shared) shared = new UpdateController(tauriUpdateDeps());
  return shared;
}

export function useUpdatePhase(c: UpdateController): { phase: UpdatePhase; visible: boolean } {
  const phase = useSyncExternalStore(c.subscribe, c.getPhase, c.getPhase);
  // visible зависит и от записи и закрытия: подписка та же, пересчёт на каждом emit
  useSyncExternalStore(c.subscribe, () => c.visible(), () => false);
  return { phase, visible: c.visible() };
}

/** Только в разработке: карточка на заданном шаге (?update=ready|installing|failed), версия вымышленная. */
export function previewUpdate(params: URLSearchParams | null): UpdatePhase | null {
  if (process.env.NODE_ENV !== 'development' || !params) return null;
  const kind = params.get('update');
  const version = '0.5.0-beta.2';
  if (kind === 'ready' || kind === 'installing' || kind === 'failed') return { kind, version };
  return null;
}
