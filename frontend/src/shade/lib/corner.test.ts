// Правила правого нижнего угла (docs/ui/notifications.md, «Угол»): bun test src/shade (pnpm test).
// Хранилище с ручными часами: сроки проверяются без ожидания.
import { beforeEach, describe, expect, test } from 'bun:test';
import { CornerStore, MAX_VISIBLE, stackView, corner, type CornerClock } from './corner';
import { RESULT_ACTION_MS, RESULT_MS, outcomeTimeout, resultTimeout } from './notice-timing';
import { notifyRestored, notifyTrashed } from './corner-messages';
import { setLang } from './lang';
import { t } from '@/shade/strings';

/** Часы, которые идут только по tick. */
function manualClock() {
  let now = 0;
  let timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let seq = 0;
  const clock: CornerClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  };
  const tick = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      timers = timers.filter((t) => t !== next);
      next.fn();
    }
    now = until;
  };
  return { clock, tick };
}

const result = (title: string, withAction = false) => ({
  view: { icon: 'done' as const, title, action: withAction ? { label: 'Вернуть', onClick: () => undefined } : undefined },
});
const titles = (s: CornerStore) => s.getSnapshot().map((e) => e.view.title);

describe('стек', () => {
  test('три карточки видны все, новая снизу (последней)', () => {
    const s = new CornerStore(manualClock().clock);
    s.show(result('a'));
    s.show(result('b'));
    s.show(result('c'));
    expect(titles(s)).toEqual(['a', 'b', 'c']);
    expect(stackView(3, false)).toEqual({ shown: 3, hidden: 0 });
  });

  test('четвёртая: старшая сворачивается в «+1», наведение раскрывает все', () => {
    expect(MAX_VISIBLE).toBe(3);
    expect(stackView(4, false)).toEqual({ shown: 3, hidden: 1 });
    expect(stackView(6, false)).toEqual({ shown: 3, hidden: 3 });
    expect(stackView(4, true)).toEqual({ shown: 4, hidden: 0 });
    expect(stackView(0, false)).toEqual({ shown: 0, hidden: 0 });
  });

  test('тот же id заменяет карточку на месте, порядок не меняется', () => {
    const s = new CornerStore(manualClock().clock);
    s.show({ id: 'load', view: { icon: 'progress', title: 'Загружаю' } });
    s.show(result('b'));
    s.show({ id: 'load', view: { icon: 'done', title: 'Загружено' } });
    expect(titles(s)).toEqual(['Загружено', 'b']);
  });

  test('крестик убирает одну, dismiss() без id все; onDismiss зовётся', () => {
    const s = new CornerStore(manualClock().clock);
    const gone: string[] = [];
    const a = s.show({ ...result('a'), onDismiss: () => gone.push('a') });
    s.show({ ...result('b'), onDismiss: () => gone.push('b') });
    s.dismiss(a);
    expect(titles(s)).toEqual(['b']);
    s.dismiss();
    expect(titles(s)).toEqual([]);
    expect(gone).toEqual(['a', 'b']);
  });
});

describe('сроки', () => {
  test('итог 4 с, с действием 8 с; итог записи в доке по причине', () => {
    expect(resultTimeout(false)).toBe(RESULT_MS);
    expect(resultTimeout(true)).toBe(RESULT_ACTION_MS);
    expect([RESULT_MS, RESULT_ACTION_MS]).toEqual([4000, 8000]);
    expect(outcomeTimeout('empty')).toBe(4000);
    expect(outcomeTimeout('unrecognized')).toBe(4000);
    expect(outcomeTimeout('no-speech')).toBe(8000);
    expect(outcomeTimeout('low-content')).toBe(8000);
  });

  test('без действия уходит через 4 с, с действием через 8 с', () => {
    const { clock, tick } = manualClock();
    const s = new CornerStore(clock);
    s.show(result('без кнопки'));
    s.show(result('с кнопкой', true));
    tick(3999);
    expect(titles(s)).toEqual(['без кнопки', 'с кнопкой']);
    tick(1);
    expect(titles(s)).toEqual(['с кнопкой']);
    tick(4000);
    expect(titles(s)).toEqual([]);
  });

  test('без таймера: ожидание, своя разметка (отзыв, обновление), null и Infinity', () => {
    const { clock, tick } = manualClock();
    const s = new CornerStore(clock);
    s.show({ view: { icon: 'progress', title: 'Ожидание' } });
    s.show({ id: 'update', view: { title: '', render: () => null } });
    s.show({ view: { icon: 'recovery', title: 'Восстановлена' }, timeout: null });
    s.show({ view: { icon: 'info', title: 'Навсегда' }, timeout: Infinity });
    expect(s.getSnapshot().map((e) => e.timeout)).toEqual([null, null, null, null]);
    tick(60 * 60 * 1000);
    expect(s.getSnapshot()).toHaveLength(4);
  });

  test('указатель на стеке: время стоит у всех, потом идёт с остатка', () => {
    const { clock, tick } = manualClock();
    const s = new CornerStore(clock);
    s.show(result('a'));
    tick(3000);
    s.hold('hover', true);
    tick(60_000);
    expect(titles(s)).toEqual(['a']);
    // Фокус поверх указателя: указатель ушёл, фокус ещё держит
    s.hold('focus', true);
    s.hold('hover', false);
    tick(60_000);
    expect(titles(s)).toEqual(['a']);
    s.hold('focus', false);
    tick(999);
    expect(titles(s)).toEqual(['a']);
    tick(1);
    expect(titles(s)).toEqual([]);
  });

  test('показанная во время паузы ждёт конца паузы', () => {
    const { clock, tick } = manualClock();
    const s = new CornerStore(clock);
    s.hold('hidden', true);
    s.show(result('a'));
    tick(10_000);
    expect(titles(s)).toEqual(['a']);
    s.hold('hidden', false);
    tick(4000);
    expect(titles(s)).toEqual([]);
  });
});

describe('склейка однотипных', () => {
  beforeEach(() => {
    setLang('ru');
    corner.reset();
  });

  test('две встречи в корзину: одна карточка «2 встречи в корзине», «Вернуть» возвращает обе', async () => {
    const restored: string[] = [];
    const restore = async (id: string) => void restored.push(id);
    notifyTrashed({ id: 'm1', title: 'Meeting 20_11_26_11_14_00' }, restore);
    notifyTrashed({ id: 'm2', title: 'Meeting 20_11_26_12_14_00' }, restore);
    const cards = corner.getSnapshot();
    expect(cards).toHaveLength(1);
    expect(cards[0].view.title).toBe('2 встречи в корзине');
    expect(cards[0].view.hint).toBe('Удалится насовсем через 30 дней');
    expect(cards[0].view.action?.label).toBe('Вернуть');
    expect(cards[0].timeout).toBe(8000);
    cards[0].view.action?.onClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(restored).toEqual(['m1', 'm2']);
    // Итог возврата тоже склеен: «2 встречи восстановлены»
    const after = corner.getSnapshot().filter((e) => e.group === 'restored');
    expect(after).toHaveLength(1);
    expect(after[0].view.title).toBe('2 встречи восстановлены');
  });

  test('одна встреча в корзину: «Встреча в корзине», вернуть не удалось - встреча остаётся в корзине, ошибка в углу', async () => {
    notifyTrashed({ id: 'm1' }, async () => {
      throw new Error('нет файла');
    });
    const [card] = corner.getSnapshot();
    expect(card.view.title).toBe(t('deleted'));
    card.view.action?.onClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(corner.getSnapshot().some((e) => e.group === 'restored')).toBe(false);
    expect(corner.getSnapshot().some((e) => e.view.role === 'alert')).toBe(true);
  });

  test('склеенная встаёт вниз (последнее событие) и срок идёт заново', () => {
    corner.show({ view: { icon: 'info', title: 'другое' }, timeout: null });
    notifyRestored({ id: 'a', title: 'Meeting 19_11_26_11_40_00' });
    corner.show({ view: { icon: 'info', title: 'третье' }, timeout: null });
    notifyRestored({ id: 'b', title: 'Meeting 19_11_26_12_40_00' });
    expect(corner.getSnapshot().map((e) => e.view.title)).toEqual(['другое', 'третье', '2 встречи восстановлены']);
  });
});
