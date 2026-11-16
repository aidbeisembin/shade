// @umbra/motion (реестр Umbra, https://aidbeisembin.com/components/r/motion.json, umbra e0fcad4),
// поставлен npx shadcn add @umbra/motion и перенесён из components/lib/motion в слой Shade без правок.
// Обновлять заменой файла из реестра, свои значения пружин Shade держать в lib/motion/shade-springs.ts.
import { PRESETS, type PresetName } from "./presets";

export { PRESETS, STAGGER_MS, overshoot, dampingRatio, type PresetName, type Preset, type Role } from "./presets";

/** Настройка пружины: имя пресета или своя пара k, c (своя пара только внутри @umbra/motion и в проверках). */
export interface Tune {
  preset?: PresetName;
  k?: number;
  c?: number;
}

export interface SpringOptions extends Tune {
  /** Порог покоя в единицах значения: 0,001 для долей (по умолчанию), 0,5 для px. */
  precision?: number;
  /** Каждый кадр движения и последний кадр на цели. Сюда пишут в DOM (transform, CSS-переменная), без setState. */
  onUpdate?: (x: number, v: number) => void;
  /** Пружина встала на цель и вышла из списка. */
  onRest?: (x: number) => void;
}

export interface Spring {
  readonly value: number;
  readonly target: number;
  readonly velocity: number;
  /** Не в списке движения. */
  readonly resting: boolean;
  /** Новая цель; скорость сохраняется. Можно сразу сменить настройку (роли краёв вкладок при развороте).
   * При reduced motion встаёт на цель сразу. */
  to(target: number, tune?: Tune): void;
  /** Встать на значение сразу, без движения и скорости. */
  set(x: number): void;
  /** Толчок: добавить скорость. При reduced motion ничего не делает. */
  kick(v: number): void;
  /** Сменить настройку, не трогая позицию и скорость. */
  tune(t: Tune): void;
  /** Остановиться там, где сейчас. */
  stop(): void;
}

interface State {
  x: number;
  v: number;
  t: number;
  k: number;
  c: number;
  /** Порог покоя по x; по скорости: 0,001 или точность·√k, если точность своя. */
  p: number;
  pv?: number;
  onUpdate?: (x: number, v: number) => void;
  onRest?: (x: number) => void;
}

interface Timer {
  left: number;
  fn: () => void;
}

const EPS = 0.001;
const SUBSTEPS = 4;
const MAX_DT = 1 / 30;

const springs = new Set<State>();
const drivers = new Set<(dt: number) => boolean | void>();
const timers: Timer[] = [];
let timeScale = 1;
let raf: number | null = null;
let last = 0;
let boundVisibility = false;
let reducedOverride: boolean | null = null;
let reducedQuery: MediaQueryList | null | undefined;

// globalThis, а не window: модуль импортируется на сервере и в node --test.
const g = globalThis as unknown as {
  requestAnimationFrame?: (cb: (t: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
  matchMedia?: (q: string) => MediaQueryList;
  performance?: { now(): number };
  document?: Document;
};

const nowMs = () => g.performance?.now() ?? Date.now();
const isHidden = () => g.document?.visibilityState === "hidden";

/** Настройка «уменьшить движение»: своя, если задана setReducedMotion, иначе системная. */
export function prefersReducedMotion(): boolean {
  if (reducedOverride !== null) return reducedOverride;
  if (reducedQuery === undefined) {
    reducedQuery = typeof g.matchMedia === "function" ? g.matchMedia("(prefers-reduced-motion: reduce)") : null;
    // Включили на лету: всё, что едет, встаёт на цель сразу.
    reducedQuery?.addEventListener?.("change", (e) => e.matches && calm());
  }
  return reducedQuery?.matches ?? false;
}

/** Переопределить reduced motion (проверки, настройка продукта); null возвращает системную. */
export function setReducedMotion(on: boolean | null) {
  reducedOverride = on;
  if (on) calm();
}

function calm() {
  for (const s of [...springs]) rest(s);
}

/** Замедление времени: 0,25 для разбора движения. Таймеры after() замедляются вместе с пружинами. */
export function setTimeScale(scale: number) {
  if (Number.isFinite(scale) && scale > 0) timeScale = scale;
}
export function getTimeScale() {
  return timeScale;
}

function tuneState(s: State, t: Tune) {
  const p = t.preset ? PRESETS[t.preset] : undefined;
  const k = t.k ?? p?.k;
  const c = t.c ?? p?.c;
  if (k !== undefined && Number.isFinite(k) && k > 0) s.k = k;
  if (c !== undefined && Number.isFinite(c) && c >= 0) s.c = c;
}

function stepState(s: State, h: number) {
  const a = -s.k * (s.x - s.t) - s.c * s.v;
  s.v += a * h;
  s.x += s.v * h;
}

const still = (s: State) => Math.abs(s.x - s.t) < s.p && Math.abs(s.v) < (s.pv ?? s.p * Math.sqrt(s.k));

function rest(s: State) {
  s.x = s.t;
  s.v = 0;
  springs.delete(s);
  s.onUpdate?.(s.x, 0);
  s.onRest?.(s.x);
}

/** Один кадр симуляции: таймеры, драйверы, 4 подшага пружин, запись в DOM, покой. */
function frame(dt: number) {
  for (const tm of [...timers]) {
    tm.left -= dt * 1000;
    if (tm.left <= 0) {
      const i = timers.indexOf(tm);
      if (i > -1) {
        timers.splice(i, 1);
        tm.fn();
      }
    }
  }
  for (const d of [...drivers]) if (drivers.has(d) && d(dt) === false) drivers.delete(d);
  // Reduced motion: шагов нет, всё в списке на цели в этом же кадре (настройку могли включить без события).
  if (prefersReducedMotion()) calm();
  const h = dt / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) for (const s of springs) stepState(s, h);
  for (const s of [...springs]) {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.v)) rest(s);
    else if (still(s)) rest(s);
    else s.onUpdate?.(s.x, s.v);
  }
}

const pending = () => springs.size > 0 || drivers.size > 0 || timers.length > 0;

function loop(t: number) {
  raf = null;
  let dt = (t - last) / 1000;
  last = t;
  if (!(dt > 0)) dt = 0; // NaN, отрицательное, повтор метки
  frame(Math.min(dt, MAX_DT) * timeScale);
  // Цикл продолжается сам, метка последнего кадра остаётся от rAF; пустой список: цикл стоит.
  if (pending() && !isHidden()) raf = g.requestAnimationFrame!(loop);
}

/** Вкладку скрыли: кадров не будет, пружины встают на цель сразу. Вернули: цикл продолжается с новой меткой. */
function bindVisibility() {
  if (boundVisibility || !g.document) return;
  boundVisibility = true;
  g.document.addEventListener("visibilitychange", () => {
    if (isHidden()) {
      if (raf !== null) g.cancelAnimationFrame?.(raf);
      raf = null;
      for (const s of [...springs]) rest(s);
    } else if (pending()) schedule();
  });
}

function schedule() {
  if (raf !== null || typeof g.requestAnimationFrame !== "function") return;
  bindVisibility();
  if (isHidden()) {
    for (const s of [...springs]) rest(s);
    return;
  }
  if (!pending()) return;
  // Старт из покоя: первый dt от текущего времени, простой не копится.
  last = nowMs();
  raf = g.requestAnimationFrame(loop);
}

function wake(s: State) {
  if (still(s)) {
    if (springs.has(s)) rest(s);
    else s.x = s.t;
    return;
  }
  springs.add(s);
  schedule();
}

/** Пружина от значения from. Настройка: preset или k, c; по умолчанию settle. */
export function spring(from: number, opts: SpringOptions = {}): Spring {
  const custom = opts.precision !== undefined && Number.isFinite(opts.precision) && opts.precision > 0;
  const s: State = {
    x: from,
    v: 0,
    t: from,
    k: PRESETS.settle.k,
    c: PRESETS.settle.c,
    p: custom ? opts.precision! : EPS,
    pv: custom ? undefined : EPS,
    onUpdate: opts.onUpdate,
    onRest: opts.onRest,
  };
  tuneState(s, opts);
  return {
    get value() {
      return s.x;
    },
    get target() {
      return s.t;
    },
    get velocity() {
      return s.v;
    },
    get resting() {
      return !springs.has(s);
    },
    to(target, tune) {
      if (tune) tuneState(s, tune);
      if (!Number.isFinite(target)) return;
      s.t = target;
      if (prefersReducedMotion()) rest(s);
      else wake(s);
    },
    set(x) {
      if (!Number.isFinite(x)) return;
      s.x = s.t = x;
      s.v = 0;
      springs.delete(s);
      s.onUpdate?.(x, 0);
    },
    kick(v) {
      if (!Number.isFinite(v) || prefersReducedMotion()) return;
      s.v += v;
      wake(s);
    },
    tune(t) {
      tuneState(s, t);
    },
    stop() {
      s.t = s.x;
      s.v = 0;
      springs.delete(s);
    },
  };
}

/**
 * Таймер во времени движка: на ×0,25 ждёт вчетверо дольше, пока вкладка скрыта, стоит. Возвращает отмену.
 */
export function after(ms: number, fn: () => void): () => void {
  const tm: Timer = { left: ms, fn };
  timers.push(tm);
  schedule();
  return () => {
    const i = timers.indexOf(tm);
    if (i > -1) timers.splice(i, 1);
  };
}

/**
 * Драйвер: функция каждого кадра с dt в секундах движка (заливка удержания идёт по этим часам). Вернула false: снята.
 * Возвращает снятие.
 */
export function onFrame(fn: (dt: number) => boolean | void): () => void {
  drivers.add(fn);
  schedule();
  return () => {
    drivers.delete(fn);
  };
}

/**
 * Траектория без DOM и кадров, тем же расчётом, что цикл (проверки, таблица в DESIGN.md): кадры по 1/fps с, 4 подшага,
 * reduced motion не учитывается. Возвращает позицию после каждого кадра.
 */
export function simulate(t: Tune & { from?: number; to?: number; v?: number; fps?: number; seconds?: number }): number[] {
  const s: State = { x: t.from ?? 0, v: t.v ?? 0, t: t.to ?? 0, k: PRESETS.settle.k, c: PRESETS.settle.c, p: EPS };
  tuneState(s, t);
  const dt = 1 / (t.fps ?? 60);
  const out: number[] = [];
  for (let i = 0; i < (t.seconds ?? 2) / dt; i++) {
    for (let j = 0; j < SUBSTEPS; j++) stepState(s, dt / SUBSTEPS);
    out.push(s.x);
  }
  return out;
}

/** Для проверок: сколько всего в списке и идёт ли цикл. */
export const engineState = () => ({ springs: springs.size, drivers: drivers.size, timers: timers.length, running: raf !== null });
