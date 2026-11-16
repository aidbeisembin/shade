// Тексты для названия встречи, которые не интерфейс: запрос к модели на языке встречи и образцы,
// по которым ответ отбраковывается. Язык здесь определяется языком РАЗГОВОРА, а не языком
// интерфейса, поэтому в словарь strings.ts (он по языку интерфейса) это не кладётся.
// Логика (сборка запроса, чистка ответа, решения) в meeting-title.ts, без кириллицы.
// Исключение для стража языка: scripts/check-i18n.mjs, docs/case/decisions.md.

export type TitleLang = 'ru' | 'en';

/** Сколько слов в названии: от MIN до MAX. */
export const MIN_TITLE_WORDS_IN_NAME = 2;
export const MAX_TITLE_WORDS_IN_NAME = 6;

export interface TitlePromptText {
  system: string;
  /** Начало запроса до расшифровки: требования к названию. */
  rules: string[];
  /** Подпись перед расшифровкой и после неё. */
  transcriptLabel: string;
  answerLabel: string;
}

export const PROMPTS: Record<TitleLang, TitlePromptText> = {
  ru: {
    system: 'Ты придумываешь короткие названия для записей рабочих разговоров. Отвечаешь только названием, одной строкой, без пояснений.',
    rules: [
      'Придумай название встречи по фрагментам расшифровки ниже.',
      'Требования:',
      '- от 2 до 6 слов, по-русски;',
      '- назови тему или предмет разговора, а не жанр: не «Обсуждение», не «Встреча по вопросам», не «Рабочий разговор»;',
      '- без кавычек, без точки в конце, с заглавной буквы;',
      '- не называй людей по именам и не пиши суммы и цифры денег;',
      '- ответ: только название, одной строкой.',
      'Образец формы (не копируй): Сроки релиза мобильной версии.',
    ],
    transcriptLabel: 'Расшифровка (фрагменты):',
    answerLabel: 'Название:',
  },
  en: {
    system: 'You write short titles for recordings of work conversations. Reply with the title only, one line, no explanations.',
    rules: [
      'Write a title for the meeting from the transcript excerpts below.',
      'Requirements:',
      '- 2 to 6 words, in English;',
      '- name the topic or subject of the conversation, not the genre: not "Discussion", not "Meeting about questions", not "Work chat";',
      '- no quotation marks, no full stop at the end, start with a capital letter;',
      '- do not use people\'s names and do not write sums or amounts of money;',
      '- reply with the title only, one line.',
      'Example of the form (do not copy it): Mobile release schedule.',
    ],
    transcriptLabel: 'Transcript (excerpts):',
    answerLabel: 'Title:',
  },
};

// --- название по умолчанию --------------------------------------------------

const RU_MONTHS = 'января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря';
const EN_MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const CLOCK = String.raw`\d{1,2}:\d{2}(?:\s?[ap]m)?`;
const DATE = String.raw`(?:\d{1,2}\s+(?:${RU_MONTHS}|${EN_MONTHS})\.?|(?:${EN_MONTHS})\.?\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}[./]\d{1,2}[./]\d{2,4})`;

/**
 * Название по умолчанию: «Meeting 16_11_26_15_02_11» (его даёт запись), «Встреча 16 ноября, 15:02»,
 * «Meeting on November 16, 3:02 PM», «Встреча 16.11.2026». Своё название человека с этим не
 * совпадёт: после слова «Встреча» или «Meeting» допустима только дата и время.
 */
export const DEFAULT_TITLE_RE = new RegExp(
  String.raw`^(?:meeting[ _]\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}|(?:встреча|meeting)(?:\s+(?:от|on|of))?\s+${DATE}(?:,?\s+\d{4})?(?:,?\s+(?:в\s+|at\s+)?${CLOCK})?)$`,
  'iu',
);

// --- общее название ----------------------------------------------------------

/** Слова общих названий и служебные слова: название, где все слова отсюда, ничего не говорит. */
export const GENERIC_STEMS: Record<TitleLang, string[]> = {
  ru: [
    'встреч', 'обсужден', 'обсужда', 'вопрос', 'разговор', 'бесед', 'совещан', 'рабоч', 'общ', 'разн', 'запис', 'звон',
    'созвон', 'митинг', 'планерк', 'диалог', 'текущ', 'различн', 'основн', 'ключев', 'итог', 'заметк', 'переговор',
  ],
  en: [
    'meeting', 'discuss', 'convers', 'call', 'chat', 'sync', 'general', 'various', 'topic', 'issue', 'question', 'matter',
    'regular', 'weekly', 'daily', 'team', 'work', 'record', 'talk', 'notes', 'summary',
  ],
};

/** Предлоги и союзы: сами по себе названием не являются и в конце названия не остаются. */
export const FUNCTION_WORDS: Record<TitleLang, string[]> = {
  ru: ['и', 'а', 'но', 'по', 'на', 'в', 'во', 'с', 'со', 'к', 'ко', 'о', 'об', 'от', 'из', 'за', 'у', 'для', 'про', 'над', 'при', 'или', 'как', 'что', 'это', 'не', 'тема', 'темы', 'теме', 'тему', 'темам'],
  en: ['and', 'or', 'the', 'a', 'an', 'of', 'on', 'in', 'for', 'to', 'with', 'about', 'by', 'at', 'from', 'as', 'is'],
};

/** Ответ «не могу» вместо названия. */
export const REFUSAL_RE =
  /^(?:извините|прошу прощения|к сожалению|не могу|я не могу|как (?:ии|языковая)|i['’]?m sorry|i am sorry|sorry|i cannot|i can['’]?t|as an ai|unable to)/iu;

/** Метка перед названием: «Название: …», «Title: …». */
export const LABEL_RE = /^(?:название|заголовок|тема|title|topic|subject)\s*[:\-–—]\s*/iu;

/** Сумма денег: цифры рядом со знаком валюты или словом. Такое название отбраковывается. */
export const MONEY_RE =
  /(?:\d[\d\s.,]*\s?(?:₽|\$|€|£|руб|р\.|тыс|млн|млрд|usd|eur|rub|dollar|euro|k\b)|(?:₽|\$|€|£)\s?\d)/iu;
