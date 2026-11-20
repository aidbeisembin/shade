// Названия встреч: таблица случаев (кто, когда и кому может отправлять текст; что при отказе).
// Подставные зависимости: настоящие ядро и сеть не нужны. Запуск: bun test src/shade (pnpm test).
import { describe, expect, test } from 'bun:test';
import { createTitler, stillBusy, type ModelInfo, type SetResult, type TitleDeps, type TitleLog } from './title-core';

const RU_TEXT = Array.from({ length: 40 }, () => 'Давайте обсудим сроки релиза мобильного приложения и бюджет на следующий квартал').slice(0, 5);
const EN_TEXT = Array.from({ length: 5 }, () => 'Let us discuss the release schedule for the mobile app and the budget for next quarter');
const DEFAULT = 'Meeting 16_11_26_15_02_11';

interface Fake {
  id: string;
  title: string;
  durationSec: number | null;
  texts: string[];
  origin: 'manual' | 'auto' | null;
}

function world(opts: {
  meetings: Fake[];
  model?: ModelInfo;
  answers?: Array<string | Error>;
  summary?: string[];
  trashed?: string[];
  uiLang?: 'ru' | 'en';
}) {
  const meetings = new Map(opts.meetings.map((m) => [m.id, { ...m }]));
  const calls = { generate: [] as Array<{ system: string; user: string; allowCloud: boolean }>, setAuto: [] as Array<{ id: string; expected: string; title: string }>, load: [] as string[], announced: [] as string[], progress: [] as string[] };
  const logs: TitleLog[] = [];
  const answers = [...(opts.answers ?? [])];
  const summary = [...(opts.summary ?? [])];
  const deps: TitleDeps = {
    model: async () => opts.model ?? { configured: true, level: 'local', provider: 'builtin-ai' },
    load: async (id) => {
      calls.load.push(id);
      const m = meetings.get(id);
      return m ? { id, title: m.title, durationSec: m.durationSec, texts: m.texts } : null;
    },
    origin: async (id) => meetings.get(id)?.origin ?? null,
    generate: async (system, user, allowCloud) => {
      calls.generate.push({ system, user, allowCloud });
      const a = answers.length > 1 ? answers.shift()! : answers[0];
      if (a instanceof Error) throw a;
      return a ?? '';
    },
    setAuto: async (id, expected, title) => {
      calls.setAuto.push({ id, expected, title });
      const m = meetings.get(id);
      let r: SetResult = 'set';
      if (!m) r = 'missing';
      else if (m.origin === 'manual') r = 'manual';
      else if (m.title !== expected) r = 'changed';
      if (r === 'set' && m) {
        m.title = title;
        m.origin = 'auto';
      }
      return r;
    },
    summaryStatus: async () => (summary.length > 1 ? summary.shift()! : summary[0] ?? ''),
    trashed: (id) => (opts.trashed ?? []).includes(id),
    uiLang: () => opts.uiLang ?? 'ru',
    sleep: async () => undefined,
    log: (e) => logs.push(e),
    announce: (id) => calls.announced.push(id),
    progress: (id, on) => calls.progress.push(`${id}:${on ? 'on' : 'off'}`),
  };
  return { titler: createTitler(deps), meetings, calls, logs };
}

const meeting = (over: Partial<Fake> = {}): Fake => ({ id: 'm1', title: DEFAULT, durationSec: 29 * 60, texts: RU_TEXT, origin: null, ...over });
const skipped = (logs: TitleLog[]) => logs.filter((l) => l.event === 'skip').map((l) => (l.event === 'skip' ? l.reason : ''));

describe('название: модель не настроена', () => {
  test('нет провайдера или модели: остаётся дата, текст никуда не уходит, причина в журнале', async () => {
    const w = world({ meetings: [meeting()], model: { configured: false, level: 'unknown', provider: null } });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out).toEqual({ status: 'skipped', reason: 'no-model', detail: undefined });
    expect(w.calls.generate).toHaveLength(0);
    expect(w.calls.load).toHaveLength(0);
    expect(w.meetings.get('m1')!.title).toBe(DEFAULT);
    expect(skipped(w.logs)).toEqual(['no-model']);
  });
  test('ядро ответило «модель не настроена» (ключ пропал): то же самое', async () => {
    const w = world({ meetings: [meeting()], answers: [new Error('model-not-configured')] });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out.status === 'skipped' && out.reason).toBe('no-model');
    expect(w.meetings.get('m1')!.title).toBe(DEFAULT);
  });
});

describe('название: локальная модель', () => {
  test('нормальный ответ: название записано, список узнаёт, пометка не трогается интерфейсом', async () => {
    const w = world({ meetings: [meeting()], answers: ['«Релиз мобильного приложения».'] });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out).toEqual({ status: 'set', title: 'Релиз мобильного приложения' });
    expect(w.meetings.get('m1')!.title).toBe('Релиз мобильного приложения');
    expect(w.calls.setAuto).toEqual([{ id: 'm1', expected: DEFAULT, title: 'Релиз мобильного приложения' }]);
    expect(w.calls.announced).toEqual(['m1']);
    expect(w.calls.generate[0].allowCloud).toBe(false);
  });
  test('пустой ответ, общее название, отказ, не на языке: остаётся дата, тихо', async () => {
    for (const bad of ['', 'Обсуждение', 'Встреча по вопросам', 'Извините, не могу', 'Release schedule of mobile app']) {
      const w = world({ meetings: [meeting()], answers: [bad] });
      const out = await w.titler.titleOne('m1', { mode: 'auto' });
      expect(out.status === 'skipped' && out.reason).toBe('bad-answer');
      expect(w.meetings.get('m1')!.title).toBe(DEFAULT);
      expect(w.calls.setAuto).toHaveLength(0);
      expect(w.calls.announced).toHaveLength(0);
    }
  });
  test('модель упала или молчит: остаётся дата, причина в журнале', async () => {
    const w = world({ meetings: [meeting()], answers: [new Error('timeout')] });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out).toEqual({ status: 'skipped', reason: 'error', detail: 'Error: timeout' });
    expect(w.meetings.get('m1')!.title).toBe(DEFAULT);
    expect(w.logs.some((l) => l.event === 'skip' && l.reason === 'error')).toBe(true);
  });
  test('длинный ответ обрезается до 3 слов по границе слова', async () => {
    const w = world({ meetings: [meeting()], answers: ['Сроки релиза мобильного приложения для клиентов и подрядчиков осенью следующего года'] });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out.status).toBe('set');
    if (out.status === 'set') {
      expect(out.title.split(' ').length).toBeLessThanOrEqual(3);
      expect('Сроки релиза мобильного приложения для клиентов и подрядчиков осенью следующего года').toContain(out.title);
    }
  });
});

describe('название: облачный провайдер', () => {
  const cloud: ModelInfo = { configured: true, level: 'cloud', provider: 'openai' };
  test('автоматически ничего не уходит: ни чтения текста, ни запроса', async () => {
    const w = world({ meetings: [meeting()], model: cloud, answers: ['Релиз мобильной версии'] });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out.status === 'skipped' && out.reason).toBe('cloud-not-allowed');
    expect(w.calls.generate).toHaveLength(0);
    expect(w.calls.load).toHaveLength(0);
    expect(w.meetings.get('m1')!.title).toBe(DEFAULT);
  });
  test('неизвестный провайдер (свой сервер) считается облаком', async () => {
    const w = world({ meetings: [meeting()], model: { configured: true, level: 'unknown', provider: 'custom-openai' } });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out.status === 'skipped' && out.reason).toBe('cloud-not-allowed');
    expect(w.calls.generate).toHaveLength(0);
  });
  test('«Подвести итоги» нажато: название создаётся вместе с итогами', async () => {
    const w = world({ meetings: [meeting()], model: cloud, answers: ['Релиз мобильной версии'], summary: ['processing', 'processing', 'completed'] });
    await w.titler.watchSummary('m1');
    expect(w.calls.generate).toHaveLength(1);
    expect(w.calls.generate[0].allowCloud).toBe(true);
    expect(w.meetings.get('m1')!.title).toBe('Релиз мобильной версии');
  });
  test('итоги не получились: название не создаётся', async () => {
    const w = world({ meetings: [meeting()], model: cloud, answers: ['Релиз мобильной версии'], summary: ['processing', 'failed'] });
    await w.titler.watchSummary('m1');
    expect(w.calls.generate).toHaveLength(0);
    expect(w.meetings.get('m1')!.title).toBe(DEFAULT);
  });
  test('итоги отменены сразу: название не создаётся', async () => {
    const w = world({ meetings: [meeting()], model: cloud, answers: ['Релиз мобильной версии'], summary: ['cancelled'] });
    await w.titler.watchSummary('m1');
    expect(w.calls.generate).toHaveLength(0);
  });
  test('два слежения за одной встречей: один запрос', async () => {
    const w = world({ meetings: [meeting()], model: cloud, answers: ['Релиз мобильной версии'], summary: ['completed'] });
    await Promise.all([w.titler.watchSummary('m1'), w.titler.watchSummary('m1')]);
    expect(w.calls.generate).toHaveLength(1);
  });
});

describe('название: ручное главнее', () => {
  test('переименовал человек: ни автоматика, ни итоги не трогают', async () => {
    const make = () => world({ meetings: [meeting({ title: DEFAULT, origin: 'manual' })], answers: ['Релиз мобильной версии'], summary: ['completed'] });
    for (const run of [
      (w: ReturnType<typeof make>) => w.titler.titleOne('m1', { mode: 'auto' }),
      (w: ReturnType<typeof make>) => w.titler.watchSummary('m1'),
    ]) {
      const w = make();
      await run(w);
      expect(w.calls.generate).toHaveLength(0);
      expect(w.calls.setAuto).toHaveLength(0);
      expect(w.meetings.get('m1')!.title).toBe(DEFAULT);
    }
  });
  test('своё название без пометки (встреча без папки): название не по умолчанию, не трогается', async () => {
    const w = world({ meetings: [meeting({ title: 'Мой план на неделю' })], answers: ['Релиз мобильной версии'] });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out.status === 'skipped' && out.reason).toBe('not-default');
    expect(w.calls.generate).toHaveLength(0);
  });
  test('переименовали, пока модель думала: ядро отказывает, название человека на месте', async () => {
    const w = world({ meetings: [meeting()], answers: ['Релиз мобильной версии'] });
    const original = w.meetings.get('m1')!;
    // имитируем переименование посреди запроса: ответ модели приходит после него
    const orig = w.calls.generate.push.bind(w.calls.generate);
    w.calls.generate.push = ((...a: Parameters<typeof orig>) => {
      original.title = 'Мой план';
      return orig(...a);
    }) as typeof orig;
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out.status === 'skipped' && out.reason).toBe('changed');
    expect(original.title).toBe('Мой план');
  });
  test('гонка с пометкой: ядро вернуло manual, название не записано и не объявлено', async () => {
    const w = world({ meetings: [meeting()], answers: ['Релиз мобильной версии'] });
    const origin = w.meetings.get('m1')!;
    // пометка появляется после проверки интерфейса, до записи ядром
    const gen = w.calls.generate.push.bind(w.calls.generate);
    w.calls.generate.push = ((...a: Parameters<typeof gen>) => {
      origin.origin = 'manual';
      return gen(...a);
    }) as typeof gen;
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out.status === 'skipped' && out.reason).toBe('manual');
    expect(w.calls.announced).toHaveLength(0);
    expect(origin.title).toBe(DEFAULT);
  });
});

describe('название: кому положено', () => {
  test('встреча меньше минуты: ничего не отправляется', async () => {
    const w = world({ meetings: [meeting({ durationSec: 59 })], answers: ['Релиз мобильной версии'] });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out.status === 'skipped' && out.reason).toBe('too-short');
    expect(w.calls.generate).toHaveLength(0);
  });
  test('ровно минута проходит', async () => {
    const w = world({ meetings: [meeting({ durationSec: 60 })], answers: ['Релиз мобильной версии'] });
    expect((await w.titler.titleOne('m1', { mode: 'auto' })).status).toBe('set');
  });
  test('без текста: ничего не отправляется', async () => {
    const w = world({ meetings: [meeting({ texts: ['да', 'угу'] })], answers: ['Релиз мобильной версии'] });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out.status === 'skipped' && out.reason).toBe('no-text');
    expect(w.calls.generate).toHaveLength(0);
  });
  test('встреча в корзине и встреча, которой нет', async () => {
    const w = world({ meetings: [meeting()], trashed: ['m1'], answers: ['Релиз мобильной версии'] });
    expect((await w.titler.titleOne('m1', { mode: 'auto' })).status === 'skipped').toBe(true);
    expect(w.calls.generate).toHaveLength(0);
    const w2 = world({ meetings: [], answers: ['Релиз мобильной версии'] });
    const out = await w2.titler.titleOne('nope', { mode: 'auto' });
    expect(out.status === 'skipped' && out.reason).toBe('missing');
  });
  test('восстановленная после сбоя: название создаётся; пометка восстановления лежит в другом файле и не затрагивается', async () => {
    // восстановленная встреча несёт обычное название по умолчанию («Meeting …» из папки записи)
    const w = world({ meetings: [meeting({ title: DEFAULT, durationSec: 12 * 60 })], answers: ['Релиз мобильной версии'] });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out.status).toBe('set');
    // интерфейс пишет только через api_set_auto_title (title.json в ядре), recovered.json ему недоступен
    expect(w.calls.setAuto).toHaveLength(1);
  });
  test('два запроса к одной встрече одновременно: второй «занято», модель спрошена один раз', async () => {
    const w = world({ meetings: [meeting()], answers: ['Релиз мобильной версии'] });
    const [a, b] = await Promise.all([w.titler.titleOne('m1', { mode: 'auto' }), w.titler.titleOne('m1', { mode: 'auto' })]);
    expect([a.status, b.status].sort()).toEqual(['set', 'skipped']);
    expect(w.calls.generate).toHaveLength(1);
  });
});

describe('название: язык встречи', () => {
  test('английская встреча: запрос и название английские, интерфейс русский', async () => {
    const w = world({ meetings: [meeting({ texts: EN_TEXT })], uiLang: 'ru', answers: ['Mobile release schedule.'] });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out).toEqual({ status: 'set', title: 'Mobile release schedule' });
    expect(w.calls.generate[0].user).toContain('in English');
  });
  test('английская встреча, а модель ответила по-русски: остаётся дата', async () => {
    const w = world({ meetings: [meeting({ texts: EN_TEXT })], answers: ['Релиз мобильной версии'] });
    const out = await w.titler.titleOne('m1', { mode: 'auto' });
    expect(out.status === 'skipped' && out.reason).toBe('bad-answer');
    expect(w.meetings.get('m1')!.title).toBe(DEFAULT);
  });
  test('русская встреча: запрос русский', async () => {
    const w = world({ meetings: [meeting()], uiLang: 'en', answers: ['Релиз мобильной версии'] });
    await w.titler.titleOne('m1', { mode: 'auto' });
    expect(w.calls.generate[0].user).toContain('по-русски');
  });
});

describe('название: слежение за итогами и запись', () => {
  const cloud: ModelInfo = { configured: true, level: 'cloud', provider: 'openai' };
  test('итоги не начались (запуск не состоялся): слежение заканчивается, запросов нет', async () => {
    const w = world({ meetings: [meeting()], model: cloud, answers: ['Релиз мобильной версии'], summary: ['idle'] });
    await w.titler.watchSummary('m1');
    expect(w.calls.generate).toHaveLength(0);
  });
  test('идёт новая запись: название ждёт; запись не кончилась за отведённое время, значит не сейчас', async () => {
    let recording = true;
    let slept = 0;
    const sleep = async () => {
      slept++;
      if (slept === 3) recording = false;
    };
    expect(await stillBusy(() => recording, 10, 5000, sleep)).toBe(false);
    expect(slept).toBe(3);
    recording = true;
    slept = -1000;
    expect(await stillBusy(() => recording, 4, 5000, sleep)).toBe(true);
  });
  test('записи нет: не ждёт совсем', async () => {
    let slept = 0;
    expect(await stillBusy(() => false, 10, 5000, async () => void slept++)).toBe(false);
    expect(slept).toBe(0);
  });
});

describe('название: сигнал «модель придумывает» (полоса пикселей)', () => {
  test('удача: включается до запроса, выключается после записи и объявления', async () => {
    const w = world({ meetings: [meeting()], answers: ['Сроки релиза'] });
    await w.titler.titleOne('m1', { mode: 'auto' });
    expect(w.calls.progress).toEqual(['m1:on', 'm1:off']);
    expect(w.calls.announced).toEqual(['m1']);
  });

  test('ошибка модели и негодный ответ: выключается, дата остаётся', async () => {
    const err = world({ meetings: [meeting()], answers: [new Error('boom')] });
    await err.titler.titleOne('m1', { mode: 'auto' });
    expect(err.calls.progress).toEqual(['m1:on', 'm1:off']);
    const bad = world({ meetings: [meeting()], answers: ['Обсуждение'] });
    await bad.titler.titleOne('m1', { mode: 'auto' });
    expect(bad.calls.progress).toEqual(['m1:on', 'm1:off']);
    expect(bad.meetings.get('m1')!.title).toBe(DEFAULT);
  });

  test('отказ до запроса (нет модели, ручное название, короткая встреча): полосы нет', async () => {
    const noModel = world({ meetings: [meeting()], model: { configured: false, level: 'unknown', provider: null } });
    await noModel.titler.titleOne('m1', { mode: 'auto' });
    const manual = world({ meetings: [meeting({ origin: 'manual' })] });
    await manual.titler.titleOne('m1', { mode: 'auto' });
    const short = world({ meetings: [meeting({ durationSec: 20 })] });
    await short.titler.titleOne('m1', { mode: 'auto' });
    expect([...noModel.calls.progress, ...manual.calls.progress, ...short.calls.progress]).toEqual([]);
  });
});
