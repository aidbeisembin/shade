// Тесты интерфейсной части восстановления после сбоя: bun test src/shade (pnpm test).
// Ядро подставлено, карточки читаются из угла (lib/corner.ts): проверяем, что происходит с ответом ядра.
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

let reply: () => Promise<unknown> = async () => undefined;
const opened: string[] = [];

// mock.module в bun действует и на другие файлы тестов в том же процессе: незнакомые команды
// отвечают отказом, как вне Tauri, иначе, например, getVersion() в тестах отзыва получает [].
const known: Record<string, () => Promise<unknown>> = { recover_interrupted_meetings: () => reply(), api_get_meetings: async () => [] };
mock.module('@tauri-apps/api/core', () => ({ invoke: (cmd: string) => known[cmd]?.() ?? Promise.reject(new Error(`нет команды ${cmd} вне Tauri`)) }));
mock.module('./open-meeting', () => ({ openMeeting: (id: string) => opened.push(id), meetingHref: (id: string) => `/?id=${id}` }));

const g = globalThis as unknown as Record<string, unknown>;
g.window = { location: { search: '' } };
const { MAX_RETRIES, RETRY_AFTER_MS, recoveredLabel, recoveredMark, resetCrashRecoveryForTests, runCrashRecovery } = await import('./crash-recovery');
const { corner } = await import('./corner');
const cards = () => corner.getSnapshot();

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
  corner.reset();
  opened.length = 0;
  timers.length = 0;
  refetched = 0;
  resetCrashRecoveryForTests();
});

describe('карточка о восстановленной встрече в углу', () => {
  test('одна встреча: «Восстановлена после сбоя», дата и длительность, «Открыть», без таймера', async () => {
    reply = async () => report({ recovered: [meeting(1)], marked: [{ meeting_id: 'meeting-1', partial: false, recovered_at: 'x' }] });
    await runCrashRecovery(refetch);
    expect(cards()).toHaveLength(1);
    const v = cards()[0].view;
    expect(v.icon).toBe('recovery');
    expect(v.title).toBe(recoveredLabel({ partial: false }));
    expect(String(v.hint)).toContain('15:02');
    expect(String(v.hint)).toContain('29 мин');
    expect(v.action?.label).toBe('Открыть');
    expect(cards()[0].timeout).toBeNull();
    v.action?.onClick();
    expect(opened).toEqual(['meeting-1']);
    expect(refetched).toBe(1);
    expect(recoveredMark('meeting-1')).toEqual({ partial: false });
  });
  test('частично: заголовок «Восстановлена частично»', async () => {
    reply = async () => report({ recovered: [meeting(1, true)] });
    await runCrashRecovery(refetch);
    expect(cards()[0].view.title).toBe(recoveredLabel({ partial: true }));
    expect(recoveredLabel({ partial: true })).not.toBe(recoveredLabel({ partial: false }));
  });
  test('две встречи склеиваются: одна карточка «Восстановлено 2 встречи» с «Показать»', async () => {
    reply = async () => report({ recovered: [meeting(1), meeting(2, true)] });
    await runCrashRecovery(refetch);
    expect(cards()).toHaveLength(1);
    expect(cards()[0].view.title).toBe('Восстановлено 2\u00A0встречи');
    expect(cards()[0].view.action?.label).toBe('Показать');
    expect(cards()[0].payloads).toHaveLength(2);
    expect(cards()[0].timeout).toBeNull();
  });
  test('три встречи: та же одна карточка', async () => {
    reply = async () => report({ recovered: [meeting(1), meeting(2), meeting(3)] });
    await runCrashRecovery(refetch);
    expect(cards()).toHaveLength(1);
    expect(String(cards()[0].view.title)).toContain('3');
  });
  test('ничего нового (повторный запуск): без карточки и без перечитывания списка, пометки остаются', async () => {
    reply = async () => report({ marked: [{ meeting_id: 'meeting-9', partial: true, recovered_at: 'x' }] });
    await runCrashRecovery(refetch);
    expect(cards()).toHaveLength(0);
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
    expect(cards()).toHaveLength(0);
    expect(refetched).toBe(0);
  });
  test('старое ядро или заглушка отвечает пустотой', async () => {
    reply = async () => undefined;
    await runCrashRecovery(refetch);
    expect(cards()).toHaveLength(0);
  });
  test('часть папок не вышла: встречи показаны, остальное в журнал', async () => {
    reply = async () => report({ recovered: [meeting(1)], failed: ['/x: база: диск полон'] });
    await runCrashRecovery(refetch);
    expect(cards()).toHaveLength(1);
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
