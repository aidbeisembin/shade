// Свои пружины Shade поверх движка @umbra/motion (spring.ts). Значения перенесены из образцов
// владельца: «Star Rating» (DesignBookmark) и «Morph Popover» (Kokonut UI, MIT). В пресетах Umbra
// таких нет, поэтому пара k, c здесь, а не в presets.ts (тот файл обновляется заменой из реестра).
// Таблица «свойство, пружина, перелёт, что при прерывании»: docs/ui/feedback.md.

import { overshoot, type Tune } from './spring';

/** Заливка звезды 0 → 1 (и обратно): жёсткость 300, затухание 24. */
export const STAR_FILL: Tune = { k: 300, c: 24 };
/** «Прыжок» звезды при зажигании: масштаб от STAR_POP_FROM с толчком STAR_POP_VELOCITY к 1. */
export const STAR_POP: Tune = { k: 520, c: 13 };
export const STAR_POP_FROM = 0.7;
export const STAR_POP_VELOCITY = 7;
/** Звёзды до указателя зажигаются по очереди с этим шагом, мс. */
export const STAR_STAGGER_MS = 50;
/** Подпись под звёздами перекатывается: 260 / 22. */
export const LABEL_ROLL: Tune = { k: 260, c: 22 };
/** Перетекание кнопки в форму и обратно (Morph Popover), поверхность: пресет soft Umbra. */
export const MORPH: Tune = { preset: 'soft' };
/** Плашка «Спасибо» держится, потом форма возвращается в кнопку, мс. */
export const THANKS_HOLD_MS = 1600;

/** Перелёт пружины после шага, доля хода (для таблицы движения и проверки). */
export const overshootOf = (t: Tune) => overshoot(t.k ?? 0, t.c ?? 0);
