// Shade не собирает статистику (docs/case/decisions.md, 2026-11-17). Случай из таблицы PR:
// у человека в старой версии было включено «Отправлять статистику» (analyticsOptedIn: true
// в analytics.json). Значение осталось в хранилище, но его некому прочитать и нечего включить:
// ни клиента PostHog, ни команд аналитики в ядре, ни вызовов в окне, ни адреса в CSP.
// Страж держит это состояние: вернуть аналитику можно только сознательно, убрав этот тест.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const FRONTEND = join(import.meta.dir, '..', '..', '..');
const CORE = join(FRONTEND, 'src-tauri');
const SELF = relative(FRONTEND, import.meta.path);

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

function hits(paths: string[], pattern: RegExp): string[] {
  return paths
    .filter((p) => relative(FRONTEND, p) !== SELF)
    .flatMap((p) =>
      readFileSync(p, 'utf8')
        .split('\n')
        .map((line, i) => (pattern.test(line) ? `${relative(FRONTEND, p)}:${i + 1}: ${line.trim()}` : null))
        .filter((x): x is string => x !== null),
    );
}

describe('статистики нет: сохранённое «включено» ничего не отправляет', () => {
  const windowCode = [...files(join(FRONTEND, 'src'), ['.ts', '.tsx']), ...files(join(FRONTEND, 'tests'), ['.ts', '.tsx'])];
  const coreCode = [...files(join(CORE, 'src'), ['.rs']), ...files(join(CORE, 'build'), ['.rs'])];

  test('окно не читает analytics.json и не вызывает команды аналитики', () => {
    expect(hits(windowCode, /analytics\.json|analyticsOptedIn|['"](init_analytics|track_[a-z_]+|identify_user|is_analytics_enabled)['"]/)).toEqual([]);
    expect(hits(windowCode, /@\/lib\/analytics|AnalyticsProvider|AnalyticsConsentSwitch/)).toEqual([]);
  });

  test('в ядре нет PostHog и команд аналитики', () => {
    expect(hits(coreCode, /posthog|mod analytics|analytics::/i)).toEqual([]);
    expect(readFileSync(join(CORE, 'Cargo.toml'), 'utf8')).not.toMatch(/posthog/i);
  });

  test('окну некуда отправить статистику: в CSP нет PostHog', () => {
    const conf = JSON.parse(readFileSync(join(CORE, 'tauri.conf.json'), 'utf8')) as {
      app: { security: { csp: Record<string, string> } };
    };
    expect(JSON.stringify(conf.app.security.csp)).not.toMatch(/posthog/i);
  });
});
