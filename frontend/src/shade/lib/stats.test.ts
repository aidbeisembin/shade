// Анонимная статистика (docs/case/decisions.md, 2026-11-23). Заменяет no-analytics.test.ts:
// старая аналитика (PostHog, команды ядра, analytics.json) по-прежнему под запретом, а новая
// отправляет только три события, только на один адрес, без данных встреч и только когда включена.
//
// Случаи:
//   вход                                      ожидаемое                         при отказе
//   включено (нет ключа), app_started         один POST на STATS_URL            -
//   выключено ('0')                           ни одного запроса                 -
//   событие не из списка                      ни одного запроса                 -
//   сеть или Aptabase отказали                'failed', наружу ошибки нет       событие теряется
//   тело события                              только версия, macos, язык, сессия -
//   старая аналитика в окне или ядре          нет                               -

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { STATS_APP_KEY, STATS_EVENTS, STATS_URL, sendStat, statsBody, type StatsDeps, type StatsEvent } from './stats';

function deps(over: Partial<StatsDeps> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const d: StatsDeps = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { status: 200 };
    },
    enabled: () => true,
    version: async () => '0.5.0',
    userAgent: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit',
    lang: () => 'ru',
    now: () => new Date('2026-11-23T10:00:00Z'),
    session: () => '179540000012345678',
    debug: () => false,
    ...over,
  };
  return { d, calls };
}

describe('отправка событий', () => {
  test('включено: один POST на адрес портфолио с ключом приложения', async () => {
    const { d, calls } = deps();
    expect(await sendStat('app_started', d)).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(STATS_URL);
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['App-Key']).toBe(STATS_APP_KEY);
    expect(calls[0].init.credentials).toBe('omit');
  });

  test('выключено: ни одного запроса, даже запуск', async () => {
    const { d, calls } = deps({ enabled: () => false });
    for (const e of STATS_EVENTS) expect(await sendStat(e, d)).toBe('off');
    expect(calls).toHaveLength(0);
  });

  test('событие не из списка не уходит', async () => {
    const { d, calls } = deps();
    expect(await sendStat('meeting_title' as StatsEvent, d)).toBe('off');
    expect(calls).toHaveLength(0);
  });

  test('отказ сети: failed, ошибка не выходит наружу', async () => {
    const { d } = deps({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
    expect(await sendStat('app_recording_started', d)).toBe('failed');
  });

  test('тело: только версия, macOS, язык, сессия и имя события', () => {
    const { d } = deps();
    const body = statsBody('app_summary_ready', '0.5.0', d);
    expect(body).toEqual({
      timestamp: '2026-11-23T10:00:00.000Z',
      sessionId: '179540000012345678',
      eventName: 'app_summary_ready',
      systemProps: { locale: 'ru', isDebug: false, appVersion: '0.5.0', sdkVersion: 'shade-stats@1' },
      props: { macos: '14.5' },
    });
  });

  test('событий ровно три', () => {
    expect([...STATS_EVENTS]).toEqual(['app_started', 'app_recording_started', 'app_summary_ready']);
  });
});

// ---------- Старая аналитика под запретом (бывший no-analytics.test.ts) ----------

const FRONTEND = join(import.meta.dir, '..', '..', '..');
const CORE = join(FRONTEND, 'src-tauri');
const SELF = relative(FRONTEND, import.meta.path);
const STATS_FILE = join('src', 'shade', 'lib', 'stats.ts');

function files(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name === 'gen' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(path);
  }
  return out;
}

function hits(paths: string[], pattern: RegExp, skip: string[] = []): string[] {
  return paths
    .filter((p) => ![SELF, ...skip].includes(relative(FRONTEND, p)))
    .flatMap((p) =>
      readFileSync(p, 'utf8')
        .split('\n')
        .map((line, i) => (pattern.test(line) ? `${relative(FRONTEND, p)}:${i + 1}: ${line.trim()}` : null))
        .filter((x): x is string => x !== null),
    );
}

describe('старой аналитики нет, новая только в stats.ts', () => {
  const windowCode = [...files(join(FRONTEND, 'src'), ['.ts', '.tsx']), ...files(join(FRONTEND, 'tests'), ['.ts', '.tsx'])];
  const coreCode = [...files(join(CORE, 'src'), ['.rs']), ...files(join(CORE, 'build'), ['.rs'])];

  test('окно не читает analytics.json и не вызывает старые команды аналитики', () => {
    expect(hits(windowCode, /analytics\.json|analyticsOptedIn|['"](init_analytics|track_[a-z_]+|identify_user|is_analytics_enabled)['"]/)).toEqual([]);
    expect(hits(windowCode, /@\/lib\/analytics|AnalyticsProvider|AnalyticsConsentSwitch/)).toEqual([]);
  });

  test('в ядре нет PostHog и команд аналитики', () => {
    expect(hits(coreCode, /posthog|mod analytics|analytics::/i)).toEqual([]);
    expect(readFileSync(join(CORE, 'Cargo.toml'), 'utf8')).not.toMatch(/posthog/i);
  });

  test('в CSP нет PostHog и Aptabase: события идут через aidbeisembin.com', () => {
    const conf = JSON.parse(readFileSync(join(CORE, 'tauri.conf.json'), 'utf8')) as {
      app: { security: { csp: Record<string, string> } };
    };
    expect(JSON.stringify(conf.app.security.csp)).not.toMatch(/posthog|aptabase/i);
  });

  test('адрес и ключ статистики есть только в stats.ts', () => {
    expect(hits(windowCode, /shade\/e['"/]|A-EU-2286768688|aptabase\.com/i, [STATS_FILE])).toEqual([]);
  });
});
