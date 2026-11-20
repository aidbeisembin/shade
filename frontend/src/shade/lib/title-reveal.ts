// «Пиксельное проявление» названия встречи: чистая часть без React и без canvas.
// Здесь решается, КОГДА играть (decideReveal), и КАК выглядит кадр в момент времени
// (revealFrame, blockSizes, cellThreshold, easeOut). Рисует и подключает к экрану
// components/PixelRevealText.tsx. Тесты: title-reveal.test.ts. Вид: docs/ui/meetings-list.md.
//
// Признак «название только что придумано» один: событие shade-title-set (onTitleSet,
// title-service.ts). Его шлёт только автоматика после записи названия ядром. Ручное
// переименование, загрузка списка при старте, прокрутка и перерисовки события не шлют.

/** Длительность проявления, мс (требование 700-900). */
export const REVEAL_MS = 800;
/** Сколько ждать, пока экран покажет название из события. Позже: проявление не играет. */
export const ARM_TTL_MS = 3000;
/** Доля времени на смену блоков; остаток уходит на переход от холста к обычному тексту. */
export const PIXEL_PHASE = 0.85;
/** К этой доле времени все клетки открыты (случайный порядок, dissolve). */
export const DISSOLVE_PHASE = 0.6;
/** Сторона клетки маски проявления, CSS px. Порядок клеток случайный, но постоянный за проигрыш. */
export const DISSOLVE_CELL = 8;

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

/**
 * Размеры блоков от крупного к 1 px: крупный около 0,4 кегля, степень двойки
 * (16 px кегль → 8, 4, 2, 1; 36 px → 16, 8, 4, 2, 1).
 */
export function blockSizes(fontSizePx: number): number[] {
  const start = 2 ** Math.max(1, Math.min(5, Math.round(Math.log2(Math.max(2, fontSizePx * 0.4)))));
  const out: number[] = [];
  for (let s = start; s >= 1; s /= 2) out.push(s);
  return out;
}

export interface RevealFrame {
  /** Сторона блока, CSS px; 1 в конце. */
  block: number;
  /** Сколько клеток открыто, 0..1 (с ease-out). */
  open: number;
  /** Сила зерна, 0..1: убывает к чёткому тексту. */
  grain: number;
  /** Видимость обычного текста под холстом, 0..1: растёт в последней фазе. */
  text: number;
  done: boolean;
}

/** Кадр в момент elapsed (мс) для заданной лестницы блоков. */
export function revealFrame(elapsed: number, sizes: number[], duration = REVEAL_MS): RevealFrame {
  const p = Math.min(1, Math.max(0, elapsed / duration));
  const pix = Math.min(1, p / PIXEL_PHASE);
  const step = Math.min(sizes.length - 1, Math.floor(pix * sizes.length));
  return {
    block: sizes[step] ?? 1,
    open: easeOut(Math.min(1, p / DISSOLVE_PHASE)),
    grain: Math.max(0, 1 - pix),
    text: p <= PIXEL_PHASE ? 0 : easeOut((p - PIXEL_PHASE) / (1 - PIXEL_PHASE)),
    done: p >= 1,
  };
}

/** Псевдослучайное число 0..1 для клетки (x, y) и зерна seed: одинаковое внутри одного проигрыша. */
export function cellThreshold(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Видимость клетки с порогом r при доле открытых open: мягкий край, а не щелчок. */
export function cellAlpha(open: number, r: number, soft = 0.2): number {
  // open 0 → ничего, open 1 → все клетки целиком (порог r < 1 всегда пройден)
  const v = (open * (1 + soft) - r) / soft;
  return Math.min(1, Math.max(0, v));
}
