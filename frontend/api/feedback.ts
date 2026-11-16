// Vercel Function: отзыв из Shade → Telegram (Bot API). Проект Vercel «shade», корень frontend/,
// поэтому файл лежит в frontend/api/ и отвечает по /api/feedback. Next.js собирает сайт статикой
// (output: 'export'), свои маршруты API у него невозможны; эту функцию Vercel собирает отдельно.
//
// Принимает POST JSON {rating, text, appVersion, macos, locale} (договор и пределы в
// api/_contract.ts, общий с приложением; файлы с «_» Vercel функциями не считает).
// Ответы: 200 ушло; 400 тело не по договору; 405 не тот метод; 413 тело больше MAX_BODY_BYTES;
// 429 больше RATE_LIMIT отзывов с одного адреса за RATE_WINDOW_MS; 502 Telegram не принял;
// 503 не заданы переменные окружения (тогда Shade кладёт отзыв в очередь и пишет
// «Не получилось отправить, попробуем позже»).
// Переменные окружения Vercel (в репозиторий не коммитятся): SHADE_FEEDBACK_BOT_TOKEN, SHADE_FEEDBACK_CHAT_ID.
// Текст отзыва в журнал функции не пишется, только код ответа.

// .js и api/package.json с "type": "module": Vercel компилирует файлы по одному, без сборщика,
// и Node грузит их как ES-модули только так (без этого 500 FUNCTION_INVOCATION_FAILED).
import { MAX_BODY_BYTES, validatePayload, type FeedbackPayload } from './_contract.js';

/** Не больше отзывов с одного адреса за окно. Счёт в памяти экземпляра функции (см. docs/ui/feedback.md). */
export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 10 * 60 * 1000;
const TELEGRAM_TIMEOUT_MS = 8000;

/** Откуда разрешён запрос из окна: Shade на macOS (tauri://localhost), на Windows и Linux, разработка. */
export const ALLOWED_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:3118'];

export interface Deps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
}

const hits = new Map<string, number[]>();

/** Счётчик частоты: true, если адрес ещё в пределе (и попытка засчитана). */
export function allow(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  // Память не растёт без конца: старые адреса уходят
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k);
  return true;
}

export function resetRateLimitForTests() {
  hits.clear();
}

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

function clientIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0] : request.headers.get('x-real-ip'))?.trim() || 'unknown';
}

/** Сообщение в Telegram простым текстом (без parse_mode: разметка из отзыва не исполняется). */
export function formatMessage(p: FeedbackPayload): string {
  const stars = '★'.repeat(p.rating) + '☆'.repeat(5 - p.rating);
  const body = p.text.trim() || '(без текста)';
  return `Shade · ${stars} ${p.rating}/5\n\n${body}\n\nShade ${p.appVersion} · macOS ${p.macos} · ${p.locale}`;
}

export async function handleFeedback(request: Request, deps: Deps): Promise<Response> {
  const headers = cors(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json(405, { error: 'method' }, { ...headers, Allow: 'POST, OPTIONS' });

  const token = deps.env.SHADE_FEEDBACK_BOT_TOKEN;
  const chatId = deps.env.SHADE_FEEDBACK_CHAT_ID;
  if (!token || !chatId) {
    console.warn('[feedback] 503: SHADE_FEEDBACK_BOT_TOKEN или SHADE_FEEDBACK_CHAT_ID не заданы');
    return json(503, { error: 'not-configured' }, headers);
  }

  if (!allow(clientIp(request), deps.now())) return json(429, { error: 'rate-limit' }, { ...headers, 'Retry-After': String(RATE_WINDOW_MS / 1000) });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return json(413, { error: 'too-large' }, headers);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: 'too-large' }, headers);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { error: 'json' }, headers);
  }
  const v = validatePayload(parsed);
  if (!v.ok) return json(400, { error: 'invalid', field: v.field }, headers);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const res = await deps.fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: formatMessage(v.value), disable_web_page_preview: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[feedback] 502: Telegram ответил ${res.status}`);
      return json(502, { error: 'telegram' }, headers);
    }
  } catch {
    console.warn('[feedback] 502: Telegram недоступен');
    return json(502, { error: 'telegram' }, headers);
  } finally {
    clearTimeout(timer);
  }
  console.info(`[feedback] 200: оценка ${v.value.rating}`);
  return json(200, { ok: true }, headers);
}

const live = (): Deps => ({ env: process.env, fetch, now: Date.now });

export function POST(request: Request) {
  return handleFeedback(request, live());
}
export function OPTIONS(request: Request) {
  return handleFeedback(request, live());
}
export function GET(request: Request) {
  return handleFeedback(request, live());
}
