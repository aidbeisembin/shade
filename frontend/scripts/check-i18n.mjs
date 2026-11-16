// Страж языка: в src/shade кириллица живёт только в словаре strings.ts.
// Запуск: pnpm check:i18n (входит в pnpm check). Падает, если кириллица осталась
// в строке кода, в тексте JSX или в регулярном выражении вне словаря.
//
// Проверяет по разбору кода (TypeScript AST), а не по тексту файла:
//  - комментарии не считаются: по-русски их можно писать, это не интерфейс;
//  - вызовы console.* не считаются: журнал для разработчика, не интерфейс;
//  - файлы *.test.ts(x) не проверяются: проверки сами содержат русские фразы.
//  - аргументы функций-журналов (LOG_FNS), свойства reason и detail (строки для консоли)
//    не считаются: это диагностика для разработчика, а не интерфейс.
// Второе правило: код локали ('ru-RU', 'en-US') пишется только в lib/lang.ts,
// остальные берут её оттуда (Intl с текущим языком, а не зашитым).
// Третье: .tsx, который берёт тексты из словаря (t, tf, tp), обязан вызывать useLang(),
// иначе при смене языка он не перерисуется.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHADE = join(ROOT, 'src/shade');

/** Файлы, где кириллица допустима. Каждое исключение с причиной (CLAUDE.md: ослаблять проверку только с записью). */
export const ALLOW_CYRILLIC = {
  'src/shade/strings.ts': 'сам словарь',
  'src/shade/lib/legacy-i18n.ts':
    'русский перевод строк оригинальных компонентов: словарь ключ-оригинал, в английском режиме мост ничего не подменяет и показывается английский оригинал',
  'src/shade/lib/content-rules.ts':
    'правила отсева галлюцинаций распознавания: русские фразы-образцы это данные о тексте речи, а не интерфейс (английские образцы лежат рядом)',
  'src/shade/lib/content-check.ts':
    'то же: образцы пустой речи в тексте транскрипта, не интерфейс',
  'src/shade/lib/meeting-title-text.ts':
    'запрос к модели и образцы отбраковки названия встречи на языке РАЗГОВОРА (русском и английском): данные для модели, не интерфейс; язык выбирается по тексту встречи, а не по языку интерфейса, словарь strings.ts для этого не подходит',
};

/**
 * Маркер на строке перед нарушением: `// i18n-ignore: причина` (причина не короче 10 знаков).
 * Для журнала разработчика, который не вызывает log/console напрямую. Число маркеров печатается.
 */
const MARKER = /\/\/\s*i18n-ignore:\s*(\S.{8,})$/;

/** Точечные исключения: файл -> {литералы целиком, причина}. Только эти строки, остальное в файле проверяется. */
export const ALLOW_LITERALS = {
  'src/shade/lib/meeting-details-cache.ts': { values: ['е'], reason: 'поиск считает «ё» за «е»: замена букв, не текст интерфейса' },
  'src/shade/lib/meeting.ts': { values: ['е'], reason: 'сравнение названий считает «ё» за «е»: замена букв, не текст интерфейса' },
  'src/shade/lib/speech.ts': { values: ['е'], reason: 'нормализация распознанной речи: «ё» как «е», не текст интерфейса' },
  'src/shade/lib/format.ts': {
    values: [' г.'],
    reason: 'Intl для ru-RU дописывает « г.» к году, в интерфейсе он лишний: срезается в noYearSuffix',
  },
  'src/shade/lib/recording-trash.ts': {
    values: ['Корзина Shade'],
    reason: 'имя папки на диске (формат данных, менять нельзя без переноса), не текст интерфейса',
  },
};

/** Файлы, где Cyrillic разрешён в регулярных выражениях: разбор текста речи и ответа модели, не интерфейс. */
export const ALLOW_REGEX = {
  'src/shade/lib/speech.ts': 'образцы галлюцинаций и заполнителей в распознанной речи',
  'src/shade/lib/meeting.ts': 'разбор итогов модели (заглушки пустых разделов, строка «Дата:») и подписей спикеров',
  'src/shade/lib/meeting-details-cache.ts': 'нормализация текста для поиска («ё» как «е»)',
};

/** .tsx без компонентов: тексты берутся в момент события (обработчик, тост), подписка на язык не нужна. */
export const NO_HOOK_NEEDED = {
  'src/shade/lib/toasts.tsx': 'тосты собираются при вызове (t() в обработчиках), не при рендере',
};

/** Журналы: аргументы этих функций не интерфейс (консоль разработчика). */
const LOG_FNS = new Set(['obLog', 'log']);
/** Свойства, куда пишется диагностика для консоли. */
const DIAG_PROPS = new Set(['reason', 'detail']);

/** Где можно писать код локали. */
const LOCALE_HOME = 'src/shade/lib/lang.ts';

const CYR = /[Ѐ-ӿ]/;
const LOCALE = /^(ru|en)-(RU|US|GB)$/;
const DICT_FNS = new Set(['t', 'tf', 'tp', 'tDays']);
/** Форматирование по языку из lib/format: компонент с ним тоже обязан подписаться на язык. */
const FORMAT_FNS = new Set([
  'formatDateTime', 'formatShortDate', 'formatTime', 'formatNumber', 'formatDuration', 'formatVolume',
  'displayTitle', 'shownTitle', 'editableTitle', 'formatFileSize',
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) yield p;
  }
}

function isLogCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const e = node.expression;
  if (ts.isIdentifier(e)) return LOG_FNS.has(e.text);
  return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'console';
}

function isDiagProp(node) {
  return ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && DIAG_PROPS.has(node.name.text);
}

const FN_KINDS = [
  ts.isFunctionDeclaration, ts.isFunctionExpression, ts.isArrowFunction, ts.isMethodDeclaration,
  ts.isConstructorDeclaration, ts.isGetAccessor, ts.isSetAccessor, ts.isClassStaticBlockDeclaration,
];
const isFnNode = (n) => FN_KINDS.some((f) => f(n));

/** Нарушения одного файла: [{line, kind, text}]. rel: путь от frontend со слэшами. */
export const ignored = { lines: new Set() };

export function checkSource(rel, text) {
  const out = [];
  const cyrillicOk = rel in ALLOW_CYRILLIC;
  const literalOk = new Set(ALLOW_LITERALS[rel]?.values ?? []);
  const regexOk = rel in ALLOW_REGEX;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split('\n');
  const add = (node, kind, value) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    // маркер строкой выше или в конце той же строки
    if (kind !== 'hook' && (MARKER.test(lines[line - 1] ?? '') || MARKER.test(lines[line] ?? ''))) {
      ignored.lines.add(`${rel}:${line}`);
      return;
    }
    out.push({ line: line + 1, kind, text: String(value).trim().slice(0, 60) });
  };

  let importsDict = false;
  let usesLangHook = false;
  const importedDict = new Set();

  const visit = (node, inLog, depth) => {
    const skip = inLog || isLogCall(node) || isDiagProp(node);
    if (!cyrillicOk && !skip) {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && CYR.test(node.text)) {
        if (!literalOk.has(node.text)) add(node, 'cyrillic', node.text);
      } else if ((ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && CYR.test(node.text)) add(node, 'cyrillic', node.text);
      else if (ts.isJsxText(node) && CYR.test(node.text)) add(node, 'cyrillic', node.text);
      else if (ts.isRegularExpressionLiteral(node) && CYR.test(node.text) && !regexOk) add(node, 'cyrillic', node.text);
    }
    // t() на верхнем уровне модуля вычисляется один раз при загрузке и не меняется со сменой языка
    if (depth === 0 && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && DICT_FNS.has(node.expression.text) && importedDict.has(node.expression.text)) {
      add(node, 'module-level', `${node.expression.text}() вне функции: язык не переключится, оберните в функцию`);
    }
    if (rel !== LOCALE_HOME && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && LOCALE.test(node.text) && !skip) {
      add(node, 'locale', node.text);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /(^|\/)(strings|format)$/.test(node.moduleSpecifier.text)) {
      const nb = node.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          const name = (el.propertyName ?? el.name).text;
          if (DICT_FNS.has(name) || FORMAT_FNS.has(name)) {
            importsDict = true;
            if (DICT_FNS.has(name)) importedDict.add(el.name.text);
          }
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useLang') usesLangHook = true;
    const next = isFnNode(node) ? depth + 1 : depth;
    ts.forEachChild(node, (c) => visit(c, skip, next));
  };
  visit(sf, false, 0);

  if (rel.endsWith('.tsx') && importsDict && !usesLangHook && !(rel in NO_HOOK_NEEDED)) {
    out.push({ line: 1, kind: 'hook', text: 'берёт тексты из словаря, но не вызывает useLang(): язык не переключится на лету' });
  }
  return out;
}

export function checkAll() {
  const problems = [];
  for (const file of walk(SHADE)) {
    const rel = relative(ROOT, file).split(sep).join('/');
    for (const v of checkSource(rel, readFileSync(file, 'utf8'))) problems.push({ file: rel, ...v });
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = checkAll();
  if (problems.length === 0) {
    console.log(`check:i18n ok: кириллица только в словаре, локали только в lib/lang.ts (строк под маркером i18n-ignore: ${ignored.lines.size})`);
    process.exit(0);
  }
  const byFile = new Map();
  for (const p of problems) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
  for (const [file, list] of byFile) {
    console.error(`\n${file}`);
    for (const p of list) console.error(`  ${p.line}: [${p.kind}] ${p.text}`);
  }
  console.error(`\ncheck:i18n: ${problems.length} нарушений в ${byFile.size} файлах. Русский текст переносится в src/shade/strings.ts.`);
  console.error('Исключения только явными списками ALLOW_* в scripts/check-i18n.mjs, с причиной и записью в docs/case/decisions.md.');
  process.exit(1);
}
