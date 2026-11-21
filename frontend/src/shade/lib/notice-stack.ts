// Угол (CornerStack) стоит в правом нижнем углу колонки страницы, низ на одной линии с низом
// дока записи (RecordDock: кнопка записи, капсула, итог, карточки про микрофон). Ширина угла
// одна, CORNER_WIDTH (по самой длинной строке с кнопкой, ru и en, docs/ui/notifications.md);
// уже она бывает только в колонке уже CORNER_WIDTH + 2 × 16 px. Если сбоку от содержимого
// дока ширины нет, стек поднимается над доком на 8 px (--tile-gap), оставаясь справа: друг на
// друга док и угол не ложатся ни при какой ширине окна.
//
// RecordDock меряет себя и пишет в :root переменные, стиль угла в globals.css (.shade-corner)
// их читает:
//   --shade-stack-right   от правого края окна до правого края колонки дока;
//   --shade-stack-w       ширина колонки дока;
//   --shade-stack-bottom  от низа окна до низа дока;
//   --shade-toast-w       ширина угла;
//   --shade-stack-lift    высота содержимого дока плюс зазор, если угол не помещается сбоку; иначе 0.
// Подъём идёт через transform (translateY) с плавным переходом: когда карточка дока уходит или
// появляется, угол сдвигается плавно, без скачков раскладки.
'use client';

import { useEffect, useLayoutEffect, type RefObject } from 'react';

/** Зазор между доком и углом и между карточками угла, как между плитками (--tile-gap). */
export const STACK_GAP = 8;

/**
 * Ширина угла, px (--shade-toast-w). Самая длинная строка с кнопкой: «Доступна версия
 * 0.5.0-beta.2» 243 px + «Обновить» 99 px + круг, крестик, зазоры и поля 148 px = 490 px
 * (замер шрифтом приложения, docs/ui/notifications.md). Было до 400 px со сжатием до 360.
 */
export const CORNER_WIDTH = 500;
/** Прежнее имя ширины (тесты и стили). */
export const TOAST_WIDTH = CORNER_WIDTH;

/** Зазор сбоку между содержимым дока и углом (с запасом на ореол кнопки записи). */
export const SIDE_GAP = 24;

/** Отступ угла от правого края колонки, как поле дока (px-4). */
export const TOAST_EDGE = 16;

/**
 * Правый край видимого содержимого в строке дока: обёртки на всю ширину (w-full) не в счёт,
 * берётся первый вложенный элемент уже колонки.
 */
function contentRight(el: HTMLElement, full: number): number {
  let node: HTMLElement = el;
  while (node.offsetWidth >= full - 1 && node.firstElementChild instanceof HTMLElement) {
    node = node.firstElementChild;
  }
  return node.getBoundingClientRect().right;
}

/**
 * Ширина угла и нужен ли подъём над доком (чистая функция для теста). rights: правые края
 * содержимого строк дока; пустой список, если в доке пусто. Ширина одна: сбоку не помещается
 * целиком - подъём, а не сужение.
 */
export function cornerLayout(columnRight: number, columnWidth: number, rights: number[]): { width: number; lift: boolean } {
  const width = Math.max(0, Math.min(CORNER_WIDTH, columnWidth - 2 * TOAST_EDGE));
  if (rights.length === 0) return { width, lift: false };
  const free = columnRight - TOAST_EDGE - (Math.max(...rights) + SIDE_GAP);
  return { width, lift: free < width };
}

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const VARS = ['--shade-stack-right', '--shade-stack-w', '--shade-stack-bottom', '--shade-toast-w', '--shade-stack-lift'] as const;

let last = '';

function write(section: HTMLElement) {
  const rect = section.getBoundingClientRect();
  // Верх содержимого по раскладке (offsetTop), а не по getBoundingClientRect: у появляющихся
  // и уходящих элементов идёт transform, он не должен сдвигать стопку
  let top = section.offsetHeight;
  const rights: number[] = [];
  for (const child of Array.from(section.children) as HTMLElement[]) {
    if (child.offsetHeight > 0) {
      top = Math.min(top, child.offsetTop);
      rights.push(contentRight(child, section.offsetWidth));
    }
  }
  const content = section.offsetHeight - top;
  const corner = cornerLayout(rect.right, rect.width, content > 0 ? rights : []);
  const values = [
    `${Math.max(0, Math.round(window.innerWidth - rect.right))}px`,
    `${Math.round(rect.width)}px`,
    `${Math.max(0, Math.round(window.innerHeight - rect.bottom))}px`,
    `${corner.width}px`,
    `${corner.lift ? Math.round(content + STACK_GAP) : 0}px`,
  ];
  const key = values.join(' ');
  if (key === last) return;
  last = key;
  const root = document.documentElement.style;
  VARS.forEach((name, i) => root.setProperty(name, values[i]));
}

/**
 * Меряет док и держит переменные стопки в актуальном виде: после каждой отрисовки дока
 * (появилась или ушла карточка), при изменении его размера и окна.
 */
export function useNoticeStackAnchor(ref: RefObject<HTMLElement>) {
  // После каждой отрисовки: уходящая копия карточки и новые элементы
  useIsoLayoutEffect(() => {
    if (ref.current) write(ref.current);
  });

  useEffect(() => {
    const section = ref.current;
    if (!section) return;
    const update = () => write(section);
    const ro = new ResizeObserver(update);
    ro.observe(section);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      last = '';
      VARS.forEach((name) => document.documentElement.style.removeProperty(name));
    };
  }, [ref]);
}
