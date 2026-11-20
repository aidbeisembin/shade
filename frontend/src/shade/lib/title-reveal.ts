// Проявление придуманного названия встречи перебором букв: чистая часть без React.
// Здесь решается, КОГДА играть (decideReveal), и что видно в момент времени (scrambleFrame).
// Показывает components/TitleReveal.tsx. Тесты: title-reveal.test.ts. Вид: docs/ui/foundations.md.
//
// Признак «название только что придумано» один: событие shade-title-set (onTitleSet,
// title-service.ts). Его шлёт только автоматика после записи названия ядром. Ручное
// переименование, загрузка списка при старте, прокрутка и перерисовки события не шлют.

/** Длительность проявления, мс (требование 700-900). */
export const REVEAL_MS = 800;
/** Сколько ждать, пока экран покажет название из события. Позже: проявление не играет. */
export const ARM_TTL_MS = 3000;
/** Как часто меняются случайные буквы, мс: чаще мельтешит, реже выглядит как зависание. */
export const SCRAMBLE_TICK_MS = 50;
/** Доли длительности, в которые буквы встают на место: первая чуть позже начала, последняя до конца. */
export const SETTLE_FROM = 0.1;
export const SETTLE_TO = 0.9;

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

/**
 * Когда буква i встаёт на место, мс. Порядок случайный (не слева направо), а сколько букв
 * уже на месте, растёт по ease-out: большая часть встаёт быстро, последние медленнее.
 */
export function settleAt(i: number, seed: number, duration = REVEAL_MS): number {
  const r = hash01(i, 7, seed);
  // обратная к easeOut: доля встающих букв к моменту p равна easeOut(p)
  const p = 1 - Math.cbrt(1 - r);
  return duration * (SETTLE_FROM + (SETTLE_TO - SETTLE_FROM) * p);
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => String.fromCharCode(from + k));
// Буквы того же письма, что и в названии: без кириллицы в коде (страж языка), по кодам Unicode
const CYR_LOWER = range(0x430, 0x44f);
const CYR_UPPER = range(0x410, 0x42f);
const LAT_LOWER = range(0x61, 0x7a);
const LAT_UPPER = range(0x41, 0x5a);
const DIGITS = range(0x30, 0x39);

/** Чем заменять букву, пока она не на месте; null: показывать как есть (пробел, знаки). */
export function poolFor(ch: string): string[] | null {
  if (/\p{Script=Cyrillic}/u.test(ch)) return ch === ch.toUpperCase() ? CYR_UPPER : CYR_LOWER;
  if (/[a-z]/.test(ch)) return LAT_LOWER;
  if (/[A-Z]/.test(ch)) return LAT_UPPER;
  if (/\d/.test(ch)) return DIGITS;
  return null;
}

export interface ScrambleChar {
  ch: string;
  /** Буква уже на месте (настоящая). */
  settled: boolean;
}

export interface ScrambleFrame {
  chars: ScrambleChar[];
  done: boolean;
}

/** Что видно в момент elapsed: стоящие на месте буквы и случайные на месте остальных. */
export function scrambleFrame(text: string, elapsed: number, seed: number, duration = REVEAL_MS): ScrambleFrame {
  const tick = Math.floor(Math.max(0, elapsed) / SCRAMBLE_TICK_MS);
  const chars = Array.from(text).map((ch, i) => {
    const pool = poolFor(ch);
    if (!pool || elapsed >= settleAt(i, seed, duration)) return { ch, settled: true };
    return { ch: pool[Math.floor(hash01(i, tick, seed) * pool.length)], settled: false };
  });
  return { chars, done: elapsed >= duration };
}
