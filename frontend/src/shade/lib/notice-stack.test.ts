// Ширина угла и когда он поднимается над доком записи: bun test src/shade (pnpm test).
import { describe, expect, test } from 'bun:test';
import { CORNER_WIDTH, cornerLayout, SIDE_GAP, TOAST_EDGE } from './notice-stack';

// Колонка 0..R, свободное место справа от содержимого дока: R - 16 - (right + 24)
const R = 1200;
const rightFor = (free: number) => R - TOAST_EDGE - SIDE_GAP - free;

describe('cornerLayout: одна ширина, подъём вместо сужения', () => {
  test('ширина угла 500 px (самая длинная строка с кнопкой)', () => {
    expect(CORNER_WIDTH).toBe(500);
  });
  test('пустой док: полная ширина, низ на линии дока', () => {
    expect(cornerLayout(R, R, [])).toEqual({ width: CORNER_WIDTH, lift: false });
  });
  test('сбоку ровно ширина угла: стоит рядом с доком', () => {
    expect(cornerLayout(R, R, [rightFor(CORNER_WIDTH)])).toEqual({ width: CORNER_WIDTH, lift: false });
  });
  test('на 1 px меньше: не сужается, а поднимается над доком', () => {
    expect(cornerLayout(R, R, [rightFor(CORNER_WIDTH - 1)])).toEqual({ width: CORNER_WIDTH, lift: true });
  });
  test('окно 1100 (колонка 1004) и кнопка записи 104 px: над доком справа', () => {
    const col = 1004;
    expect(cornerLayout(col, col, [col / 2 + 52])).toEqual({ width: CORNER_WIDTH, lift: true });
  });
  test('широкое окно (колонка 1400) и кнопка записи: рядом с кнопкой', () => {
    const col = 1400;
    expect(cornerLayout(col, col, [col / 2 + 52])).toEqual({ width: CORNER_WIDTH, lift: false });
  });
  test('считается по самой широкой строке дока', () => {
    expect(cornerLayout(R, R, [300, 900])).toEqual({ width: CORNER_WIDTH, lift: true });
  });
  test('узкая колонка 420: угол во всю колонку без полей, над доком', () => {
    expect(cornerLayout(420, 420, [300])).toEqual({ width: 388, lift: true });
  });
});
