// «Пиксельное проявление» названия: когда играть и как идёт время. Запуск: bun test src/shade (pnpm test).
import { describe, expect, test } from 'bun:test';
import {
  ARM_TTL_MS,
  REVEAL_MS,
  blockSizes,
  cellAlpha,
  cellThreshold,
  decideReveal,
  easeOut,
  revealFrame,
  type RevealInput,
} from './title-reveal';

const PLACEHOLDER = 'Встреча 20 ноября, 18:04';
const base: RevealInput = { armed: { title: 'Сроки релиза', at: 1000 }, prev: PLACEHOLDER, next: 'Сроки релиза', now: 1200, reducedMotion: false };

describe('decideReveal: таблица случаев', () => {
  test('событие и смена плейсхолдера на придуманное: играет', () => {
    expect(decideReveal(base)).toBe(true);
  });

  test('без события (старт приложения, загрузка списка): не играет', () => {
    expect(decideReveal({ ...base, armed: null })).toBe(false);
  });

  test('перерисовка и прокрутка: текст не менялся, не играет', () => {
    expect(decideReveal({ ...base, prev: 'Сроки релиза' })).toBe(false);
  });

  test('ручное переименование: события нет, не играет', () => {
    expect(decideReveal({ ...base, armed: null, next: 'Моё название' })).toBe(false);
  });

  test('человек переименовал, пока шло событие: на экране не то название, не играет', () => {
    expect(decideReveal({ ...base, next: 'Моё название' })).toBe(false);
  });

  test('событие устарело (строка показалась позже срока): не играет', () => {
    expect(decideReveal({ ...base, now: base.armed!.at + ARM_TTL_MS + 1 })).toBe(false);
    expect(decideReveal({ ...base, now: base.armed!.at + ARM_TTL_MS })).toBe(true);
  });

  test('«уменьшить движение»: не играет, название сразу итоговое', () => {
    expect(decideReveal({ ...base, reducedMotion: true })).toBe(false);
  });

  test('пробелы по краям не мешают сравнению; пустое название не играет', () => {
    expect(decideReveal({ ...base, armed: { title: ' Сроки релиза ', at: 1000 } })).toBe(true);
    expect(decideReveal({ ...base, armed: { title: '', at: 1000 }, next: '' })).toBe(false);
  });
});

describe('время проявления', () => {
  test('длительность в пределах 700-900 мс', () => {
    expect(REVEAL_MS).toBeGreaterThanOrEqual(700);
    expect(REVEAL_MS).toBeLessThanOrEqual(900);
  });

  test('easeOut: 0 → 0, 1 → 1, быстрее линейного в начале, за пределами зажат', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.25)).toBeGreaterThan(0.25);
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(2)).toBe(1);
  });

  test('лестница блоков: степени двойки до 1 px, крупнее у крупного кегля', () => {
    expect(blockSizes(16)).toEqual([8, 4, 2, 1]);
    expect(blockSizes(36)).toEqual([16, 8, 4, 2, 1]);
    expect(blockSizes(4)[blockSizes(4).length - 1]).toBe(1);
  });

  test('кадры: блоки только уменьшаются, клеток открывается всё больше, зерно гаснет', () => {
    const sizes = blockSizes(36);
    let prev = revealFrame(0, sizes);
    expect(prev.block).toBe(16);
    expect(prev.open).toBe(0);
    expect(prev.grain).toBe(1);
    for (let t = 16; t <= REVEAL_MS; t += 16) {
      const f = revealFrame(t, sizes);
      expect(f.block).toBeLessThanOrEqual(prev.block);
      expect(f.open).toBeGreaterThanOrEqual(prev.open);
      expect(f.grain).toBeLessThanOrEqual(prev.grain);
      expect(f.text).toBeGreaterThanOrEqual(prev.text);
      prev = f;
    }
  });

  test('конец: блок 1 px, всё открыто, без зерна, обычный текст виден полностью', () => {
    const f = revealFrame(REVEAL_MS, blockSizes(16));
    expect(f).toEqual({ block: 1, open: 1, grain: 0, text: 1, done: true });
    expect(revealFrame(REVEAL_MS * 2, blockSizes(16)).done).toBe(true);
  });

  test('обычный текст под холстом скрыт, пока идут блоки', () => {
    expect(revealFrame(REVEAL_MS * 0.5, blockSizes(16)).text).toBe(0);
  });
});

describe('случайный порядок клеток (dissolve)', () => {
  test('порог в 0..1 и постоянный для клетки и зерна', () => {
    for (let x = 0; x < 40; x++) {
      const r = cellThreshold(x, 3, 7);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      expect(cellThreshold(x, 3, 7)).toBe(r);
    }
  });

  test('не слева направо: пороги соседних клеток в ряду не растут монотонно', () => {
    const row = Array.from({ length: 30 }, (_, x) => cellThreshold(x, 0, 1));
    const rising = row.every((v, i) => i === 0 || v >= row[i - 1]);
    expect(rising).toBe(false);
  });

  test('видимость клетки: 0 в начале, 1 в конце при любом пороге', () => {
    for (const r of [0, 0.3, 0.99]) {
      expect(cellAlpha(0, r)).toBe(0);
      expect(cellAlpha(1, r)).toBe(1);
    }
  });
});
