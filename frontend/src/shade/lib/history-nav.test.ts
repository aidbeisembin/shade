// «Назад» и «Вперёд»: какие кнопки мыши и клавиши ведут по истории (history-nav.ts).
// Запуск: bun test src/shade (pnpm test).
import { describe, expect, test } from 'bun:test';
import { isEditable, keyStep, mouseStep } from './history-nav';

const key = (o: Partial<KeyboardEvent>) =>
  ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, ...o }) as KeyboardEvent;

describe('mouseStep: кнопки мыши', () => {
  test('кнопка 4 (button 3): назад', () => expect(mouseStep(3)).toBe('back'));
  test('кнопка 5 (button 4): вперёд', () => expect(mouseStep(4)).toBe('forward'));
  test('левая, средняя, правая: ничего', () => {
    expect(mouseStep(0)).toBeNull();
    expect(mouseStep(1)).toBeNull();
    expect(mouseStep(2)).toBeNull();
  });
});

describe('keyStep: клавиши', () => {
  test('⌘[: назад', () => expect(keyStep(key({ metaKey: true, code: 'BracketLeft', key: '[' }))).toBe('back'));
  test('⌘]: вперёд', () => expect(keyStep(key({ metaKey: true, code: 'BracketRight', key: ']' }))).toBe('forward'));
  test('русская раскладка (⌘Х): тоже назад, по коду клавиши', () =>
    expect(keyStep(key({ metaKey: true, code: 'BracketLeft', key: 'х' }))).toBe('back'));
  test('Ctrl+[ (Windows, Linux): назад', () => expect(keyStep(key({ ctrlKey: true, code: 'BracketLeft' }))).toBe('back'));
  test('BrowserBack и BrowserForward без модификаторов', () => {
    expect(keyStep(key({ key: 'BrowserBack' }))).toBe('back');
    expect(keyStep(key({ key: 'BrowserForward' }))).toBe('forward');
  });
  test('[ без ⌘: ничего (обычный ввод)', () => expect(keyStep(key({ code: 'BracketLeft', key: '[' }))).toBeNull());
  test('⇧⌘[ и ⌥⌘[: ничего (чужие сочетания)', () => {
    expect(keyStep(key({ metaKey: true, shiftKey: true, code: 'BracketLeft' }))).toBeNull();
    expect(keyStep(key({ metaKey: true, altKey: true, code: 'BracketLeft' }))).toBeNull();
  });
  test('повтор при удержании: ничего', () =>
    expect(keyStep(key({ metaKey: true, code: 'BracketLeft', repeat: true }))).toBeNull());
});

describe('isEditable: где ⌘[ не перехватываем', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) =>
    ({ tagName, isContentEditable: false, closest: () => null, ...extra }) as unknown as Element;
  test('поле ввода и textarea', () => {
    expect(isEditable(el('INPUT'))).toBe(true);
    expect(isEditable(el('TEXTAREA'))).toBe(true);
  });
  test('редактор заметок (contenteditable)', () => expect(isEditable(el('DIV', { isContentEditable: true }))).toBe(true));
  test('кнопка и пустой фокус: можно переходить', () => {
    expect(isEditable(el('BUTTON'))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});
