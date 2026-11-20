// Чат беты (lib/beta-chat.ts): когда ссылка показывается и что README с константой не расходится.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BETA_CHAT_URL, betaChatUrl } from './beta-chat';

describe('betaChatUrl', () => {
  test('заглушка (пустая строка): ссылки нет', () => {
    expect(betaChatUrl('')).toBeNull();
    expect(betaChatUrl('   ')).toBeNull();
  });
  test('ссылка Telegram: показывается', () => {
    expect(betaChatUrl('https://t.me/shade_beta')).toBe('https://t.me/shade_beta');
    expect(betaChatUrl('https://t.me/+AbCdEf')).toBe('https://t.me/+AbCdEf');
  });
  test('не Telegram или не https: ссылки нет', () => {
    expect(betaChatUrl('http://t.me/shade_beta')).toBeNull();
    expect(betaChatUrl('https://example.com/chat')).toBeNull();
    expect(betaChatUrl('t.me/shade_beta')).toBeNull();
  });
});

// README: блок между <!-- beta-chat --> и <!-- /beta-chat --> следует за константой
test('README показывает чат ровно тогда, когда константа задана', () => {
  const readme = readFileSync(join(import.meta.dir, '../../../../README.md'), 'utf8');
  const block = readme.match(/<!-- beta-chat -->([\s\S]*?)<!-- \/beta-chat -->/);
  expect(block).not.toBeNull();
  const url = betaChatUrl(BETA_CHAT_URL);
  if (url) expect(block![1]).toContain(url);
  else expect(block![1]).not.toContain('t.me');
});
