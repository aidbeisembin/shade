// Тосты (ShadeToaster, sonner) стоят в правом нижнем углу колонки страницы, на одной высоте
// с низом дока записи (RecordDock: кнопка записи, капсула, карточка итога, карточки про
// микрофон). Ширина тоста до 400 px; если справа от содержимого дока места меньше, тост
// сужается до него, но не уже 300 px. Если и так не помещается (узкое окно, широкая карточка),
// тосты во всю ширину поднимаются над доком на 8 px (--tile-gap): друг на друга уведомления
// не ложатся ни при какой ширине окна.
//
// RecordDock меряет себя и пишет в :root четыре переменные, стиль тостера в globals.css
// (.shade-toaster) их читает:
//   --shade-stack-right   от правого края окна до правого края колонки дока;
//   --shade-stack-w       ширина колонки дока (тосты не шире неё);
//   --shade-stack-bottom  от низа окна до низа дока;
//   --shade-toast-w       ширина тоста;
//   --shade-stack-lift    высота содержимого дока плюс зазор, если тосты не помещаются сбоку; иначе 0.
// Подъём идёт через transform (translateY) с плавным переходом: когда карточка уходит или
// появляется, тосты сдвигаются плавно, без скачков раскладки.
'use client';

import { useEffect, useLayoutEffect, type RefObject } from 'react';

/** Зазор между доком и тостами, как между плитками (--tile-gap). */
export const STACK_GAP = 8;

/** Ширина тоста, px (--shade-toast-w); сбоку от дока может быть уже. */
export const TOAST_WIDTH = 400;

/** Уже тост не сужается: подпись переносится целиком, при 300 px это три строки по 20-25 символов. */
export const TOAST_MIN_WIDTH = 300;

/** Зазор сбоку между содержимым дока и тостом (с запасом на ореол кнопки записи). */
export const SIDE_GAP = 24;

/** Отступ тостов от правого края колонки, как поле дока (px-4). */
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
 * Ширина тоста и нужен ли подъём над доком (чистая функция для теста). rights: правые края
 * содержимого строк дока; пустой список, если в доке пусто.
 */
export function cornerLayout(columnRight: number, columnWidth: number, rights: number[]): { width: number; lift: boolean } {
  const full = Math.max(0, Math.min(TOAST_WIDTH, columnWidth - 2 * TOAST_EDGE));
  if (rights.length === 0) return { width: full, lift: false };
  const free = columnRight - TOAST_EDGE - (Math.max(...rights) + SIDE_GAP);
  if (free >= Math.min(TOAST_MIN_WIDTH, full)) return { width: Math.min(full, Math.floor(free)), lift: false };
  return { width: full, lift: true };
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
