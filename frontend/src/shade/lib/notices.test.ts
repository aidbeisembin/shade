// Экран «Лицензии открытого ПО»: разбор THIRD_PARTY_NOTICES.md и связь с описаниями в strings.ts.
// Запуск: bun test src/shade (pnpm test).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTICE_TEXT, parseNotices, sourceHost } from './notices';
import { en, ru } from '@/shade/strings';

const FILE = readFileSync(join(import.meta.dir, '../../../../THIRD_PARTY_NOTICES.md'), 'utf8');

const section = (body: string) => `# T\n\n${body}\n`;
const MIT = '```text\nMIT License\n\nCopyright (c) 2024 X\n```';

describe('parseNotices: случаи', () => {
  test('полный раздел: id, название, ссылка, лицензия без изменений', () => {
    const [n] = parseNotices(section(`## Lib A\n<!-- notice: lib-a -->\n\nИсточник: https://example.com/a\n\nТекст.\n\n${MIT}`));
    expect(n).toEqual({ id: 'lib-a', name: 'Lib A', source: 'https://example.com/a', license: 'MIT License\n\nCopyright (c) 2024 X' });
  });

  test('раздел без notice (благодарности) на экран не попадает', () => {
    expect(parseNotices(section(`## Благодарности\n\nТекст.\n\n${MIT}`))).toEqual([]);
  });

  test('notice без текста лицензии не показывается', () => {
    expect(parseNotices(section('## Lib\n<!-- notice: lib -->\nИсточник: https://x.dev'))).toEqual([]);
  });

  test('нет ссылки: source null, раздел остаётся', () => {
    expect(parseNotices(section(`## Lib\n<!-- notice: lib -->\n${MIT}`))[0].source).toBeNull();
  });

  test('повтор id: берётся первый раздел', () => {
    const md = section(`## One\n<!-- notice: x -->\n${MIT}\n\n## Two\n<!-- notice: x -->\n${MIT}`);
    expect(parseNotices(md).map((n) => n.name)).toEqual(['One']);
  });

  test('переводы строк Windows не ломают разбор', () => {
    const md = section(`## Lib\n<!-- notice: lib -->\n${MIT}`).replace(/\n/g, '\r\n');
    expect(parseNotices(md)[0].license).toBe('MIT License\n\nCopyright (c) 2024 X');
  });

  test('пустой файл: пустой список (экран покажет licensesEmpty)', () => {
    expect(parseNotices('')).toEqual([]);
  });

  test('хост ссылки для подписи', () => {
    expect(sourceHost('https://www.github.com/a/b')).toBe('github.com');
    expect(sourceHost('не ссылка')).toBe('не ссылка');
  });
});

describe('THIRD_PARTY_NOTICES.md в репозитории', () => {
  const notices = parseNotices(FILE);
  const markers = FILE.match(/^<!--\s*notice:/gm) ?? [];

  test('каждый раздел с notice разобран и несёт текст лицензии', () => {
    expect(notices.length).toBe(markers.length);
    expect(notices.length).toBeGreaterThan(0);
    for (const n of notices) expect(n.license).toMatch(/Copyright \(c\)/);
  });

  test('ядро записи (core): лицензия MIT целиком, с копирайтом автора 2024 года', () => {
    const m = notices.find((n) => n.id === 'core');
    // Тот же текст MIT, что в LICENSE.md Shade, только строка копирайта своя
    const shadeMit = readFileSync(join(import.meta.dir, '../../../../LICENSE.md'), 'utf8').trim();
    const body = (text: string) => text.replace(/^Copyright \(c\) .*$/m, 'Copyright');
    expect(m?.license).toMatch(/^MIT License\n\nCopyright \(c\) 2024 \S+ Solutions\n/);
    expect(body(m?.license ?? '')).toBe(body(shadeMit));
    expect(m?.source).toStartWith('https://github.com/');
  });

  test('у каждой работы есть описание на обоих языках', () => {
    for (const n of notices) {
      const key = NOTICE_TEXT[n.id];
      expect(key).toBeDefined();
      expect(ru[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });
});
