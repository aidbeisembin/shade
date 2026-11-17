// Тесты форматов по языку (Intl): bun test src/shade (pnpm test).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { dateGroup, displayTitle, displayTitleBrief, formatDateTime, formatDuration, formatFileSize, formatNumber, formatOffset, formatShortDate, formatTime, formatVolume, isAutoTitle } from './format';
import { resetLangForTests, setLang } from './lang';

const g = globalThis as unknown as Record<string, unknown>;
/** Узкий и неразрывный пробелы Intl сводим к обычному: тест про текст, а не про вид пробела. */
const n = (s: string | null) => (s ?? '').replace(/[\u00A0\u202F]/g, ' ');

beforeEach(() => {
  g.window = { location: { search: '' } };
  resetLangForTests('ru');
});
afterEach(() => {
  delete g.window;
});

const at = new Date(2026, 9, 3, 9, 30); // 3 октября 2026, 09:30 местного времени

describe('длительность', () => {
  test('ru и en', () => {
    expect(formatDuration(3725)).toBe('1 ч 2 мин');
    expect(formatDuration(3600)).toBe('1 ч');
    expect(formatDuration(125)).toBe('2 мин');
    expect(formatDuration(59)).toBe('59 с');
    setLang('en');
    expect(formatDuration(3725)).toBe('1 h 2 min');
    expect(formatDuration(59)).toBe('59 s');
  });
  test('пусто и нули: null', () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });
  test('метки времени не зависят от языка', () => {
    expect(formatOffset(247)).toBe('4:07');
    setLang('en');
    expect(formatOffset(3735)).toBe('1:02:15');
  });
});

describe('числа и размеры', () => {
  test('разряды: 33 434 и 33,434', () => {
    expect(n(formatNumber(33434))).toBe('33 434');
    setLang('en');
    expect(formatNumber(33434)).toBe('33,434');
  });
  test('размер файла: запятая и точка по локали', () => {
    expect(n(formatFileSize(1.5 * 1024 * 1024))).toBe('1,5 МБ');
    expect(n(formatFileSize(300 * 1024))).toBe('300 КБ');
    setLang('en');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatFileSize(2.25 * 1024 * 1024 * 1024)).toBe('2.3 GB');
  });
});

describe('даты', () => {
  test('дата и время', () => {
    expect(n(formatDateTime(at))).toBe('3 октября 2026, 09:30');
    setLang('en');
    expect(n(formatDateTime(at))).toBe('October 3, 2026, 9:30 AM');
  });
  test('время встречи', () => {
    expect(formatTime(at)).toBe('09:30');
    setLang('en');
    expect(n(formatTime(at))).toBe('9:30 AM');
  });
  test('короткая дата: сегодня, вчера, дата прошлых недель', () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 18, 5);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0);
    expect(n(formatShortDate(today))).toBe('сегодня, 08:00');
    expect(n(formatShortDate(yesterday))).toBe('вчера, 18:05');
    setLang('en');
    expect(n(formatShortDate(today))).toBe('today, 8:00 AM');
    expect(n(formatShortDate(yesterday))).toBe('yesterday, 6:05 PM');
  });
  test('группа списка не зависит от языка', () => {
    const now = new Date(2026, 10, 16, 12, 0);
    expect(dateGroup(new Date(2026, 10, 16, 1, 0), now)).toBe('today');
    expect(dateGroup(new Date(2026, 10, 15, 23, 0), now)).toBe('yesterday');
    expect(dateGroup(new Date(2026, 10, 12, 9, 0), now)).toBe('week');
    expect(dateGroup(new Date(2026, 10, 1, 9, 0), now)).toBe('earlier');
  });
  test('битая дата: null', () => {
    expect(formatDateTime('not a date')).toBeNull();
    expect(formatShortDate(null)).toBeNull();
  });
});

describe('названия встреч', () => {
  const now = new Date(2026, 10, 16, 12, 0);
  test('автоназвание становится датой на текущем языке', () => {
    expect(displayTitle('Meeting 02_11_26_21_34_11', now)).toBe('Встреча 2 ноября, 21:34');
    setLang('en');
    expect(n(displayTitle('Meeting 02_11_26_21_34_11', now))).toBe('Meeting on November 2, 9:34 PM');
  });
  test('подпись под заголовком «Встреча сохранена»: без слова «Встреча», оно уже в заголовке', () => {
    expect(displayTitleBrief('Meeting 02_11_26_21_34_11', now)).toBe('2 ноября, 21:34');
    setLang('en');
    expect(n(displayTitleBrief('Meeting 02_11_26_21_34_11', now))).toBe('November 2, 9:34 PM');
    // своё название человека как есть
    expect(displayTitleBrief('Weekly product sync', now)).toBe('Weekly product sync');
  });
  test('своё название человека как есть на любом языке', () => {
    expect(displayTitle('Weekly product sync', now)).toBe('Weekly product sync');
    expect(displayTitle('Созвон по релизу', now)).toBe('Созвон по релизу');
  });
  test('пустое название', () => {
    expect(displayTitle('   ', now)).toBe('Встреча без названия');
    setLang('en');
    expect(displayTitle('', now)).toBe('Untitled meeting');
  });
  test('isAutoTitle не зависит от языка', () => {
    expect(isAutoTitle('Meeting 02_11_26_21_34_11')).toBe(true);
    expect(isAutoTitle('Weekly sync')).toBe(false);
  });
});

describe('объём встречи', () => {
  test('12 мин · 340 слов и 12 min · 340 words', () => {
    expect(n(formatVolume(720, 340))).toBe('12 мин · 340 слов');
    setLang('en');
    expect(n(formatVolume(720, 1))).toBe('12 min · 1 word');
  });
  test('нет данных: null', () => {
    expect(formatVolume(null, 0)).toBeNull();
  });
});
