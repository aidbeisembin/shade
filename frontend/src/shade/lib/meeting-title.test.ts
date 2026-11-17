// Название встречи: запрос, чистка ответа модели, отказ от пустого и общего, обрезка до 6 слов.
// Запуск: bun test src/shade (pnpm test).
import { describe, expect, test } from 'bun:test';
import {
  buildTitlePrompt,
  checkTitleAnswer,
  detectMeetingLang,
  ineligibleReason,
  isDefaultTitle,
  isGenericTitle,
  MAX_TITLE_CHARS,
  PROMPT_TEXT_CHARS,
  sampleTranscript,
} from './meeting-title';

const ok = (raw: string, lang: 'ru' | 'en' = 'ru') => {
  const r = checkTitleAnswer(raw, lang);
  return r.ok ? r.title : `×${r.reason}`;
};

describe('название по умолчанию', () => {
  test('все виды, которые даёт приложение', () => {
    for (const t of [
      'Meeting 16_11_26_15_02_11',
      'Meeting_16_11_26_15_02_11',
      'Встреча 16 ноября, 15:02',
      'Встреча 3 ноября, 11:37',
      'Встреча 16 ноября 2025, 15:02',
      'Встреча 16.11.2026',
      'Meeting on November 16, 3:02 PM',
      'Meeting on November 16, 15:02',
      'Meeting on Nov 3, 11:37',
    ]) {
      expect(isDefaultTitle(t)).toBe(true);
    }
  });
  test('своё название, пустое и похожее не считаются', () => {
    for (const t of [
      '',
      null,
      undefined,
      'Бюджет на четвёртый квартал',
      'Встреча с подрядчиком «Тихая гавань»',
      'Встреча 2',
      'Встреча в 15:00 с Иваном',
      'Meeting with Acme',
      'Weekly product sync',
      'Meeting 16_11_26',
    ]) {
      expect(isDefaultTitle(t)).toBe(false);
    }
  });
});

describe('язык встречи', () => {
  test('по буквам расшифровки', () => {
    expect(detectMeetingLang('Давайте обсудим сроки релиза мобильного приложения и бюджет', 'en')).toBe('ru');
    expect(detectMeetingLang('Let us talk about the release schedule and the budget today', 'ru')).toBe('en');
  });
  test('русский текст с английскими терминами остаётся русским', () => {
    expect(detectMeetingLang('Нужно сделать PR в Figma и проверить API до пятницы, потом синк по Jira', 'en')).toBe('ru');
  });
  test('мало букв: язык интерфейса', () => {
    expect(detectMeetingLang('да ok', 'en')).toBe('en');
    expect(detectMeetingLang('', 'ru')).toBe('ru');
  });
});

describe('запрос', () => {
  test('русский: условия названия на месте', () => {
    const p = buildTitlePrompt('Обсуждаем бюджет', 'ru');
    expect(p.user).toContain('от 2 до 6 слов');
    expect(p.user).toContain('без кавычек');
    expect(p.user).toContain('без точки');
    expect(p.user).toContain('не называй людей по именам');
    expect(p.user).toContain('Обсуждаем бюджет');
  });
  test('английский запрос просит английское название', () => {
    const p = buildTitlePrompt('We discuss the budget', 'en');
    expect(p.user).toContain('2 to 6 words, in English');
    expect(p.user).toContain('do not use people');
    expect(p.user).not.toMatch(/[Ѐ-ӿ]/);
  });
  test('короткий текст уходит целиком, длинный сокращается с границами по словам', () => {
    expect(sampleTranscript(['раз два', 'три'])).toBe('раз два три');
    const long = Array.from({ length: 3000 }, (_, i) => `слово${i}`);
    const s = sampleTranscript(long);
    expect(s.length).toBeLessThanOrEqual(PROMPT_TEXT_CHARS + 10);
    expect(s.split(' … ')).toHaveLength(3);
    // начало, середина и конец встречи; ни одно слово не разрезано
    expect(s.startsWith('слово0 ')).toBe(true);
    expect(s.endsWith('слово2999')).toBe(true);
    for (const w of s.split(/ … | /)) expect(w).toMatch(/^слово\d+$/);
  });
});

describe('ответ модели: чистка', () => {
  test('кавычки, точка в конце, заглавная буква', () => {
    expect(ok('«сроки релиза мобильной версии».')).toBe('Сроки релиза мобильной версии');
    expect(ok('"Бюджет на следующий квартал."')).toBe('Бюджет на следующий квартал');
    expect(ok('“Выбор подрядчика для редизайна”')).toBe('Выбор подрядчика для редизайна');
    expect(ok("'Планирование найма аналитиков'")).toBe('Планирование найма аналитиков');
  });
  test('метка, разметка и первая строка', () => {
    expect(ok('Название: Бюджет на квартал')).toBe('Бюджет на квартал');
    expect(ok('**Бюджет на квартал**')).toBe('Бюджет на квартал');
    expect(ok('# Бюджет на квартал')).toBe('Бюджет на квартал');
    expect(ok('Бюджет на квартал\n\nПочему так: потому что обсуждали деньги.')).toBe('Бюджет на квартал');
    expect(ok('<think>надо подумать</think>\nБюджет на квартал')).toBe('Бюджет на квартал');
  });
  test('многоточие и восклицание в конце уходят', () => {
    expect(ok('Бюджет на квартал...')).toBe('Бюджет на квартал');
    expect(ok('Бюджет на квартал!')).toBe('Бюджет на квартал');
  });
  test('английское название', () => {
    expect(ok('"release schedule for the mobile app."', 'en')).toBe('Release schedule for the mobile app');
    expect(ok('Title: Hiring plan for analysts', 'en')).toBe('Hiring plan for analysts');
  });
});

describe('ответ модели: обрезка до 6 слов по границе слова', () => {
  test('длинный ответ режется до шести слов', () => {
    const r = checkTitleAnswer('Обсуждение сроков релиза мобильного приложения для клиентов и подрядчиков осенью', 'ru');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.title.split(' ').length).toBeLessThanOrEqual(6);
      expect(r.title).toBe('Обсуждение сроков релиза мобильного приложения для клиентов'.split(' ').slice(0, 6).join(' ').replace(/ для$/, ''));
    }
  });
  test('предлог на обрезанном конце не остаётся', () => {
    // шестое слово «для»: уходит вместе с хвостовым предлогом
    expect(ok('Сроки релиза мобильного приложения выбор для клиентов')).toBe('Сроки релиза мобильного приложения выбор');
    expect(ok('Plan for the release and the budget of the next quarter', 'en')).toBe('Plan for the release');
  });
  test('не длиннее 60 знаков, слово не режется пополам', () => {
    const r = checkTitleAnswer('Сверхдлинноеназваниепервое сверхдлинноеназваниевторое сверхдлинноеназваниетретье', 'ru');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
      for (const w of r.title.split(' ')) expect(w.startsWith('Сверх') || w.startsWith('сверх')).toBe(true);
    }
  });
});

describe('ответ модели: отказ, а не почти подходящее', () => {
  test('пустой', () => {
    for (const raw of ['', '   ', '\n\n', null, undefined, '""', '«»', '```\n```']) expect(ok(raw as string)).toBe('×empty');
  });
  test('общие названия', () => {
    for (const raw of ['Обсуждение', 'Встреча по вопросам', 'Рабочая встреча', 'Обсуждение рабочих вопросов', 'Общий разговор', 'Разное', 'Созвон по теме', 'Встреча']) {
      expect(['×generic', '×too-short']).toContain(ok(raw));
    }
    expect(ok('Meeting', 'en')).toBe('×too-short');
    expect(ok('Team meeting', 'en')).toBe('×generic');
    expect(ok('Discussion of various topics', 'en')).toBe('×generic');
    expect(isGenericTitle('Обсуждение бюджета на квартал', 'ru')).toBe(false);
  });
  test('одно слово: короче двух', () => {
    expect(ok('Бюджет')).toBe('×too-short');
  });
  test('«не могу» вместо названия', () => {
    expect(ok('Извините, я не могу придумать название')).toBe('×refusal');
    expect(ok("I'm sorry, I can't help with that", 'en')).toBe('×refusal');
  });
  test('сумма денег в названии', () => {
    expect(ok('Бюджет 500 тысяч рублей на квартал')).toBe('×money');
    expect(ok('Бюджет $5,000 на квартал')).toBe('×money');
    expect(ok('Budget of 10k for Q4', 'en')).toBe('×money');
    // цифра без денег допустима
    expect(ok('Релиз версии 2.3 и откат')).toBe('Релиз версии 2.3 и откат');
  });
  test('не на языке встречи', () => {
    expect(ok('Release schedule for mobile app', 'ru')).toBe('×wrong-language');
    expect(ok('Сроки релиза мобильного приложения', 'en')).toBe('×wrong-language');
    // английские термины внутри русского названия допустимы
    expect(ok('Релиз Figma API для клиентов')).toBe('Релиз Figma API для клиентов');
  });
});

describe('кому положено название', () => {
  const base = { title: 'Meeting 16_11_26_15_02_11', durationSec: 29 * 60, words: 1953 };
  test('встреча от минуты с текстом и названием по умолчанию', () => {
    expect(ineligibleReason(base)).toBeNull();
    expect(ineligibleReason({ ...base, durationSec: 60 })).toBeNull();
  });
  test('меньше минуты', () => {
    expect(ineligibleReason({ ...base, durationSec: 59 })).toBe('too-short');
    expect(ineligibleReason({ ...base, durationSec: null })).toBe('too-short');
  });
  test('без текста', () => {
    expect(ineligibleReason({ ...base, words: 5 })).toBe('no-text');
  });
  test('своё название автоматика не трогает', () => {
    expect(ineligibleReason({ ...base, title: 'Мой план' })).toBe('not-default');
  });
});
