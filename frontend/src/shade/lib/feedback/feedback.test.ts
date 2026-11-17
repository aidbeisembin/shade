// Обратная связь: правила показа, шаги формы, очередь, клавиатура звёзд, движение и функция api/feedback.
// bun test src/shade (pnpm test). Таблица случаев: docs/ui/feedback.md.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  EMPTY_PROMPT,
  MIN_SECONDS,
  REPEAT_GAP_DAYS,
  SECOND_GAP_DAYS,
  gapAfter,
  markCompleted,
  markDismissed,
  markRated,
  markShown,
  offerVerdict,
  parsePrompt,
  unmarkCompleted,
  type OfferContext,
  type PromptState,
} from './policy';
import { START, canSend, flowReducer, type Flow } from './flow';
import { MAX_TEXT, clampText, validatePayload, type FeedbackPayload } from './contract';
import { FEEDBACK_FALLBACK_URL, FEEDBACK_URL, MAX_ATTEMPTS, QUEUE_KEY, flushQueue, macosFromUserAgent, readQueue, sendFeedback, type SendDeps } from './send';
import { starKey } from './stars';
import { setReducedMotion, simulate, spring } from '../motion/spring';
import { LABEL_ROLL, STAR_FILL, STAR_POP, STAR_POP_FROM, STAR_POP_VELOCITY, overshootOf } from '../motion/shade-springs';
import { ALLOWED_ORIGINS, RATE_LIMIT, formatMessage, handleFeedback, resetRateLimitForTests, type Deps } from '../../../../api/feedback';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const ctx = (over: Partial<OfferContext> = {}): OfferContext => ({
  meetingId: 'm1',
  summaryReady: true,
  recovered: false,
  recording: false,
  durationSec: 12 * 60,
  askEnabled: true,
  now: NOW,
  ...over,
});
const one = (): PromptState => markCompleted(EMPTY_PROMPT, 'm1');
/** Показана n раз, последний раз daysAgo дней назад. */
const shownTimes = (n: number, daysAgo: number): PromptState => {
  let s = one();
  for (let i = 0; i < n; i++) s = markShown(s, NOW - daysAgo * DAY);
  return s;
};

describe('когда показывать карточку', () => {
  test('первая запись от 10 минут, итоги открыты: карточка сразу', () => {
    expect(MIN_SECONDS).toBe(600);
    expect(offerVerdict(one(), ctx())).toBe('offer');
    expect(offerVerdict(one(), ctx({ durationSec: MIN_SECONDS }))).toBe('offer');
  });

  test('запись короче 10 минут или длительность неизвестна: нет', () => {
    expect(offerVerdict(one(), ctx({ durationSec: MIN_SECONDS - 1 }))).toBe('short');
    expect(offerVerdict(one(), ctx({ durationSec: null }))).toBe('short');
    expect(offerVerdict(one(), ctx({ durationSec: Number.NaN }))).toBe('short');
  });

  test('второй раз через 7 дней после первого, дальше раз в 30 дней', () => {
    expect([SECOND_GAP_DAYS, REPEAT_GAP_DAYS]).toEqual([7, 30]);
    expect([0, 1, 2, 5].map(gapAfter)).toEqual([0, 7 * DAY, 30 * DAY, 30 * DAY]);
    expect(offerVerdict(shownTimes(1, 6.9), ctx())).toBe('cooldown');
    expect(offerVerdict(shownTimes(1, 7), ctx())).toBe('offer');
    expect(offerVerdict(shownTimes(2, 29), ctx())).toBe('cooldown');
    expect(offerVerdict(shownTimes(2, 30), ctx())).toBe('offer');
    expect(offerVerdict(shownTimes(6, 30), ctx())).toBe('offer');
  });

  test('оценка и закрытия цикл не останавливают; оценка сдвигает паузу', () => {
    expect(offerVerdict(markDismissed(markDismissed(shownTimes(2, 31))), ctx())).toBe('offer');
    expect(offerVerdict(markRated(shownTimes(2, 31), NOW - 31 * DAY), ctx())).toBe('offer');
    // Оценил в Настройках 3 дня назад: следующий показ отсчитывается от оценки
    expect(offerVerdict(markRated(shownTimes(2, 31), NOW - 3 * DAY), ctx())).toBe('cooldown');
  });

  test('идёт запись, восстановлена после сбоя, не из записи в этом окне: нет', () => {
    expect(offerVerdict(one(), ctx({ recording: true }))).toBe('recording');
    expect(offerVerdict(one(), ctx({ recovered: true }))).toBe('recovered');
    expect(offerVerdict(one(), ctx({ meetingId: 'imported' }))).toBe('not-completed');
  });

  test('переключатель выключен, итогов нет: нет', () => {
    expect(offerVerdict(one(), ctx({ askEnabled: false }))).toBe('off');
    expect(offerVerdict(one(), ctx({ summaryReady: false }))).toBe('no-summary');
  });

  test('проверка моделью убрала встречу в корзину: не в счёт, «Вернуть» возвращает', () => {
    const s = unmarkCompleted(one(), 'm1');
    expect(offerVerdict(s, ctx())).toBe('not-completed');
    expect(offerVerdict(markCompleted(s, 'm1'), ctx())).toBe('offer');
  });

  test('повтор той же встречи не считается дважды; битое и старое хранилище не роняет', () => {
    expect(markCompleted(one(), 'm1').total).toBe(1);
    expect(parsePrompt('{не json')).toEqual(EMPTY_PROMPT);
    expect(parsePrompt(JSON.stringify({ completed: [{ id: 'a', n: 1 }, null, 5], dismissals: -1 })).dismissals).toBe(0);
    // Состояние до 17.11.2026: без счётчика показов; был показ, значит один (следующий через 7 дней)
    expect(parsePrompt(JSON.stringify({ completed: [], shownAt: NOW })).shows).toBe(1);
    expect(parsePrompt(JSON.stringify({ completed: [] })).shows).toBe(0);
  });
});

describe('шаги карточки', () => {
  const run = (events: Parameters<typeof flowReducer>[1][], from: Flow = START) => events.reduce(flowReducer, from);

  test('2 звезды без текста и закрыть: ничего не ушло, закрытие в счёт', () => {
    const f = run([{ type: 'commit', rating: 2 }]);
    expect(f.step).toBe('form');
    const closed = flowReducer(f, { type: 'close' });
    expect(closed.step).toBe('closed');
    expect(closed.dismissed).toBe(true);
    // Esc в поле низкой оценки тоже закрывает без отправки
    expect(flowReducer(f, { type: 'cancel' })).toMatchObject({ step: 'closed', dismissed: true });
  });

  test('3-5 звёзд: оценка уходит сразу, без текста и без формы', () => {
    for (const rating of [3, 4, 5]) {
      const f = run([{ type: 'commit', rating }]);
      expect(f).toMatchObject({ step: 'sending', rating, text: '', origin: null });
      // Пока уходит, оценку не поменять и второй отправки нет
      expect(flowReducer(f, { type: 'commit', rating: 1 })).toBe(f);
      expect(flowReducer(f, { type: 'send' })).toBe(f);
      // Закрыли посреди отправки: это не «закрытие без оценки»
      expect(flowReducer(f, { type: 'close' }).dismissed).toBe(false);
    }
  });

  test('1-2 звезды: «Что улучшить?», оценку в форме можно поднять, уйдёт только по «Отправить»', () => {
    for (const rating of [1, 2]) expect(run([{ type: 'commit', rating }])).toMatchObject({ step: 'form', origin: 'low' });
    const f = run([{ type: 'commit', rating: 2 }, { type: 'commit', rating: 5 }]);
    expect(f).toMatchObject({ step: 'form', rating: 5 });
    expect(flowReducer(f, { type: 'send' }).step).toBe('sending');
  });

  test('наведение и стрелки до 5 ничего не отправляют', () => {
    const f = run([{ type: 'rate', rating: 5 }]);
    expect(f).toMatchObject({ step: 'ask', rating: 5 });
    expect(flowReducer(f, { type: 'send' })).toBe(f);
  });

  test('повторный клик «Отправить»: второй отправки нет', () => {
    const f = run([{ type: 'commit', rating: 2 }, { type: 'text', text: 'медленно' }, { type: 'send' }]);
    expect(f.step).toBe('sending');
    expect(flowReducer(f, { type: 'send' })).toBe(f);
    const sent = flowReducer(f, { type: 'result', result: 'sent' });
    expect(flowReducer(sent, { type: 'send' })).toBe(sent);
    expect(flowReducer(sent, { type: 'close' }).dismissed).toBe(false);
  });

  test('стрелки меняют оценку, ветку выбирает только подтверждение', () => {
    const f = run([{ type: 'rate', rating: 2 }]);
    expect(f).toMatchObject({ step: 'ask', rating: 2 });
    expect(canSend(f)).toBe(false);
  });

  test('текст длиннее 2000 знаков обрезается, эмодзи не рвутся', () => {
    const long = 'а'.repeat(MAX_TEXT + 50);
    const f = run([{ type: 'commit', rating: 1 }, { type: 'text', text: long }]);
    expect(Array.from(f.text).length).toBe(MAX_TEXT);
    const emoji = '🙂'.repeat(MAX_TEXT + 1);
    expect(Array.from(clampText(emoji)).length).toBe(MAX_TEXT);
    expect(clampText(emoji).endsWith('🙂')).toBe(true);
  });
});

describe('клавиатура звёзд', () => {
  test('стрелки, Home, End, Enter, пробел', () => {
    expect(starKey('ArrowRight', 0)).toEqual({ kind: 'rate', rating: 1 });
    expect(starKey('ArrowUp', 4)).toEqual({ kind: 'rate', rating: 5 });
    expect(starKey('ArrowRight', 5)).toEqual({ kind: 'rate', rating: 5 });
    expect(starKey('ArrowLeft', 1)).toEqual({ kind: 'rate', rating: 1 });
    expect(starKey('ArrowDown', 3)).toEqual({ kind: 'rate', rating: 2 });
    expect(starKey('Home', 4)).toEqual({ kind: 'rate', rating: 1 });
    expect(starKey('End', 1)).toEqual({ kind: 'rate', rating: 5 });
    expect(starKey('Enter', 3)).toEqual({ kind: 'commit', rating: 3 });
    expect(starKey(' ', 2)).toEqual({ kind: 'commit', rating: 2 });
    expect(starKey('Enter', 0)).toBeNull();
    // Esc звёзды не трогают: его ловит карточка или поле
    expect(starKey('Escape', 3)).toBeNull();
  });
});

// ---------- Очередь ----------

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

const payload: FeedbackPayload = { rating: 2, text: 'медленно', appVersion: '0.4.1', macos: 'unknown', locale: 'ru' };

function deps(over: Partial<SendDeps> & { status?: number; throws?: boolean } = {}): SendDeps & { calls: number } {
  const d = {
    calls: 0,
    storage: memStorage(),
    online: () => true,
    now: () => NOW,
    fetch: async () => {
      d.calls++;
      if (over.throws) throw new TypeError('Failed to fetch');
      return { status: over.status ?? 200 };
    },
    ...over,
  };
  return d;
}

describe('отправка и очередь', () => {
  test('без сети: в очереди, после запуска ушла', async () => {
    const d = deps({ online: () => false });
    expect(await sendFeedback(payload, d)).toBe('queued');
    expect(d.calls).toBe(0);
    expect(readQueue(d.storage)).toHaveLength(1);
    const back = deps({ storage: d.storage });
    expect(await flushQueue(back)).toEqual({ sent: 1, left: 0, dropped: 0 });
    expect(d.storage!.getItem(QUEUE_KEY)).toBeNull();
  });

  test('функция отвечает 503: в очереди (человеку «попробуем позже»)', async () => {
    const d = deps({ status: 503 });
    expect(await sendFeedback(payload, d)).toBe('queued');
    expect(readQueue(d.storage)[0].payload).toEqual(payload);
  });

  test('сеть рвётся: в очереди; 429 тоже', async () => {
    expect(await sendFeedback(payload, deps({ throws: true }))).toBe('queued');
    expect(await sendFeedback(payload, deps({ status: 429 }))).toBe('queued');
  });

  test('не больше 3 попыток из очереди, потом выброшен', async () => {
    const d = deps({ online: () => false });
    await sendFeedback(payload, d);
    const fail = deps({ storage: d.storage, status: 503 });
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect((await flushQueue(fail)).left).toBe(1);
    expect(await flushQueue(fail)).toEqual({ sent: 0, left: 0, dropped: 1 });
    expect(fail.calls).toBe(MAX_ATTEMPTS);
  });

  test('функция отвергла тело (400): не в очереди', async () => {
    const d = deps({ status: 400 });
    expect(await sendFeedback(payload, d)).toBe('failed');
    expect(readQueue(d.storage)).toHaveLength(0);
  });

  // Основной адрес aidbeisembin.com/shade, запасной домен Vercel (таблица случаев PR)
  function byUrl(answers: Record<string, number | 'network'>) {
    const urls: string[] = [];
    const d = deps({
      fetch: async (url: string) => {
        urls.push(url);
        const a = answers[url];
        if (a === 'network' || a === undefined) throw new TypeError('Failed to fetch');
        return { status: a };
      },
    });
    return { d, urls };
  }

  test('основной отвечает: запасной не трогается', async () => {
    const { d, urls } = byUrl({ [FEEDBACK_URL]: 200 });
    expect(await sendFeedback(payload, d)).toBe('sent');
    expect(urls).toEqual([FEEDBACK_URL]);
  });

  test('основной недоступен (сеть, CORS, тайм-аут): ушло на запасной', async () => {
    const { d, urls } = byUrl({ [FEEDBACK_URL]: 'network', [FEEDBACK_FALLBACK_URL]: 200 });
    expect(await sendFeedback(payload, d)).toBe('sent');
    expect(urls).toEqual([FEEDBACK_URL, FEEDBACK_FALLBACK_URL]);
    expect(readQueue(d.storage)).toHaveLength(0);
  });

  test('основной ещё не пересылается на функцию (404): ушло на запасной, не потерялось', async () => {
    const { d, urls } = byUrl({ [FEEDBACK_URL]: 404, [FEEDBACK_FALLBACK_URL]: 200 });
    expect(await sendFeedback(payload, d)).toBe('sent');
    expect(urls).toEqual([FEEDBACK_URL, FEEDBACK_FALLBACK_URL]);
  });

  test('ответ функции на основном окончательный: 400 и 503 на запасной не уходят', async () => {
    const reject = byUrl({ [FEEDBACK_URL]: 400, [FEEDBACK_FALLBACK_URL]: 200 });
    expect(await sendFeedback(payload, reject.d)).toBe('failed');
    expect(reject.urls).toEqual([FEEDBACK_URL]);
    const busy = byUrl({ [FEEDBACK_URL]: 503, [FEEDBACK_FALLBACK_URL]: 200 });
    expect(await sendFeedback(payload, busy.d)).toBe('queued');
    expect(busy.urls).toEqual([FEEDBACK_URL]);
  });

  test('оба адреса недоступны: в очереди; из очереди тоже пробуется запасной', async () => {
    const { d, urls } = byUrl({});
    expect(await sendFeedback(payload, d)).toBe('queued');
    expect(urls).toEqual([FEEDBACK_URL, FEEDBACK_FALLBACK_URL]);
    const back = byUrl({ [FEEDBACK_URL]: 'network', [FEEDBACK_FALLBACK_URL]: 200 });
    expect(await flushQueue({ ...back.d, storage: d.storage })).toEqual({ sent: 1, left: 0, dropped: 0 });
  });

  test('хранилища нет: отправка работает, очередь молча теряется', async () => {
    expect(await sendFeedback(payload, deps({ storage: null }))).toBe('sent');
    expect(await sendFeedback(payload, deps({ storage: null, status: 503 }))).toBe('queued');
  });

  test('версия macOS: замороженная WebKit 10.15.7 не выдаётся за настоящую', () => {
    expect(macosFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe('unknown');
    expect(macosFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit')).toBe('14.5');
    expect(macosFromUserAgent('Bun/1.2')).toBe('unknown');
  });
});

// ---------- Движение ----------

describe('движение', () => {
  afterEach(() => setReducedMotion(null));

  test('reduced motion: сразу итог, без прыжка', () => {
    setReducedMotion(true);
    const fill = spring(0, STAR_FILL);
    fill.to(1);
    expect(fill.value).toBe(1);
    expect(fill.resting).toBe(true);
    const pop = spring(1, STAR_POP);
    pop.kick(STAR_POP_VELOCITY);
    expect(pop.value).toBe(1);
    expect(pop.resting).toBe(true);
  });

  test('значения из образца: заливка 300/24 и подпись 260/22 с перелётом около 5 %, прыжок пружинит', () => {
    expect(STAR_FILL).toEqual({ k: 300, c: 24 });
    expect(STAR_POP).toEqual({ k: 520, c: 13 });
    expect(LABEL_ROLL).toEqual({ k: 260, c: 22 });
    // Числа таблицы движения (docs/ui/feedback.md): заливка 4,9 % (в компоненте зажата в 0..1, глазу 0),
    // подпись 5,3 % (сдвиг строки 20 px, около 1 px)
    expect(overshootOf(STAR_FILL)).toBeCloseTo(0.049, 3);
    expect(overshootOf(LABEL_ROLL)).toBeCloseTo(0.053, 3);
    // Прыжок: от 0,7 с толчком 7 к 1. Пик масштаба и время до покоя (таблица в docs/ui/feedback.md)
    const pop = simulate({ ...STAR_POP, from: STAR_POP_FROM, to: 1, v: STAR_POP_VELOCITY, seconds: 1.2 });
    const peak = Math.max(...pop);
    expect(peak).toBeGreaterThan(1.15);
    expect(peak).toBeLessThan(1.35);
    expect(Math.abs(pop[pop.length - 1] - 1)).toBeLessThan(0.01);
  });
});

// ---------- Функция api/feedback ----------

const req = (body: unknown, init: { method?: string; ip?: string; origin?: string; raw?: string } = {}) =>
  new Request('https://example.test/api/feedback', {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': init.ip ?? '10.0.0.1', ...(init.origin ? { origin: init.origin } : {}) },
    body: init.method === 'OPTIONS' || init.method === 'GET' ? undefined : (init.raw ?? JSON.stringify(body)),
  });

function apiDeps(over: Partial<Deps> & { tgStatus?: number } = {}) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const d: Deps & { sent: typeof sent } = {
    sent,
    env: { SHADE_FEEDBACK_BOT_TOKEN: 'test-token', SHADE_FEEDBACK_CHAT_ID: '42' },
    now: () => NOW,
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: over.tgStatus ?? 200 });
    }) as unknown as typeof fetch,
    ...over,
  };
  return d;
}

describe('функция api/feedback', () => {
  beforeEach(() => resetRateLimitForTests());

  test('без переменных окружения: 503, в Telegram ничего', async () => {
    const d = apiDeps({ env: {} });
    expect((await handleFeedback(req(payload), d)).status).toBe(503);
    expect(d.sent).toHaveLength(0);
  });

  test('ушло: 200, простой текст в нужный чат, лишние поля не уходят', async () => {
    const d = apiDeps();
    const res = await handleFeedback(req({ ...payload, meetingText: 'секрет' }), d);
    expect(res.status).toBe(200);
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0].url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    expect(d.sent[0].body.chat_id).toBe('42');
    expect(d.sent[0].body.parse_mode).toBeUndefined();
    expect(String(d.sent[0].body.text)).not.toContain('секрет');
    expect(formatMessage(payload)).toBe('Shade · ★★☆☆☆ 2/5\n\nмедленно\n\nShade 0.4.1 · macOS unknown · ru');
  });

  test('текст длиннее 2000 знаков: 400; ровно 2000: 200', async () => {
    const d = apiDeps();
    expect((await handleFeedback(req({ ...payload, text: 'а'.repeat(MAX_TEXT + 1) }), d)).status).toBe(400);
    expect((await handleFeedback(req({ ...payload, text: 'а'.repeat(MAX_TEXT) }, { ip: '10.0.0.2' }), d)).status).toBe(200);
  });

  test('тело не по договору: 400; тело слишком большое: 413; не JSON: 400', async () => {
    const d = apiDeps();
    expect((await handleFeedback(req({ ...payload, rating: 6 }), d)).status).toBe(400);
    expect((await handleFeedback(req({ ...payload, locale: 'de' }, { ip: '10.0.0.3' }), d)).status).toBe(400);
    expect((await handleFeedback(req(null, { raw: 'x'.repeat(20_000), ip: '10.0.0.4' }), d)).status).toBe(413);
    expect((await handleFeedback(req(null, { raw: '{', ip: '10.0.0.5' }), d)).status).toBe(400);
    expect(validatePayload({ ...payload, appVersion: '<script>' }).ok).toBe(false);
  });

  test('частота с одного адреса: после RATE_LIMIT отзывов 429, другой адрес проходит', async () => {
    const d = apiDeps();
    for (let i = 0; i < RATE_LIMIT; i++) expect((await handleFeedback(req(payload), d)).status).toBe(200);
    expect((await handleFeedback(req(payload), d)).status).toBe(429);
    expect((await handleFeedback(req(payload, { ip: '10.0.0.9' }), d)).status).toBe(200);
  });

  test('Telegram не принял: 502 (Shade кладёт в очередь)', async () => {
    expect((await handleFeedback(req(payload), apiDeps({ tgStatus: 401 }))).status).toBe(502);
  });

  test('CORS: окно Shade получает разрешение, чужой сайт нет; GET 405', async () => {
    const pre = await handleFeedback(req(null, { method: 'OPTIONS', origin: 'tauri://localhost' }), apiDeps());
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
    expect(ALLOWED_ORIGINS).toContain('tauri://localhost');
    const evil = await handleFeedback(req(null, { method: 'OPTIONS', origin: 'https://evil.example' }), apiDeps());
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    expect((await handleFeedback(req(null, { method: 'GET' }), apiDeps())).status).toBe(405);
  });
});
