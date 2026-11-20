// Пиксельная «генерация» названия встречи: чистая часть без React и без canvas.
// Две фазы. Пока модель думает (сигнал progress, title-service.ts), вместо даты мерцают
// пиксели с бегущей волной (loadingAlpha). Когда название записано (событие shade-title-set),
// пиксели поверх настоящего текста мельчают и рассыпаются в случайном порядке, текст проступает
// (revealFrame, cellAlive). Холст рисует только пиксели, буквы всегда DOM: шрифт не расходится.
// Рисует components/TitleReveal.tsx. Тесты: title-reveal.test.ts. Вид: docs/ui/foundations.md.
//
// Признак «название только что придумано» один: событие shade-title-set (onTitleSet).
// Его шлёт только автоматика после записи названия ядром. Ручное переименование, загрузка
// списка при старте, прокрутка и перерисовки события не шлют.

/** Длительность проявления, мс (требование 700-900). */
export const REVEAL_MS = 800;
/** Сколько ждать, пока экран покажет название из события. Позже: проявление не играет. */
export const ARM_TTL_MS = 3000;
/** Сторона крупного пикселя, CSS px: в ожидании и в начале проявления. */
export const PIXEL = 4;
/** Как часто пиксели ожидания меняют яркость, мс. */
export const FLICKER_MS = 90;
/** Период бегущей волны ожидания, мс: «модель работает», слева направо. */
export const WAVE_MS = 1400;

export interface Armed {
  /** Название из события, как его записало ядро. */
  title: string;
  /** Когда пришло событие, мс. */
  at: number;
}

export interface RevealInput {
  armed: Armed | null;
  /** Текст на экране до этой перерисовки. */
  prev: string;
  /** Текст на экране сейчас. */
  next: string;
  now: number;
  reducedMotion: boolean;
}

/**
 * Играть ли проявление. Только если пришло событие о придуманном названии, экран показал
 * именно его, текст действительно сменился и событие свежее. При «уменьшить движение» нет.
 */
export function decideReveal({ armed, prev, next, now, reducedMotion }: RevealInput): boolean {
  if (!armed || reducedMotion) return false;
  const shown = next.trim();
  if (!shown || shown === prev.trim()) return false;
  if (armed.title.trim() !== shown) return false;
  return now - armed.at <= ARM_TTL_MS;
}

/** ease-out (кубическая): быстро в начале, мягко к концу. */
export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/** Псевдослучайное число 0..1 для (a, b) и зерна seed: одно и то же внутри проигрыша. */
export function hash01(a: number, b: number, seed: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// --- кто ждёт название -----------------------------------------------------------------------

/**
 * Счётчик «название придумывается» по встречам. Держать могут двое сразу: путь после «Остановить»
 * (с первого кадра сохранённой встречи до конца попытки) и запрос к модели внутри него. Полоса
 * пикселей видна, пока держит хоть кто-то; emit зовётся только при смене «держат / не держат».
 */
export function createPendingStore(emit: (id: string, on: boolean) => void) {
  const count = new Map<string, number>();
  return {
    has: (id: string) => (count.get(id) ?? 0) > 0,
    set(id: string, on: boolean) {
      const was = count.get(id) ?? 0;
      const now = on ? was + 1 : Math.max(0, was - 1);
      if (now) count.set(id, now);
      else count.delete(id);
      if (was > 0 !== now > 0) emit(id, now > 0);
    },
  };
}

// --- ожидание ------------------------------------------------------------------------------

/**
 * Яркость пикселя ожидания (0..1) в колонке col из cols, ряду row, в момент elapsed мс.
 * Случайное мерцание раз в FLICKER_MS и светлая волна, бегущая слева направо раз в WAVE_MS.
 */
export function loadingAlpha(col: number, row: number, cols: number, elapsed: number, seed: number): number {
  const tick = Math.floor(Math.max(0, elapsed) / FLICKER_MS);
  const flicker = hash01(col * 131 + row, tick, seed);
  // волна выходит из-за левого края и уходит за правый
  const phase = ((Math.max(0, elapsed) % WAVE_MS) / WAVE_MS) * 1.6 - 0.3;
  const x = cols > 1 ? col / (cols - 1) : 0;
  const wave = Math.exp(-((x - phase) ** 2) / 0.015);
  return Math.min(1, 0.2 + 0.4 * flicker + 0.45 * wave * (0.5 + 0.5 * flicker));
}

// --- проявление ----------------------------------------------------------------------------

export interface RevealFrame {
  /** Сторона пикселя, CSS px: от PIXEL к 1. */
  block: number;
  /** Доля рассыпавшихся пикселей, 0..1 (ease-out). */
  gone: number;
  /** Видимость настоящего текста под пикселями, 0..1. */
  text: number;
  done: boolean;
}

/** Кадр проявления в момент elapsed мс: пиксели мельчают (4 → 2 → 1) и рассыпаются, текст проступает. */
export function revealFrame(elapsed: number, duration = REVEAL_MS): RevealFrame {
  const p = Math.min(1, Math.max(0, elapsed / duration));
  const block = p < 0.3 ? PIXEL : p < 0.6 ? PIXEL / 2 : 1;
  // первые 15 % строка целиком в пикселях, текст проступает с 30 %: глаз успевает увидеть «генерацию»
  const gone = easeOut(Math.max(0, (p - 0.15) / 0.85));
  const text = easeOut(Math.max(0, (p - 0.3) / 0.6));
  return { block, gone, text, done: p >= 1 };
}

/**
 * Жив ли пиксель (x, y) в CSS px на кадре f. Порог общий у пикселей одной крупной клетки
 * (с небольшим разбросом внутри), поэтому клетки рассыпаются пятнами в случайном порядке,
 * а не слева направо. К концу (gone = 1) не остаётся ни одного.
 */
export function cellAlive(x: number, y: number, gone: number, seed: number): boolean {
  const parent = hash01(Math.floor(x / PIXEL), Math.floor(y / PIXEL), seed);
  const jitter = hash01(x | 0, (y | 0) + 7919, seed) * 0.15;
  return parent * 0.85 + jitter >= gone;
}
