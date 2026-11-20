// Карточка обновления (UpdateCard): что видно на каждом шаге. bun test src/shade (pnpm test).
import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { UpdateCard } from './UpdateCard';
import { resetLangForTests } from '@/shade/lib/lang';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  g.window = { location: { search: '' }, localStorage: undefined, sessionStorage: undefined };
  g.document = { documentElement: { lang: '' } };
  resetLangForTests('ru');
});
afterEach(() => {
  resetLangForTests('ru');
  delete g.window;
  delete g.document;
});

function render(phase: React.ComponentProps<typeof UpdateCard>['phase']) {
  const calls = { update: 0, close: 0 };
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<UpdateCard phase={phase} onUpdate={() => calls.update++} onClose={() => calls.close++} />);
  });
  const text = () => JSON.stringify(r.toJSON());
  const buttons = () => r.root.findAllByType('button');
  const action = () => buttons().filter((b) => b.props['aria-label'] !== 'Закрыть');
  return { r, calls, text, buttons, action };
}

test('готово: «Доступна версия X» и «Обновить», ставит только по кнопке', () => {
  const { text, buttons, calls, action } = render({ kind: 'ready', version: '0.5.0-beta.2' });
  expect(text()).toContain('Доступна версия 0.5.0-beta.2');
  expect(text()).toContain('Обновить');
  expect(action()).toHaveLength(1);
  const update = action()[0];
  expect(calls.update).toBe(0);
  act(() => update.props.onClick());
  expect(calls.update).toBe(1);
  const close = buttons().find((b) => b.props['aria-label'] === 'Закрыть');
  expect(close).toBeTruthy();
});

test('ставится: кнопка занята, крестика нет', () => {
  const { text, buttons, action } = render({ kind: 'installing', version: '0.5.0-beta.2' });
  expect(text()).toContain('Обновляю…');
  expect(buttons().every((b) => b.props['aria-label'] !== 'Закрыть')).toBe(true);
  expect(action()).toHaveLength(1);
  expect(action()[0].props.disabled).toBe(true);
});

test('не получилось: текущая версия на месте, без «Обновить»', () => {
  const { text, buttons, action } = render({ kind: 'failed', version: '0.5.0-beta.2' });
  expect(text()).toContain('Не получилось обновить');
  expect(text()).toContain('Текущая версия на месте');
  expect(action()).toHaveLength(0);
  expect(buttons().some((b) => b.props['aria-label'] === 'Закрыть')).toBe(true);
});

test('английский', () => {
  resetLangForTests('en');
  const { text } = render({ kind: 'ready', version: '0.5.0-beta.2' });
  expect(text()).toContain('Version 0.5.0-beta.2 is available');
  expect(text()).toContain('Update');
});
