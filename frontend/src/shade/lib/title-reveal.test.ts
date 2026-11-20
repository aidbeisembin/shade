// Проявление придуманного названия: когда играть и что видно во времени. Запуск: bun test src/shade (pnpm test).
import { describe, expect, test } from 'bun:test';
import {
  ARM_TTL_MS,
  REVEAL_MS,
  SCRAMBLE_TICK_MS,
  decideReveal,
  easeOut,
  hash01,
  poolFor,
  scrambleFrame,
  settleAt,
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

describe('перебор букв во времени', () => {
  const text = 'Сроки релиза 2.3, Q4';

  test('длительность в пределах 700-900 мс, буквы меняются не реже 20 раз в секунду', () => {
    expect(REVEAL_MS).toBeGreaterThanOrEqual(700);
    expect(REVEAL_MS).toBeLessThanOrEqual(900);
    expect(SCRAMBLE_TICK_MS).toBeLessThanOrEqual(50);
  });

  test('easeOut: 0 → 0, 1 → 1, быстрее линейного в начале, за пределами зажат', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.25)).toBeGreaterThan(0.25);
    expect(easeOut(-1)).toBe(0);
    expect(easeOut(2)).toBe(1);
  });

  test('в начале ни одна буква не на месте, пробелы и знаки не перебираются', () => {
    const f = scrambleFrame(text, 0, 42);
    Array.from(text).forEach((ch, i) => {
      if (poolFor(ch)) expect(f.chars[i].settled).toBe(false);
      else expect(f.chars[i]).toEqual({ ch, settled: true });
    });
  });

  test('длина не меняется в любой момент: строка не прыгает по числу знаков', () => {
    for (let t = 0; t <= REVEAL_MS; t += 16) expect(scrambleFrame(text, t, 3).chars).toHaveLength(Array.from(text).length);
  });

  test('случайная буква того же письма и регистра', () => {
    const f = scrambleFrame('Аб Cd 7', 0, 5);
    expect(f.chars[0].ch).toMatch(/^[А-Я]$/);
    expect(f.chars[1].ch).toMatch(/^[а-я]$/);
    expect(f.chars[3].ch).toMatch(/^[A-Z]$/);
    expect(f.chars[4].ch).toMatch(/^[a-z]$/);
    expect(f.chars[6].ch).toMatch(/^\d$/);
  });

  test('вставшая буква больше не уходит, к концу все на месте и текст итоговый', () => {
    let prev = scrambleFrame(text, 0, 9).chars.map((c) => c.settled);
    for (let t = 16; t <= REVEAL_MS; t += 16) {
      const now = scrambleFrame(text, t, 9).chars.map((c) => c.settled);
      now.forEach((s, i) => prev[i] && expect(s).toBe(true));
      prev = now;
    }
    const end = scrambleFrame(text, REVEAL_MS, 9);
    expect(end.done).toBe(true);
    expect(end.chars.map((c) => c.ch).join('')).toBe(text);
  });

  test('порядок случайный, а не слева направо', () => {
    const times = Array.from({ length: 30 }, (_, i) => settleAt(i, 11));
    expect(times.every((v, i) => i === 0 || v >= times[i - 1])).toBe(false);
  });

  test('ease-out: к середине времени на месте больше половины букв', () => {
    const times = Array.from({ length: 400 }, (_, i) => settleAt(i, 13));
    const half = times.filter((t) => t <= REVEAL_MS / 2).length / times.length;
    expect(half).toBeGreaterThan(0.6);
  });

  test('хеш: 0..1 и одинаковый для тех же входов', () => {
    for (let i = 0; i < 50; i++) {
      const v = hash01(i, 2, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash01(i, 2, 3)).toBe(v);
    }
  });
});
