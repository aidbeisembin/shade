// «Распознать заново»: что значит ответ ядра для человека. Ядро (audio/retranscription.rs)
// заменяет текст встречи одной транзакцией только после того, как новый готов целиком, поэтому
// при любом отказе, остановке и обрыве прежний текст остаётся как был; здесь только слова,
// которыми об этом говорит окно, и кода-подсказки.
//
// Сообщения ядра английские и не меняются (контракт событий оригинала), коды ищем в тексте.

/** Начало ошибки ядра, когда нужная модель Whisper не скачана: `model-missing:<имя>`. */
export const MODEL_MISSING_PREFIX = 'model-missing:';

export type RerecFailure = 'model-missing' | 'stopped' | 'busy' | 'no-text' | 'failed';

/** Что случилось по тексту ошибки события `retranscription-error` или отказа команды. */
export function classifyFailure(message: unknown): RerecFailure {
  const text = String(message ?? '');
  const low = text.toLowerCase();
  if (low.includes(MODEL_MISSING_PREFIX)) return 'model-missing';
  if (low.includes('cancelled') || low.includes('canceled')) return 'stopped';
  if (low.includes('already in progress')) return 'busy';
  if (low.includes('no text recognized') || low.includes('no speech detected')) return 'no-text';
  return 'failed';
}

export type RerecPhase = 'confirm' | 'checking' | 'running' | 'done' | 'model-missing' | 'downloading' | RerecFailure;

/** Состояние окна по событию; всё, чего здесь нет, оставляет фазу как есть. */
export type RerecEvent =
  | { kind: 'start' }
  | { kind: 'running' }
  | { kind: 'complete' }
  | { kind: 'error'; message: unknown }
  | { kind: 'model-ready' }
  | { kind: 'download' }
  | { kind: 'download-failed' }
  | { kind: 'reset' };

export function nextPhase(phase: RerecPhase, event: RerecEvent): RerecPhase {
  switch (event.kind) {
    case 'start':
      return 'checking';
    case 'running':
      return phase === 'checking' || phase === 'running' ? 'running' : phase;
    case 'complete':
      return 'done';
    case 'error':
      return classifyFailure(event.message);
    case 'model-ready':
      return 'running';
    case 'download':
      return 'downloading';
    case 'download-failed':
      return 'model-missing';
    case 'reset':
      return 'confirm';
  }
}

/** Название модели из ошибки `model-missing:<имя>`; запасное значение, если разобрать нельзя. */
export function missingModelName(message: unknown, fallback: string): string {
  const text = String(message ?? '');
  const at = text.indexOf(MODEL_MISSING_PREFIX);
  if (at < 0) return fallback;
  const name = text.slice(at + MODEL_MISSING_PREFIX.length).trim().split(/\s+/)[0];
  return name || fallback;
}

/** Окно можно закрыть, не потеряв ничего: пока идёт работа, закрытие только прячет окно, остановка отдельная кнопка. */
export function isBusy(phase: RerecPhase): boolean {
  return phase === 'checking' || phase === 'running' || phase === 'downloading';
}
