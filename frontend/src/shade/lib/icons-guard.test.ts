// Страж значков (docs/ui/foundations.md, «Иконки»): только Phosphor, только залитые. bun test src/shade (pnpm test).
//  1. Чужих наборов значков в слое Shade нет.
//  2. Начертания regular, light, thin, duotone не используются; bold только у шевронов Caret*, лупы
//     и галочки Check в круге карточек уведомлений (ui/notice.tsx, FinishCard.tsx; владелец 21.11.2026).
//  3. Заливку по умолчанию даёт ShadeIcons (IconContext). Компонент Shade, смонтированный в
//     app/layout.tsx вне <ShadeIcons>, обязан обернуть себя сам, если он сам или то, что он
//     импортирует, рисует значки Phosphor: иначе знаки без явного weight рисуются контуром
//     (так было с тостами и окном импорта до 2026-11-21).
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const SRC = join(import.meta.dir, '../..');
const SHADE = join(SRC, 'shade');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx?|mts)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
const files = walk(SHADE);
const read = (p: string) => readFileSync(p, 'utf8');

describe('значки Shade', () => {
  test('только @phosphor-icons/react, без других наборов', () => {
    const bad = files.filter((f) => /from ['"](lucide-react|react-icons[^'"]*|@radix-ui\/react-icons|@heroicons\/[^'"]+)['"]/.test(read(f)));
    expect(bad.map((f) => relative(SRC, f))).toEqual([]);
  });

  test('начертания: только fill; bold у шевронов Caret*, лупы MagnifyingGlass и галочки уведомлений', () => {
    const bad: string[] = [];
    for (const f of files) {
      const lines = read(f).split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/<(\w+)[^<>]*\bweight=["'{]+(\w+)/g)) {
          const [, tag, weight] = m;
          if (weight === 'fill') continue;
          if (weight === 'bold' && (/^Caret/.test(tag) || tag === 'MagnifyingGlass')) continue;
          // Галочка «готово» в круге уведомлений: CheckFat тяжелее часов и стрелки рядом
          if (weight === 'bold' && tag === 'Check' && /components\/(ui\/notice|FinishCard)\.tsx$/.test(f)) continue;
          bad.push(`${relative(SRC, f)}:${i + 1} <${tag} weight="${weight}">`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  test('компоненты Shade вне <ShadeIcons> в layout.tsx оборачивают себя сами', () => {
    const layout = read(join(SRC, 'app/layout.tsx'));
    const open = layout.indexOf('<ShadeIcons>');
    const close = layout.indexOf('</ShadeIcons>');
    expect(open).toBeGreaterThan(-1);
    const outside = layout.slice(0, open) + layout.slice(close);
    // Имена из '@/shade/...' (с переименованием через as) и их файлы
    const imports = new Map<string, string>();
    for (const m of layout.matchAll(/import\s*\{([^}]+)\}\s*from\s*'@\/shade\/([^']+)'/g)) {
      for (const part of m[1].split(',')) {
        const [orig, alias] = part.trim().split(/\s+as\s+/);
        if (orig) imports.set((alias ?? orig).trim(), m[2]);
      }
    }
    const resolve = (from: string, spec: string): string | null => {
      const base = spec.startsWith('@/shade/') ? join(SHADE, spec.slice(8)) : spec.startsWith('.') ? join(dirname(from), spec) : null;
      if (!base) return null;
      for (const ext of ['', '.tsx', '.ts', '/index.tsx', '/index.ts']) if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
      return null;
    };
    // Рисует ли файл или то, что он тянет из слоя Shade, значки Phosphor (без захода внутрь ShadeIcons-обёрток)
    const drawsIcons = (file: string, seen = new Set<string>()): boolean => {
      if (seen.has(file)) return false;
      seen.add(file);
      const src = read(file);
      if (/from '@phosphor-icons\/react'/.test(src) && /<[A-Z]\w*[\s/>]/.test(src)) return true;
      for (const m of src.matchAll(/from '((?:@\/shade\/|\.)[^']+)'/g)) {
        const next = resolve(file, m[1]);
        if (next && !read(next).includes('<ShadeIcons>') && drawsIcons(next, seen)) return true;
      }
      return false;
    };
    const bad: string[] = [];
    for (const [name, spec] of imports) {
      if (name === 'ShadeIcons' || !new RegExp(`<${name}[\\s/>]`).test(outside)) continue;
      const file = resolve(join(SRC, 'app/layout.tsx'), `@/shade/${spec}`);
      if (!file) continue;
      if (!read(file).includes('<ShadeIcons>') && drawsIcons(file)) bad.push(`${name} (${relative(SRC, file)})`);
    }
    expect(bad).toEqual([]);
  });
});
