// Отправка отзыва в функцию api/feedback (проект Vercel этого репозитория) и очередь на случай,
// когда отправить не вышло. Ничего не уходит само: sendFeedback вызывается только кнопкой
// «Отправить» или «Отправить оценку». Очередь в localStorage (QUEUE_KEY), при запуске
// flushQueue пробует снова, каждый отзыв не больше MAX_ATTEMPTS раз, потом выбрасывается.
//
// Исходы:
//   sent    функция ответила 2xx;
//   queued  нет сети, тайм-аут, 429, 5xx (в том числе 503 «функция не настроена»): отзыв
//           в очереди, человеку «Не получилось отправить, попробуем позже»;
//   failed  функция отвергла тело (4xx кроме 429): повтор не поможет, в очередь не кладём.
// Отзыв уходит только по кнопке «Отправить». Анонимная статистика - отдельный канал (lib/stats.ts).

import { MAX_BODY_BYTES, type FeedbackPayload } from './contract';

/**
 * Куда уходит отзыв. Единственное место с адресами; те же домены в CSP connect-src (tauri.conf.json).
 * Основной: портфолио владельца пересылает /shade/* на проект Vercel «shade». Запасной: прямой домен
 * проекта Vercel, пока основной не настроен или если он пропадёт.
 */
export const FEEDBACK_URL = 'https://aidbeisembin.com/shade/api/feedback';
export const FEEDBACK_FALLBACK_URL = 'https://meetily-tau.vercel.app/api/feedback';
export const FEEDBACK_URLS = [FEEDBACK_URL, FEEDBACK_FALLBACK_URL] as const;
export const QUEUE_KEY = 'shade.feedback.queue.v1';
/** Попыток из очереди (по одной на запуск), потом отзыв выбрасывается. */
export const MAX_ATTEMPTS = 3;
/** Не больше отзывов в очереди: старые уходят первыми. */
export const QUEUE_MAX = 10;
export const SEND_TIMEOUT_MS = 10_000;

export type SendResult = 'sent' | 'queued' | 'failed';

export interface QueuedFeedback {
  id: string;
  payload: FeedbackPayload;
  attempts: number;
  queuedAt: number;
}

export interface SendDeps {
  fetch: (url: string, init: RequestInit) => Promise<Pick<Response, 'status'>>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  online: () => boolean;
  now: () => number;
  timeoutMs?: number;
}

type Attempt = 'sent' | 'retry' | 'reject';

/** Код ответа или 'network': нет сети, CSP, CORS, тайм-аут. */
async function post(url: string, body: string, deps: SendDeps): Promise<number | 'network'> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), deps.timeoutMs ?? SEND_TIMEOUT_MS) : null;
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: ctrl?.signal,
    });
    return res.status;
  } catch {
    return 'network';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Основной адрес, при сетевой ошибке запасной. 404 и 405 основного тоже ведут на запасной: так
 * отвечает адрес, который ещё не пересылается на функцию, и отзыв не должен из-за этого пропасть.
 * Ответ функции (2xx, 4xx, 429, 5xx) окончательный: та же функция за запасным ответила бы так же.
 */
async function attempt(payload: FeedbackPayload, deps: SendDeps): Promise<Attempt> {
  if (!deps.online()) return 'retry';
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return 'reject';
  for (const url of FEEDBACK_URLS) {
    const status = await post(url, body, deps);
    if (status === 'network' || status === 404 || status === 405) continue;
    if (status >= 200 && status < 300) return 'sent';
    if (status === 429 || status >= 500) return 'retry';
    return 'reject';
  }
  // Оба адреса недоступны: повторим при следующем запуске
  return 'retry';
}

export function readQueue(storage: SendDeps['storage']): QueuedFeedback[] {
  try {
    const v = JSON.parse(storage?.getItem(QUEUE_KEY) ?? '[]') as unknown;
    return Array.isArray(v)
      ? v.filter((x): x is QueuedFeedback => !!x && typeof x.id === 'string' && !!x.payload && typeof x.attempts === 'number')
      : [];
  } catch {
    return [];
  }
}

function writeQueue(storage: SendDeps['storage'], items: QueuedFeedback[]) {
  try {
    if (items.length) storage?.setItem(QUEUE_KEY, JSON.stringify(items.slice(-QUEUE_MAX)));
    else storage?.removeItem(QUEUE_KEY);
  } catch (error) {
    // Нет места или хранилище закрыто: отзыв теряется, приложение работает дальше
    console.warn('[shade] Отзыв: очередь не записана:', error);
  }
}

let seq = 0;
const newId = (now: number) => `${now.toString(36)}-${(seq++).toString(36)}`;

/** Отправить сейчас; не вышло по временной причине: в очередь. */
export async function sendFeedback(payload: FeedbackPayload, deps: SendDeps): Promise<SendResult> {
  const r = await attempt(payload, deps);
  if (r === 'sent') return 'sent';
  if (r === 'reject') {
    console.warn('[shade] Отзыв: функция отвергла тело, в очередь не кладу');
    return 'failed';
  }
  writeQueue(deps.storage, [...readQueue(deps.storage), { id: newId(deps.now()), payload, attempts: 0, queuedAt: deps.now() }]);
  console.info('[shade] Отзыв: не отправлен, в очереди до следующего запуска');
  return 'queued';
}

let flushing: Promise<{ sent: number; left: number; dropped: number }> | null = null;

/** При запуске: по одной попытке на каждый отзыв из очереди. Одновременно идёт один проход. */
export function flushQueue(deps: SendDeps): Promise<{ sent: number; left: number; dropped: number }> {
  if (flushing) return flushing;
  flushing = (async () => {
    const items = readQueue(deps.storage);
    let sent = 0;
    let dropped = 0;
    const keep: QueuedFeedback[] = [];
    for (const item of items) {
      const r = await attempt(item.payload, deps);
      const attempts = item.attempts + 1;
      if (r === 'sent') sent++;
      else if (r === 'reject' || attempts >= MAX_ATTEMPTS) dropped++;
      else keep.push({ ...item, attempts });
    }
    // За время прохода могли добавить новый отзыв: его не трогаем
    const added = readQueue(deps.storage).filter((x) => !items.some((y) => y.id === x.id));
    writeQueue(deps.storage, [...keep, ...added]);
    if (items.length) console.info(`[shade] Отзыв: очередь при запуске: ушло ${sent}, осталось ${keep.length}, выброшено ${dropped}`);
    return { sent, left: keep.length + added.length, dropped };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/**
 * Версия macOS из строки браузера. WebKit в окне приложения замораживает её на 10_15_7, настоящей
 * версии там нет: тогда «unknown», а не заведомо неверное число.
 */
export function macosFromUserAgent(ua: string): string {
  const m = /Mac OS X (\d+)[._](\d+)(?:[._](\d+))?/.exec(ua);
  if (!m) return 'unknown';
  const v = [m[1], m[2], m[3]].filter(Boolean).join('.');
  return v === '10.15.7' ? 'unknown' : v;
}
