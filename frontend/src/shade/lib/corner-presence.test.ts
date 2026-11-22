// Уходящая карточка угла остаётся на своём месте (docs/ui/notifications.md, «Угол»): bun test src/shade.
// Раньше уходящие вставали в начало списка: React переносил узел наверх, анимация появления
// запускалась заново, и закрытая карточка «мигала» сверху стека, а соседи прыгали.
import { describe, expect, test } from 'bun:test';
import { placeLeaving } from './corner-presence';

const e = (id: string) => ({ id });
const view = (r: ReturnType<typeof placeLeaving<{ id: string }>>) => r.map((p) => (p.leaving ? `-${p.entry.id}` : p.entry.id));

describe('placeLeaving', () => {
  test('закрыли среднюю: остаётся посередине, порядок соседей тот же', () => {
    expect(view(placeLeaving(['a', 'b', 'c'], [e('a'), e('c')], [e('b')]))).toEqual(['a', '-b', 'c']);
  });
  test('закрыли верхнюю и нижнюю: каждая на своём месте', () => {
    expect(view(placeLeaving(['a', 'b', 'c'], [e('b')], [e('a'), e('c')]))).toEqual(['-a', 'b', '-c']);
  });
  test('две подряд уходят из середины: обе на месте, по порядку', () => {
    expect(view(placeLeaving(['a', 'b', 'c', 'd'], [e('a'), e('d')], [e('c'), e('b')]))).toEqual(['a', '-b', '-c', 'd']);
  });
  test('пока одна уходит, снизу пришла новая: новая снизу, уходящая на месте', () => {
    expect(view(placeLeaving(['a', 'b'], [e('a'), e('n')], [e('b')]))).toEqual(['a', '-b', 'n']);
  });
  test('склеенная ушла вниз (тот же id): живая берёт новое место, уходящей копии нет', () => {
    expect(view(placeLeaving(['g', 'a'], [e('a'), e('g')], [e('g')]))).toEqual(['a', 'g']);
  });
  test('ушли все: остаются уходящие в прежнем порядке', () => {
    expect(view(placeLeaving(['a', 'b'], [], [e('b'), e('a')]))).toEqual(['-a', '-b']);
  });
  test('уходящей нет в прежнем порядке: в конец, а не в начало', () => {
    expect(view(placeLeaving(['a'], [e('a')], [e('x')]))).toEqual(['a', '-x']);
  });
});
