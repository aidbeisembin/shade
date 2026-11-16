import { describe, expect, it } from 'bun:test';
import { choiceOf, defaultChoice, parseWords } from './speech-settings';

describe('язык встреч', () => {
  it('три пункта ложатся на коды оригинала', () => {
    expect(choiceOf('ru')).toBe('ru');
    expect(choiceOf('en')).toBe('en');
    expect(choiceOf('auto')).toBe('auto');
  });
  it('чужой код не подменяется', () => {
    expect(choiceOf('de')).toBeNull();
    expect(choiceOf('auto-translate')).toBeNull();
    expect(choiceOf(undefined)).toBeNull();
  });
  it('по умолчанию русскому интерфейсу достаётся русский', () => {
    expect(defaultChoice('ru', 'en')).toBe('ru');
    expect(defaultChoice('en', 'ru')).toBe('en');
    expect(defaultChoice(null, 'ru')).toBe('ru');
    expect(defaultChoice(null, 'de')).toBe('de');
    expect(defaultChoice(null, null)).toBe('ru');
  });
});

describe('частые слова', () => {
  it('делит по запятой, точке с запятой и строке, без повторов и пустых', () => {
    expect(parseWords(' Figma, github ;\n Figma, , Slack')).toEqual(['Figma', 'github', 'Slack']);
  });
  it('пусто и пробелы: пустой список', () => {
    expect(parseWords('')).toEqual([]);
    expect(parseWords(' , ; \n')).toEqual([]);
  });
  it('слишком длинное слово пропускается, список ограничен', () => {
    expect(parseWords('a'.repeat(61) + ', ok')).toEqual(['ok']);
    const many = Array.from({ length: 120 }, (_, i) => `слово${i}`).join(', ');
    expect(parseWords(many)).toHaveLength(80);
  });
  it('регистр не создаёт двойников', () => {
    expect(parseWords('Figma, figma, FIGMA')).toEqual(['Figma']);
  });
});
