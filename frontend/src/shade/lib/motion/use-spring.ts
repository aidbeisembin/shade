// @umbra/motion (реестр Umbra, https://aidbeisembin.com/components/r/motion.json, umbra e0fcad4),
// поставлен npx shadcn add @umbra/motion и перенесён из components/lib/motion в слой Shade без правок.
// Обновлять заменой файла из реестра, свои значения пружин Shade держать в lib/motion/shade-springs.ts.
"use client";

import * as React from "react";
import { spring, type Spring, type PresetName } from "./spring";

// На сервере эффектов нет; useLayoutEffect там предупреждает, поэтому на сервере пустая замена.
const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Пружина, которая пишет прямо в DOM из кадра: apply(el, x, v) ставит transform или CSS-переменную, без setState на
 * кадр. Значение покоя from рисует сама разметка (SSR и гидрация без движения); пружина берёт элемент после монтирования.
 * Цель задаётся в эффекте: s.to(цель). При размонтировании пружина останавливается. precision: порог покоя в единицах
 * значения (0,5 для px), по умолчанию 0,001.
 */
export function useSpring<E extends Element>(
  ref: React.RefObject<E | null>,
  apply: (el: E, x: number, v: number) => void,
  preset: PresetName,
  from = 0,
  precision?: number,
): Spring {
  const applyRef = React.useRef(apply);
  useIsoLayoutEffect(() => {
    applyRef.current = apply;
  });
  const [s] = React.useState(() =>
    spring(from, {
      preset,
      precision,
      onUpdate: (x, v) => {
        const el = ref.current;
        if (el) applyRef.current(el, x, v);
      },
    }),
  );
  // Значение покоя в DOM сразу после монтирования: дальше элементом владеет пружина, и запасное значение разметки
  // (data-state и т. п.) не мелькает кадр, пока пружина не сделала первый шаг.
  useIsoLayoutEffect(() => {
    if (ref.current) applyRef.current(ref.current, s.value, s.velocity);
  }, [s]);
  React.useEffect(() => () => s.stop(), [s]);
  return s;
}
