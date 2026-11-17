// Разбор THIRD_PARTY_NOTICES.md для экрана «Лицензии открытого ПО» (Настройки → О программе).
//
// Один источник правды: файл в корне репозитория. Экран берёт из него название работы,
// ссылку и текст лицензии без изменений; описание на двух языках берёт из strings.ts по id.
// Формат раздела:
//   ## Название
//   <!-- notice: id -->
//   Источник: https://...   (подпись одним словом и ссылка)
//   ...текст для людей...
//   ```text
//   текст лицензии
//   ```
// Раздел без строки notice (например «Благодарности») на экран не попадает.
// Раздел с notice, но без блока кода, тоже не попадает: показывать работу без лицензии нельзя,
// поэтому тест notices.test.ts требует, чтобы у каждого notice был текст лицензии.

import type { StringKey } from '@/shade/strings';

export interface Notice {
  id: string;
  name: string;
  source: string | null;
  license: string;
}

/** Описание работы на экране по её id. Новый раздел в файле требует строку здесь и в strings.ts. */
export const NOTICE_TEXT: Record<string, StringKey> = {
  core: 'noticeCore',
  kokonut: 'noticeKokonut',
};

const ID_RE = /^<!--\s*notice:\s*([a-z0-9-]+)\s*-->\s*$/;
// «Источник: https://…»: подпись одним словом, двоеточие, ссылка (язык подписи не важен)
const SOURCE_RE = /^[^\s:]+:\s*(https?:\/\/\S+)\s*$/;
const FENCE_RE = /^```/;

export function parseNotices(markdown: string): Notice[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const notices: Notice[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('## ')) {
      i++;
      continue;
    }
    const name = lines[i].slice(3).trim();
    let id: string | null = null;
    let source: string | null = null;
    let license: string | null = null;
    i++;
    while (i < lines.length && !lines[i].startsWith('## ')) {
      const line = lines[i];
      const idMatch = line.match(ID_RE);
      const sourceMatch = line.match(SOURCE_RE);
      if (idMatch && id === null) id = idMatch[1];
      else if (sourceMatch && source === null) source = sourceMatch[1];
      else if (FENCE_RE.test(line) && license === null) {
        const body: string[] = [];
        i++;
        while (i < lines.length && !FENCE_RE.test(lines[i])) body.push(lines[i++]);
        license = body.join('\n').trim();
      }
      i++;
    }
    if (id && license && name && !seen.has(id)) {
      seen.add(id);
      notices.push({ id, name, source, license });
    }
  }
  return notices;
}

/** Хост ссылки для подписи кнопки: github.com, kokonutui.com. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
