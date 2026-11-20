// Пиксельная «генерация» названия: когда играть, ожидание и проявление во времени. Запуск: bun test src/shade (pnpm test).
import { describe, expect, test } from 'bun:test';
import {
  ARM_TTL_MS,
  PIXEL,
  REVEAL_MS,
  WAVE_MS,
  cellAlive,
  createPendingStore,
  decideReveal,
  easeOut,
  hash01,
  loadingAlpha,
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

describe('кто ждёт название: путь после «Остановить» и запрос к модели', () => {
  const store = () => {
    const events: string[] = [];
    return { s: createPendingStore((id, on) => events.push(`${id}:${on ? 'on' : 'off'}`)), events };
  };

  test('после «Остановить» полоса с первого кадра, запрос к модели внутри её не гасит, гаснет в конце пути', () => {
    const { s, events } = store();
    s.set('m1', true); // встреча сохранена
    s.set('m1', true); // модель начала
    s.set('m1', false); // модель ответила
    expect(s.has('m1')).toBe(true);
    s.set('m1', false); // путь закончен
    expect(s.has('m1')).toBe(false);
    expect(events).toEqual(['m1:on', 'm1:off']);
  });

  test('модель отказала до запроса: путь отпускает, полоса гаснет (вернётся дата)', () => {
    const { s, events } = store();
    s.set('m1', true);
    s.set('m1', false);
    expect(events).toEqual(['m1:on', 'm1:off']);
  });

  test('лишнее «отпустить» не уводит в минус и не шлёт событий', () => {
    const { s, events } = store();
    s.set('m1', false);
    s.set('m1', true);
    expect(s.has('m1')).toBe(true);
    expect(events).toEqual(['m1:on']);
  });

  test('встречи независимы', () => {
    const { s } = store();
    s.set('a', true);
    expect(s.has('b')).toBe(false);
  });
});

describe('ожидание: пиксели мерцают, волна бежит', () => {
  test('яркость в 0..1 и никогда не ноль: полоса видна целиком', () => {
    for (let t = 0; t < 3000; t += 37) {
      for (let c = 0; c < 40; c += 3) {
        const a = loadingAlpha(c, 1, 40, t, 5);
        expect(a).toBeGreaterThan(0.1);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });

  test('волна идёт слева направо: самая яркая колонка сдвигается вправо', () => {
    const brightest = (t: number) => {
      let best = 0;
      let bestCol = 0;
      for (let c = 0; c < 60; c++) {
        // среднее по рядам и зёрнам гасит мерцание, остаётся волна
        let sum = 0;
        for (let s = 0; s < 20; s++) sum += loadingAlpha(c, s % 3, 60, t, s);
        if (sum > best) [best, bestCol] = [sum, c];
      }
      return bestCol;
    };
    expect(brightest(WAVE_MS * 0.3)).toBeLessThan(brightest(WAVE_MS * 0.6));
  });

  test('мерцание меняется во времени, а внутри одного такта почти стоит (плавно идёт только волна)', () => {
    expect(Math.abs(loadingAlpha(3, 0, 40, 10, 1) - loadingAlpha(3, 0, 40, 20, 1))).toBeLessThan(0.05);
    const vals = new Set(Array.from({ length: 12 }, (_, k) => loadingAlpha(3, 0, 40, k * 90 + 5, 1).toFixed(3)));
    expect(vals.size).toBeGreaterThan(3);
  });
});

describe('проявление: пиксели мельчают и рассыпаются, текст проступает', () => {
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

  test('начало: крупные пиксели, все на месте, текста не видно', () => {
    expect(revealFrame(0)).toEqual({ block: PIXEL, gone: 0, text: 0, done: false });
    for (let x = 0; x < 200; x += 3) expect(cellAlive(x, 5, 0, 9)).toBe(true);
  });

  test('ход: пиксели только мельчают, рассыпаются и не возвращаются, текст только ярче', () => {
    let prev = revealFrame(0);
    const alive = (g: number) => Array.from({ length: 300 }, (_, i) => cellAlive(i % 100, Math.floor(i / 100), g, 4));
    let prevAlive = alive(0);
    for (let t = 16; t <= REVEAL_MS; t += 16) {
      const f = revealFrame(t);
      expect(f.block).toBeLessThanOrEqual(prev.block);
      expect(f.gone).toBeGreaterThanOrEqual(prev.gone);
      expect(f.text).toBeGreaterThanOrEqual(prev.text);
      const now = alive(f.gone);
      now.forEach((a, i) => !prevAlive[i] && expect(a).toBe(false));
      prev = f;
      prevAlive = now;
    }
  });

  test('конец: пиксели по 1 px, ни одного не осталось, текст целиком', () => {
    const f = revealFrame(REVEAL_MS);
    expect(f).toEqual({ block: 1, gone: 1, text: 1, done: true });
    for (let x = 0; x < 300; x++) expect(cellAlive(x, x % 20, 1, 3)).toBe(false);
  });

  test('рассыпаются в случайном порядке, а не слева направо', () => {
    const at = (x: number) => {
      for (let g = 0; g <= 1; g += 0.01) if (!cellAlive(x, 0, g, 21)) return g;
      return 1;
    };
    const cols = Array.from({ length: 30 }, (_, i) => at(i * PIXEL));
    expect(cols.every((v, i) => i === 0 || v >= cols[i - 1])).toBe(false);
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
