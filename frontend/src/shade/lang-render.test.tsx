// Переключение языка на лету: компонент с useLang() перерисовывается без перемонтирования,
// своё состояние сохраняет. bun test src/shade (pnpm test).
import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { resetLangForTests, setLang, useLang } from './lib/lang';
import { formatDuration } from './lib/format';
import { t, tp } from './strings';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  g.window = { location: { search: '' }, localStorage: undefined, sessionStorage: undefined };
  g.document = { documentElement: { lang: '' } };
  resetLangForTests('ru');
});
afterEach(() => {
  delete g.window;
  delete g.document;
});

let mounts = 0;

function Probe() {
  useLang();
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    mounts++;
  }, []);
  return (
    <button onClick={() => setCount(count + 1)}>
      {t('retry')} | {tp('wordsCount', 21)} | {formatDuration(3725)} | {count}
    </button>
  );
}

/** Дочерний компонент без хука: перерисовывается вместе с родителем. */
function Parent() {
  useLang();
  return <Probe />;
}

const text = (r: TestRenderer.ReactTestRenderer) => (r.toJSON() as { children: string[] }).children.join('').replace(/[  ]/g, ' ');

test('смена языка перерисовывает текст, числа и склонения, состояние компонента остаётся', () => {
  mounts = 0;
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<Parent />);
  });
  expect(text(r)).toBe('Повторить | 21 слово | 1 ч 2 мин | 0');

  act(() => {
    (r.root.findByType('button').props.onClick as () => void)();
  });
  expect(text(r)).toContain('| 1');

  act(() => setLang('en'));
  expect(text(r)).toBe('Try again | 21 words | 1 h 2 min | 1');

  act(() => setLang('ru'));
  expect(text(r)).toBe('Повторить | 21 слово | 1 ч 2 мин | 1');
  // компонент не пересоздавался: счётчик 1, смонтирован один раз
  expect(mounts).toBe(1);
});
