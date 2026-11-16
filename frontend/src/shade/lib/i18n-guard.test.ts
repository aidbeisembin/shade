// Тесты стража языка (scripts/check-i18n.mjs): что он ловит, что пропускает, и что репозиторий чист.
import { describe, expect, test } from 'bun:test';

const guardPath = '../../../scripts/check-i18n.mjs';
const { checkSource, checkAll } = (await import(guardPath)) as {
  checkSource: (rel: string, text: string) => { line: number; kind: string; text: string }[];
  checkAll: () => { file: string; line: number; kind: string }[];
};

const kinds = (rel: string, code: string) => checkSource(rel, code).map((v) => v.kind);

describe('кириллица', () => {
  test('строка и текст JSX вне словаря: нарушение', () => {
    expect(kinds('src/shade/components/A.tsx', "export const a = 'Привет';")).toEqual(['cyrillic']);
    expect(kinds('src/shade/components/A.tsx', 'export const A = () => <p>Привет</p>;')).toEqual(['cyrillic']);
    expect(kinds('src/shade/lib/a.ts', 'export const a = `Итого: ${1}`;')).toEqual(['cyrillic']);
  });
  test('комментарии не считаются', () => {
    expect(kinds('src/shade/lib/a.ts', '// Привет\n/* и это */\nexport const a = 1;')).toEqual([]);
  });
  test('console.* и функции-журналы не считаются', () => {
    expect(kinds('src/shade/lib/a.ts', "console.info('[shade] Привет', 1);")).toEqual([]);
    expect(kinds('src/shade/lib/a.ts', "obLog('Привет');")).toEqual([]);
    expect(kinds('src/shade/lib/a.ts', "export const r = { reason: 'Привет' };")).toEqual([]);
  });
  test('словарь strings.ts: можно', () => {
    expect(kinds('src/shade/strings.ts', "export const a = 'Привет';")).toEqual([]);
  });
  test('файл из списка исключений: можно; рядом с ним нельзя', () => {
    expect(kinds('src/shade/lib/legacy-i18n.ts', "export const a = 'Привет';")).toEqual([]);
    expect(kinds('src/shade/lib/other.ts', "export const a = 'Привет';")).toEqual(['cyrillic']);
  });
  test('регулярное выражение с кириллицей: только в файлах из ALLOW_REGEX', () => {
    expect(kinds('src/shade/lib/speech.ts', 'export const r = /привет/;')).toEqual([]);
    expect(kinds('src/shade/lib/other.ts', 'export const r = /привет/;')).toEqual(['cyrillic']);
  });
  test('точечный литерал из ALLOW_LITERALS: можно, соседний нет', () => {
    expect(kinds('src/shade/lib/recording-trash.ts', "export const D = 'Корзина Shade';")).toEqual([]);
    expect(kinds('src/shade/lib/recording-trash.ts', "export const D = 'Другая папка';")).toEqual(['cyrillic']);
  });
  test('маркер i18n-ignore с причиной: можно; без причины нельзя', () => {
    expect(kinds('src/shade/lib/a.ts', "// i18n-ignore: журнал разработчика\nexport const a = 'Привет';")).toEqual([]);
    expect(kinds('src/shade/lib/a.ts', "// i18n-ignore: ок\nexport const a = 'Привет';")).toEqual(['cyrillic']);
  });
});

describe('локаль', () => {
  test('ru-RU и en-US только в lib/lang.ts', () => {
    expect(kinds('src/shade/lib/a.ts', "export const a = d.toLocaleString('ru-RU');")).toEqual(['locale']);
    expect(kinds('src/shade/lib/a.ts', "export const a = d.toLocaleString('en-US');")).toEqual(['locale']);
    expect(kinds('src/shade/lib/lang.ts', "export const a = 'ru-RU';")).toEqual([]);
  });
});

describe('подписка на язык', () => {
  test('.tsx с t() без useLang(): нарушение; с useLang(): нет', () => {
    const bad = "import { t } from '@/shade/strings';\nexport function A() { return <p>{t('x')}</p>; }";
    const ok = "import { t } from '@/shade/strings';\nimport { useLang } from '@/shade/lib/lang';\nexport function A() { useLang(); return <p>{t('x')}</p>; }";
    expect(kinds('src/shade/components/A.tsx', bad)).toEqual(['hook']);
    expect(kinds('src/shade/components/A.tsx', ok)).toEqual([]);
  });
  test('форматирование из format тоже требует подписки', () => {
    const bad = "import { formatNumber } from '@/shade/lib/format';\nexport function A() { return <p>{formatNumber(1)}</p>; }";
    expect(kinds('src/shade/components/A.tsx', bad)).toEqual(['hook']);
  });
  test('.ts без компонентов подписки не требует', () => {
    expect(kinds('src/shade/lib/a.ts', "import { t } from '@/shade/strings';\nexport const f = () => t('x');")).toEqual([]);
  });
  test('t() на верхнем уровне модуля: нарушение, внутри функции нет', () => {
    const top = "import { t } from '@/shade/strings';\nexport const A = t('x');";
    const inner = "import { t } from '@/shade/strings';\nexport const f = () => t('x');";
    expect(kinds('src/shade/lib/a.ts', top)).toEqual(['module-level']);
    expect(kinds('src/shade/lib/a.ts', inner)).toEqual([]);
  });
});

test('репозиторий чист: нарушений в src/shade нет', () => {
  expect(checkAll()).toEqual([]);
});
