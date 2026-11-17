// Уход карточки из дока: уходит тот же экземпляр с его состоянием, а не собранный заново. bun test src/shade
import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { DockLeave, LEAVE_MS } from './DockLeave';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const g = globalThis as unknown as Record<string, unknown>;
beforeEach(() => {
  g.window = { setTimeout, clearTimeout };
});
afterEach(() => {
  delete g.window;
});

let mounts = 0;
let bump: () => void = () => undefined;
function Stateful() {
  const [n, setN] = React.useState(0);
  React.useEffect(() => void mounts++, []);
  bump = () => setN((x) => x + 1);
  return <p>{`шаг ${n}`}</p>;
}

const Host = ({ show }: { show: boolean }) => <DockLeave show={show}>{show && <Stateful key="card" />}</DockLeave>;

test('show: true -> false: уходит тот же экземпляр с последним состоянием, через LEAVE_MS пусто', async () => {
  mounts = 0;
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<Host show />);
  });
  await act(async () => bump());
  expect(r.root.findByType('p').children).toEqual(['шаг 1']);

  await act(async () => r.update(<Host show={false} />));
  // Не размонтирован и не собран заново: то же состояние, обёртка уходит с размытием
  expect(mounts).toBe(1);
  expect(r.root.findByType('p').children).toEqual(['шаг 1']);
  expect(r.root.findByType('div').props.className).toContain('shade-dock-out');

  await act(async () => void (await new Promise((res) => setTimeout(res, LEAVE_MS + 40))));
  expect(r.toJSON()).toBeNull();
});

test('скрыто с самого начала: ничего не рисуется; снова показано посреди ухода: остаётся', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<Host show={false} />);
  });
  expect(r.toJSON()).toBeNull();
  await act(async () => r.update(<Host show />));
  await act(async () => r.update(<Host show={false} />));
  await act(async () => r.update(<Host show />));
  await act(async () => void (await new Promise((res) => setTimeout(res, LEAVE_MS + 40))));
  expect(r.root.findByType('div').props.className).not.toContain('shade-dock-out');
  expect(r.root.findAllByType('p')).toHaveLength(1);
});
