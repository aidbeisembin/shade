// Карточка «Как вам Shade?» целиком: что уходит в сеть при щелчках. bun test src/shade (pnpm test).
import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { FeedbackCard } from './FeedbackCard';
import { StarRating } from './StarRating';
import { resetLangForTests } from '@/shade/lib/lang';
import { PROMPT_KEY, readPrompt, resetFeedbackForTests } from '@/shade/lib/feedback/store';
import { QUEUE_KEY } from '@/shade/lib/feedback/send';
import { START } from '@/shade/lib/feedback/flow';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const g = globalThis as unknown as Record<string, unknown>;
const realFetch = globalThis.fetch;
let calls: { url: string; body: string }[] = [];
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  g.window = { location: { search: '' }, localStorage, sessionStorage: undefined };
  g.document = { documentElement: { lang: '' } };
  resetLangForTests('ru');
  resetFeedbackForTests();
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    await new Promise((r) => setTimeout(r, 20));
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  delete g.window;
  delete g.document;
  globalThis.fetch = realFetch;
});

const radios = (root: ReactTestInstance) => root.findAll((n) => n.type === 'button' && n.props.role === 'radio');
const textOf = (n: ReactTestInstance | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''));
const byText = (root: ReactTestInstance, text: string) => root.find((n) => n.type === 'button' && textOf(n).includes(text));
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 60))));

test('2 звезды без текста и крестик: в сеть ничего, закрытие в счёт', async () => {
  let done = 0;
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<FeedbackCard onDone={() => done++} />);
  });
  await act(async () => radios(r.root)[1].props.onClick());
  // Раскрылась форма «Что улучшить?»
  expect(r.root.findAll((n) => n.type === 'textarea')).toHaveLength(1);
  await act(async () => r.root.find((n) => n.type === 'button' && n.props['aria-label'] === 'Закрыть').props.onClick());
  await flush();
  expect(done).toBe(1);
  expect(calls).toHaveLength(0);
  expect(store.get(QUEUE_KEY)).toBeUndefined();
  expect(readPrompt().dismissals).toBe(1);
  expect(JSON.parse(store.get(PROMPT_KEY)!).ratedAt).toBeNull();
});

test('повторный клик «Отправить»: один запрос, оценка запомнена', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<FeedbackCard onDone={() => undefined} initial={{ ...START, step: 'form', rating: 2, origin: 'low', text: 'медленно' }} />);
  });
  const send = byText(r.root, 'Отправить');
  await act(async () => {
    send.props.onClick();
    send.props.onClick();
  });
  await act(async () => byText(r.root, 'Отправляю').props.onClick());
  await flush();
  expect(calls).toHaveLength(1);
  const body = JSON.parse(calls[0].body);
  expect(body).toEqual({ rating: 2, text: 'медленно', appVersion: 'unknown', macos: expect.any(String), locale: 'ru' });
  expect(Object.keys(body).sort()).toEqual(['appVersion', 'locale', 'macos', 'rating', 'text']);
  expect(readPrompt().ratedAt).not.toBeNull();
  expect(r.root.findAll((n) => n.props.role === 'status')).toHaveLength(1);
});

test('5 звёзд: «Спасибо!», без «Отправить оценку» ничего не уходит', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<FeedbackCard onDone={() => undefined} />);
  });
  await act(async () => radios(r.root)[4].props.onClick());
  expect(byText(r.root, 'Поставить звезду на GitHub')).toBeDefined();
  await flush();
  expect(calls).toHaveLength(0);
  await act(async () => byText(r.root, 'Отправить оценку').props.onClick());
  await flush();
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0].body)).toMatchObject({ rating: 5, text: '' });
});

test('звёзды: radiogroup, стрелки меняют, Enter подтверждает, один Tab-стоп', async () => {
  const seen: string[] = [];
  function Host() {
    const [v, setV] = React.useState(0);
    return <StarRating value={v} onChange={(x) => (setV(x), seen.push(`change ${x}`))} onCommit={(x) => seen.push(`commit ${x}`)} />;
  }
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<Host />);
  });
  const group = r.root.find((n) => n.props.role === 'radiogroup');
  const key = (k: string) => act(async () => group.props.onKeyDown({ key: k, preventDefault() {} }));
  await key('ArrowRight');
  await key('ArrowRight');
  await key('ArrowLeft');
  await key('Enter');
  expect(seen).toEqual(['change 1', 'change 2', 'change 1', 'commit 1']);
  const stars = radios(r.root);
  expect(stars.map((s) => s.props['aria-checked'])).toEqual([true, false, false, false, false]);
  expect(stars.filter((s) => s.props.tabIndex === 0)).toHaveLength(1);
  expect(stars[1].props['aria-label']).toBe('2 звезды, Так себе');
});
