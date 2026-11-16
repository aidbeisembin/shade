// «<unk>» не показывается в тексте встречи: старые реплики чистятся при показе.
import { describe, expect, test } from 'bun:test';
import { stripSpecialTokens } from './speech';

describe('служебные метки в тексте реплики', () => {
  test('в начале, в середине и в конце слова', () => {
    expect(stripSpecialTokens('<unk>ешь это')).toBe('ешь это');
    expect(stripSpecialTokens('Вс<unk>ё готово')).toBe('Всё готово');
    expect(stripSpecialTokens('Вс<unk>')).toBe('Вс');
  });
  test('отдельным словом и перед знаком препинания', () => {
    expect(stripSpecialTokens('давай <unk> сделаем')).toBe('давай сделаем');
    expect(stripSpecialTokens('слово <UNK>, дальше')).toBe('слово, дальше');
    expect(stripSpecialTokens('<unk>')).toBe('');
  });
  test('другие служебные метки; текст без меток не меняется', () => {
    expect(stripSpecialTokens('<s>привет</s>')).toBe('привет');
    expect(stripSpecialTokens('Сравнить a < b и b > c')).toBe('Сравнить a < b и b > c');
  });
});
