// Ширина тостов в углу и когда они поднимаются над доком записи: bun test src/shade (pnpm test).
import { describe, expect, test } from 'bun:test';
import { cornerLayout, SIDE_GAP, TOAST_EDGE, TOAST_MIN_WIDTH, TOAST_WIDTH } from './notice-stack';

// Колонка 0..1000, свободное место справа от содержимого: 1000 - 16 - (right + 16)
const R = 1000;
const freeFor = (width: number) => R - TOAST_EDGE - SIDE_GAP - width;

describe('cornerLayout', () => {
  test('пустой док: полная ширина, без подъёма', () => {
    expect(cornerLayout(R, 1000, [])).toEqual({ width: TOAST_WIDTH, lift: false });
  });
  test('места справа больше 400: полная ширина, без подъёма', () => {
    expect(cornerLayout(R, 1000, [550])).toEqual({ width: TOAST_WIDTH, lift: false });
  });
  test('места 390: тост сужается до 390, в углу', () => {
    expect(cornerLayout(R, 1000, [freeFor(390)])).toEqual({ width: 390, lift: false });
  });
  test('места 340 (окно 960, кнопка записи): подпись не влезла бы в две строки, тост над доком', () => {
    expect(cornerLayout(R, 1000, [freeFor(340)])).toEqual({ width: TOAST_WIDTH, lift: true });
  });
  test('ровно минимум: в углу', () => {
    expect(cornerLayout(R, 1000, [freeFor(TOAST_MIN_WIDTH)])).toEqual({ width: TOAST_MIN_WIDTH, lift: false });
  });
  test('меньше минимума: полная ширина и подъём над доком', () => {
    expect(cornerLayout(R, 1000, [freeFor(TOAST_MIN_WIDTH - 1)])).toEqual({ width: TOAST_WIDTH, lift: true });
  });
  test('считается по самой широкой строке дока', () => {
    expect(cornerLayout(R, 1000, [500, 900])).toEqual({ width: TOAST_WIDTH, lift: true });
  });
  test('узкая колонка 300: тост во всю колонку без полей, над доком', () => {
    expect(cornerLayout(300, 300, [190])).toEqual({ width: 268, lift: true });
  });
});
