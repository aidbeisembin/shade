// Тесты интерфейсной части восстановления после сбоя: bun test src/shade (pnpm test).
// Ядро и тосты подставлены: проверяем, что происходит с ответом ядра.
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

type Call = { title: string; data: { description?: string; action?: { label: string; onClick: () => void }; duration?: number } };
const toasts: Call[] = [];
let reply: () => Promise<unknown> = async () => undefined;
const opened: string[] = [];

mock.module('@tauri-apps/api/core', () => ({ invoke: (cmd: string) => (cmd === 'recover_interrupted_meetings' ? reply() : Promise.resolve([])) }));
mock.module('./toasts', () => ({ shadeToast: { info: (title: string, data: Call['data']) => toasts.push({ title, data }) } }));
mock.module('./open-meeting', () => ({ openMeeting: (id: string) => opened.push(id), meetingHref: (id: string) => `/?id=${id}` }));

const g = globalThis as unknown as Record<string, unknown>;
g.window = { location: { search: '' } };
const { MAX_RETRIES, RETRY_AFTER_MS, recoveredLabel, recoveredMark, resetCrashRecoveryForTests, runCrashRecovery } = await import('./crash-recovery');

const meeting = (n: number, partial = false) => ({
  meeting_id: `meeting-${n}`,
  title: 'Meeting 16_11_26_15_02_17',
  created_at: '2026-11-16T10:02:19+00:00',
  duration_seconds: 1740,
  segments: 181,
  partial,
  reasons: partial ? ['chunk-damaged'] : [],
  folder: '/x',
});
const report = (over: Record<string, unknown> = {}) => ({ ready: true, recording: false, recovered: [], deferred: 0, nothing: 0, failed: [], marked: [], ...over });

let refetched = 0;
const refetch = () => {
  refetched += 1;
};
const timers: number[] = [];
const realSetTimeout = globalThis.setTimeout;
g.setTimeout = ((_fn: () => void, ms: number) => timers.push(ms)) as unknown as typeof setTimeout;

beforeEach(() => {
  toasts.length = 0;
  opened.length = 0;
  timers.length = 0;
  refetched = 0;
  resetCrashRecoveryForTests();
});

describe('уведомление о восстановленной встрече', () => {
  test('одна встреча: тихое уведомление с названием, подписью, длительностью и «Открыть»', async () => {
    reply = async () => report({ recovered: [meeting(1)], marked: [{ meeting_id: 'meeting-1', partial: false, recovered_at: 'x' }] });
    await runCrashRecovery(refetch);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toContain('15:02');
    expect(toasts[0].data.description).toBe(`${recoveredLabel({ partial: false })} · 29 мин`);
    expect(toasts[0].data.action?.label).toBe('Открыть');
    toasts[0].data.action?.onClick();
    expect(opened).toEqual(['meeting-1']);
    expect(refetched).toBe(1);
    expect(recoveredMark('meeting-1')).toEqual({ partial: false });
  });
  test('частично: подпись «частично»', async () => {
    reply = async () => report({ recovered: [meeting(1, true)] });
    await runCrashRecovery(refetch);
    expect(toasts[0].data.description).toContain(recoveredLabel({ partial: true }));
    expect(recoveredLabel({ partial: true })).not.toBe(recoveredLabel({ partial: false }));
  });
  test('больше двух встреч: одно сводное уведомление, без «Открыть»', async () => {
    reply = async () => report({ recovered: [meeting(1), meeting(2), meeting(3)] });
    await runCrashRecovery(refetch);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].data.action).toBeUndefined();
    expect(toasts[0].data.description).toContain('3');
  });
  test('ничего нового (повторный запуск): без уведомления и без перечитывания списка, пометки остаются', async () => {
    reply = async () => report({ marked: [{ meeting_id: 'meeting-9', partial: true, recovered_at: 'x' }] });
    await runCrashRecovery(refetch);
    expect(toasts).toHaveLength(0);
    expect(refetched).toBe(0);
    expect(recoveredMark('meeting-9')).toEqual({ partial: true });
    expect(recoveredMark('meeting-1')).toBeNull();
  });
});

describe('отказ ядра', () => {
  test('команда падает: тихо, без уведомления', async () => {
    reply = async () => {
      throw new Error('нет команды');
    };
    await runCrashRecovery(refetch);
    expect(toasts).toHaveLength(0);
    expect(refetched).toBe(0);
  });
  test('старое ядро или заглушка отвечает пустотой', async () => {
    reply = async () => undefined;
    await runCrashRecovery(refetch);
    expect(toasts).toHaveLength(0);
  });
  test('часть папок не вышла: встречи показаны, остальное в журнал', async () => {
    reply = async () => report({ recovered: [meeting(1)], failed: ['/x: база: диск полон'] });
    await runCrashRecovery(refetch);
    expect(toasts).toHaveLength(1);
  });
});

describe('папка, в которую писали только что', () => {
  test('повтор через минуту, не больше MAX_RETRIES раз за запуск', async () => {
    reply = async () => report({ deferred: 1 });
    for (let i = 0; i < MAX_RETRIES + 2; i++) await runCrashRecovery(refetch);
    expect(timers).toEqual(Array(MAX_RETRIES).fill(RETRY_AFTER_MS));
  });
  test('без отложенных папок повтора нет', async () => {
    reply = async () => report();
    await runCrashRecovery(refetch);
    expect(timers).toHaveLength(0);
  });
});

afterAll(() => {
  g.setTimeout = realSetTimeout;
});
