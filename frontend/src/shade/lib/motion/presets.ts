// @umbra/motion (реестр Umbra, https://aidbeisembin.com/components/r/motion.json, umbra e0fcad4),
// поставлен npx shadcn add @umbra/motion и перенесён из components/lib/motion в слой Shade без правок.
// Обновлять заменой файла из реестра, свои значения пружин Shade держать в lib/motion/shade-springs.ts.
export type Role = "surface" | "control" | "refusal";

export interface Preset {
  /** Жёсткость. */
  k: number;
  /** Затухание. */
  c: number;
  role: Role;
  /** Только у отказа: скорость толчка, px/с, и размах первого качания при нём, px. */
  kick?: { v: number; peak: number };
}

/** Потолок перелёта по роли (доля хода). У отказа перелёта нет: он запускается толчком. */
export const ROLE_CEILING: Record<Exclude<Role, "refusal">, number> = { surface: 0.04, control: 0.2 };

export const PRESETS = {
  // Общие
  // то, что ведёт палец: без перелёта и без отставания
  follow: { k: 900, c: 50, role: "surface" },
  // прозрачность и мелкие сдвиги
  fade: { k: 420, c: 32, role: "surface" },
  // крупное: панели, листы, сдвиг всего компонента
  soft: { k: 260, c: 24, role: "surface" },
  // передний край тянущейся подсветки
  lead: { k: 620, c: 36, role: "surface" },
  // отпустили, значение садится с одним небольшим перелётом
  settle: { k: 280, c: 22, role: "control" },
  // задний край тянущейся подсветки: из-за него она тянется
  trail: { k: 190, c: 19, role: "control" },
  // отклик знака или числа при выборе, нажатие
  pop: { k: 520, c: 21, role: "control" },
  // Компонентные
  // Toggle: ход ручки
  toggle: { k: 320, c: 18, role: "control" },
  // Toggle: вытягивание ручки при нажатии
  toggleStretch: { k: 300, c: 20, role: "control" },
  // вкладки (MorphIndicator edges): край по ходу движения
  tabsLead: { k: 620, c: 40, role: "control" },
  // вкладки (MorphIndicator edges): отстающий край
  tabsTrail: { k: 170, c: 19, role: "control" },
  // HoldButton: заливка уходит назад, когда отпустили раньше
  holdReturn: { k: 260, c: 15.5, role: "control" },
  // HoldButton: таблетка сжимается в круг и обратно
  holdShape: { k: 320, c: 20, role: "control" },
  // HoldButton: качание «нет», когда отпустили раньше
  holdShake: { k: 700, c: 9, role: "refusal", kick: { v: 260, peak: 7.5 } },
} as const satisfies Record<string, Preset>;

export type PresetName = keyof typeof PRESETS;

/** Шаг между элементами, которые входят один за другим, мс. */
export const STAGGER_MS = 45;

/** Коэффициент затухания ζ = c / (2√k). */
export const dampingRatio = (k: number, c: number) => c / (2 * Math.sqrt(k));

/** Перелёт после шага (доля хода): exp(−πζ / √(1 − ζ²)); 0 при ζ ≥ 1. */
export function overshoot(k: number, c: number): number {
  const z = dampingRatio(k, c);
  return z >= 1 ? 0 : Math.exp((-Math.PI * z) / Math.sqrt(1 - z * z));
}
