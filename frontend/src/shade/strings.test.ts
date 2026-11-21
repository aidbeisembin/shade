// Тесты словаря: bun test src/shade (pnpm test).
// Ключи ru и en совпадают (это ещё и ошибка tsc), оформление английского по правилам,
// склонения через Intl.PluralRules (1, 2, 5, 21), пропущенный ключ не роняет интерфейс.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { en, lookup, ru, t, tDays, tf, tIn, tp, tpIn, trashDays } from './strings';
import { resetLangForTests, setLang } from './lib/lang';

const g = globalThis as unknown as Record<string, unknown>;
const ruD = ru as Record<string, string | Record<string, string>>;
const enD = en as Record<string, string | Record<string, string>>;
const keys = Object.keys(ruD);

/** Все строки значения: сама строка или формы числа. */
const texts = (v: string | Record<string, string>): string[] => (typeof v === 'string' ? [v] : Object.values(v));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const norm = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ');

beforeEach(() => {
  g.window = { location: { search: '' }, localStorage: undefined, sessionStorage: undefined };
  resetLangForTests('ru');
});
afterEach(() => {
  delete g.window;
});

describe('ключи и подстановки', () => {
  test('en и ru: один набор ключей', () => {
    expect(Object.keys(enD).sort()).toEqual([...keys].sort());
  });

  test('вид значения совпадает: строка к строке, формы числа к формам числа', () => {
    for (const k of keys) expect([k, typeof enD[k]]).toEqual([k, typeof ruD[k]]);
  });

  test('подстановки {name} одни и те же в ru и en, в каждой форме числа', () => {
    for (const k of keys) {
      const r = ruD[k];
      const e = enD[k];
      if (typeof r === 'string' && typeof e === 'string') {
        expect([k, placeholders(r)]).toEqual([k, placeholders(e)]);
      } else if (typeof r !== 'string' && typeof e !== 'string') {
        // en: one и other, ru: one, few, many, other; набор подстановок у всех форм равен
        const base = placeholders(r.other);
        for (const form of [...Object.values(r), ...Object.values(e)]) expect([k, placeholders(form)]).toEqual([k, base]);
      }
    }
  });

  test('формы числа: у ru все четыре, у en one и other; в каждой есть {n}', () => {
    for (const k of keys) {
      const r = ruD[k];
      const e = enD[k];
      if (typeof r === 'string' || typeof e === 'string') continue;
      expect([k, Object.keys(r).sort()]).toEqual([k, ['few', 'many', 'one', 'other']]);
      expect([k, Object.keys(e).sort()]).toEqual([k, ['one', 'other']]);
      for (const form of [...Object.values(r), ...Object.values(e)]) expect([k, form.includes('{n}')]).toEqual([k, true]);
    }
  });

  test('нет пустых значений', () => {
    for (const k of keys) for (const s of [...texts(ruD[k]), ...texts(enD[k])]) expect([k, s.trim().length > 0]).toEqual([k, true]);
  });
});

describe('оформление английского', () => {
  const allEn = keys.flatMap((k) => texts(enD[k]).map((s) => [k, s] as const));

  test('без кириллицы, кроме названий языков в переключателе и «Язык / Language»', () => {
    const allowed = new Set(['langRu', 'interfaceLanguage']);
    for (const [k, s] of allEn) if (!allowed.has(k)) expect([k, /[Ѐ-ӿ]/.test(s)]).toEqual([k, false]);
  });

  test('кавычки “…”: ни «ёлочек», ни прямых " и \'', () => {
    for (const [k, s] of allEn) {
      expect([k, /[«»]/.test(s)]).toEqual([k, false]);
      expect([k, s.includes('"')]).toEqual([k, false]);
      expect([k, s.includes("'")]).toEqual([k, false]);
    }
  });

  test('тире короткое –, длинного — нет, дефис с пробелами заменён', () => {
    for (const [k, s] of allEn) {
      expect([k, s.includes('—')]).toEqual([k, false]);
      expect([k, s.includes(' - ')]).toEqual([k, false]);
    }
  });

  test('многоточие …, а не три точки', () => {
    for (const [k, s] of allEn) expect([k, s.includes('...')]).toEqual([k, false]);
  });

  test('точки в конце строки нет ни на одном языке (решение владельца 2026-11-21)', () => {
    const endsDot = (s: string) => /[^.]\.$/.test(s.trimEnd());
    // «дн.» это сокращение, а не конец предложения
    const abbreviation = new Set(['trashDaysLeft']);
    const forms = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v as Record<string, string>) : []);
    for (const k of keys) {
      if (abbreviation.has(k)) continue;
      for (const s of [...forms(ruD[k]), ...forms(enD[k])]) expect([k, endsDot(s)]).toEqual([k, false]);
    }
  });

  test('язык интерфейса называется одинаково на обоих языках', () => {
    expect(en.interfaceLanguage).toBe(ru.interfaceLanguage);
    expect(en.langRu).toBe('Русский');
    expect(en.langEn).toBe('English');
  });

  test('длинная строка: английский не длиннее русского больше чем в 1,6 раза у коротких подписей', () => {
    // Короткие подписи (до 30 знаков по-русски) стоят в кнопках, вкладках и меню: там перенос недопустим.
    // Длинные тексты переносятся по словам, это проверяется на снимках 1100 × 700.
    const over: string[] = [];
    for (const k of keys) {
      const r = ruD[k];
      const e = enD[k];
      if (typeof r !== 'string' || typeof e !== 'string') continue;
      if (r.length <= 30 && e.length > Math.max(r.length * 1.6, 16)) over.push(`${k}: ${r.length} -> ${e.length}`);
    }
    expect(over).toEqual([]);
  });
});

describe('склонения через Intl.PluralRules: 1, 2, 5, 21', () => {
  const ruCase = (n: number) => tpIn('ru', 'wordsCount', n).replace(/[\u00A0\u202F]/g, ' ');
  const enCase = (n: number) => tpIn('en', 'wordsCount', n).replace(/[\u00A0\u202F]/g, ' ');

  test('ru: 1 слово, 2 слова, 5 слов, 21 слово', () => {
    expect(ruCase(1)).toBe('1 слово');
    expect(ruCase(2)).toBe('2 слова');
    expect(ruCase(5)).toBe('5 слов');
    expect(ruCase(21)).toBe('21 слово');
  });

  test('ru: 11-14 слов, 22 слова, 25 слов, 0 слов, 101 слово', () => {
    expect(ruCase(11)).toBe('11 слов');
    expect(ruCase(12)).toBe('12 слов');
    expect(ruCase(14)).toBe('14 слов');
    expect(ruCase(22)).toBe('22 слова');
    expect(ruCase(25)).toBe('25 слов');
    expect(ruCase(0)).toBe('0 слов');
    expect(ruCase(101)).toBe('101 слово');
  });

  test('en: 1 word, 2 words, 5 words, 21 words, 0 words', () => {
    expect(enCase(1)).toBe('1 word');
    expect(enCase(2)).toBe('2 words');
    expect(enCase(5)).toBe('5 words');
    expect(enCase(21)).toBe('21 words');
    expect(enCase(0)).toBe('0 words');
  });

  test('число с разрядами по локали: 1 234 слова и 1,234 words', () => {
    expect(ruCase(1234)).toBe('1 234 слова');
    expect(enCase(1234)).toBe('1,234 words');
  });

  test('дробное число идёт в форму other', () => {
    expect(ruCase(1.5)).toBe('1,5 слова');
    expect(enCase(1.5)).toBe('1.5 words');
  });

  test('все словари с формами работают на 1, 2, 5, 21 на обоих языках', () => {
    for (const k of keys) {
      if (typeof ruD[k] === 'string') continue;
      for (const n of [1, 2, 5, 21]) {
        for (const lang of ['ru', 'en'] as const) {
          const s = tpIn(lang, k as 'wordsCount', n, { days: '30 days' });
          expect([k, lang, n, /\{\w+\}/.test(s)]).toEqual([k, lang, n, false]);
        }
      }
    }
  });

  test('срок корзины: 30 дней и 30 days, неразрывный пробел', () => {
    expect(tpIn('ru', 'daysCount', 30)).toBe('30 дней');
    expect(tpIn('en', 'daysCount', 30)).toBe('30 days');
    expect(tpIn('ru', 'daysCount', 21)).toBe('21 день');
    expect(trashDays()).toBe('30 дней');
  });

  test('реплики: 1 реплика, 2 реплики, 5 реплик, 21 реплика / 1 segment, 5 segments', () => {
    expect(norm(tpIn('ru', 'repliesCount', 21))).toBe('21 реплика');
    expect(norm(tpIn('ru', 'repliesCount', 5))).toBe('5 реплик');
    expect(tpIn('en', 'repliesCount', 1)).toBe('1 segment');
    expect(tpIn('en', 'repliesCount', 5)).toBe('5 segments');
  });
});

describe('t, tf, tp на текущем языке', () => {
  test('t по умолчанию русский, после setLang английский, без перезагрузки', () => {
    expect(t('retry')).toBe('Повторить');
    setLang('en');
    expect(t('retry')).toBe('Try again');
    setLang('ru');
    expect(t('retry')).toBe('Повторить');
  });

  test('tf подставляет значения, числа с разрядами по локали', () => {
    expect(norm(tf('obStepOf', { n: 2, total: 3 }))).toBe('Шаг 2 из 3');
    setLang('en');
    expect(tf('obStepOf', { n: 2, total: 3 })).toBe('Step 2 of 3');
    expect(tf('sizeMb', { n: 1234 })).toBe('1,234 MB');
  });

  test('tf: незнакомая подстановка остаётся как есть, а не «undefined»', () => {
    expect(tf('obStepOf', { n: 1 })).toContain('{total}');
  });

  test('tDays подставляет срок корзины на текущем языке', () => {
    expect(tDays('deletedHint')).toContain('30 дней');
    setLang('en');
    expect(tDays('deletedHint')).toBe('Deleted for good in 30\u00A0days');
  });

  test('tp на текущем языке', () => {
    expect(norm(tp('recordsCount', 3))).toBe('3 записи');
    setLang('en');
    expect(tp('recordsCount', 1)).toBe('1 recording');
  });

  test('ключ строкой, а не формой, в tp: возвращается ключ, не падает', () => {
    expect(tpIn('ru', 'retry' as 'wordsCount', 2)).toBe('retry');
  });
});

describe('пропущенный ключ', () => {
  test('нет перевода в en: показан русский, не пусто и не «undefined»', () => {
    const saved = enD.retry;
    delete enD.retry;
    try {
      expect(tIn('en', 'retry')).toBe('Повторить');
      expect(lookup('en', 'retry')).toBe('Повторить');
    } finally {
      enD.retry = saved;
    }
  });

  test('нет ключа нигде: возвращается сам ключ', () => {
    expect(lookup('en', 'noSuchKey')).toBe('noSuchKey');
    expect(lookup('ru', 'noSuchKey')).toBe('noSuchKey');
  });

  test('нет формы числа в en: берётся other, потом ключ', () => {
    const saved = (enD.wordsCount as Record<string, string>).one;
    delete (enD.wordsCount as Record<string, string>).one;
    try {
      expect(tpIn('en', 'wordsCount', 1)).toBe('1 words');
    } finally {
      (enD.wordsCount as Record<string, string>).one = saved;
    }
  });
});

// Подпись карточки уведомления в одну строку, окна не длиннее двух (docs/ui/notifications.md).
// Бюджет в символах с подставленными {days}, {n}; ширины замерены в окне 1100 × 700, SF 14 px:
//  - угол: карточка 500 px, рядом с кнопкой действия колонка текста ~253 px, ~33 знака;
//  - док: карточка по содержимому, не уже 500 px, рядом с кнопкой ~36 знаков в одну строку;
//  - диалог: max-w-md без полей, 400 px, ~55 знаков в строке, две строки.
// Что длиннее, обрезается многоточием с полным текстом в подсказке (ui/notice.tsx).
describe('подпись карточек в одну строку, окон не длиннее двух', () => {
  const BUDGET = {
    corner: {
      max: 33,
      keys: ['deletedHint', 'lowContentHint', 'recordsDeleteFailed', 'recordsCount', 'recoveredManyHint', 'restoredManyHint', 'updateHint', 'updateFailedHint'],
    },
    dock: {
      max: 36,
      keys: [
        'micSilentHint', 'micLostHint', 'systemOnlyHint', 'micBlindHint', 'silenceCauseGeneric', 'silenceCauseNoAccess', 'discardedNotSaved',
        'discardedUnrecognizedHint', 'micDeniedHint', 'micMissingHint', 'micRestartNote', 'micNotSaved', 'micAccessBackHint', 'micAccessUnknownBackHint',
      ],
    },
    dialog: {
      max: 100,
      keys: ['deleteHint', 'deleteForeverHint', 'emptyTrashHint', 'emptyCleanupHintOne', 'emptyCleanupHintMany', 'soundCheckHint', 'importHint', 'importRunningHint', 'importFailedHint', 'licensesIntro', 'licensesEmpty'],
    },
  } as const;
  const fill = (s: string, lang: 'ru' | 'en') => s.replace('{days}', lang === 'ru' ? '30 дней' : '30 days').replace('{n}', '12');
  const forms = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v as Record<string, string>) : []);
  for (const [where, { max, keys: list }] of Object.entries(BUDGET)) {
    test(`${where}: не длиннее ${max} знаков`, () => {
      for (const k of list) {
        expect([k, forms(ruD[k]).length > 0]).toEqual([k, true]);
        for (const s of forms(ruD[k])) expect([k, 'ru', fill(s, 'ru').length <= max]).toEqual([k, 'ru', true]);
        for (const s of forms(enD[k])) expect([k, 'en', fill(s, 'en').length <= max]).toEqual([k, 'en', true]);
      }
    });
  }
});
