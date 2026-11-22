// Ширина угла и когда он поднимается над доком записи: bun test src/shade (pnpm test).
import { describe, expect, test } from 'bun:test';
import { CORNER_MIN, CORNER_WIDTH, cornerLayout, SIDE_GAP, TOAST_EDGE } from './notice-stack';

// Колонка 0..R, свободное место справа от содержимого дока: R - 16 - (right + 24)
const R = 1200;
const rightFor = (free: number) => R - TOAST_EDGE - SIDE_GAP - free;

describe('cornerLayout: в углу, до места сбоку от дока; меньше CORNER_MIN - подъём', () => {
  test('ширина угла до 500 px (самая длинная строка с кнопкой), не уже 360 px сбоку', () => {
    expect(CORNER_WIDTH).toBe(500);
    expect(CORNER_MIN).toBe(360);
  });
  test('пустой док: полная ширина, низ на линии дока', () => {
    expect(cornerLayout(R, R, [])).toEqual({ width: CORNER_WIDTH, lift: false });
  });
  test('сбоку больше 500: 500, рядом с доком', () => {
    expect(cornerLayout(R, R, [rightFor(CORNER_WIDTH + 200)])).toEqual({ width: CORNER_WIDTH, lift: false });
  });
  test('сбоку 420: сужается до 420 и стоит рядом, в кнопку не упирается', () => {
    const r = cornerLayout(R, R, [rightFor(420)]);
    expect(r).toEqual({ width: 420, lift: false });
    // левый край угла правее содержимого дока с зазором
    expect(R - TOAST_EDGE - r.width).toBeGreaterThanOrEqual(rightFor(420) + SIDE_GAP);
  });
  test('сбоку ровно CORNER_MIN: ещё рядом; на 1 px меньше - над доком во всю ширину', () => {
    expect(cornerLayout(R, R, [rightFor(CORNER_MIN)])).toEqual({ width: CORNER_MIN, lift: false });
    expect(cornerLayout(R, R, [rightFor(CORNER_MIN - 1)])).toEqual({ width: CORNER_WIDTH, lift: true });
  });
  test('окно 1100 (колонка 1004) и кнопка записи 104 px: рядом с кнопкой, 410 px', () => {
    const col = 1004;
    expect(cornerLayout(col, col, [col / 2 + 52])).toEqual({ width: 410, lift: false });
  });
  test('широкое окно (колонка 1400) и кнопка записи: рядом, 500 px', () => {
    const col = 1400;
    expect(cornerLayout(col, col, [col / 2 + 52])).toEqual({ width: CORNER_WIDTH, lift: false });
  });
  test('капсула записи или итог в доке (широкая строка): над доком', () => {
    const col = 1004;
    expect(cornerLayout(col, col, [col / 2 + 52, col / 2 + 260])).toEqual({ width: CORNER_WIDTH, lift: true });
  });
  test('окно 640 (колонка 544) и кнопка записи: над доком, ширина колонки без полей', () => {
    expect(cornerLayout(544, 544, [272 + 52])).toEqual({ width: 500, lift: true });
  });
  test('узкая колонка 420: угол во всю колонку без полей; сбоку места нет - над доком', () => {
    expect(cornerLayout(420, 420, [300])).toEqual({ width: 388, lift: true });
  });
  test('свободное место дробное: ширина целая, вниз', () => {
    expect(cornerLayout(R, R, [rightFor(420.6)]).width).toBe(420);
  });
});
