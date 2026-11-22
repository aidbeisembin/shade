// Вызовы toast.* оригинала и Shade превращаются в карточку угла одного вида (ui/notice.tsx).
import { describe, expect, test } from 'bun:test';
import { toastView } from './toasts';
import { resultTimeout } from './notice-timing';

describe('toastView', () => {
  test('успех: галочка, status, крестик есть', () => {
    const v = toastView('success', 'Готово', { description: 'Подробности' });
    expect([v.icon, v.role, v.tone, v.closable, v.title, v.hint]).toEqual(['done', 'status', 'neutral', true, 'Готово', 'Подробности']);
  });
  test('ошибка: треугольник, alert, тон ошибки, полный текст в подсказке', () => {
    const v = toastView('error', 'Не получилось', { description: 'очень длинная причина из ядра' });
    expect([v.icon, v.role, v.tone, v.hintTitle]).toEqual(['problem', 'alert', 'error', 'очень длинная причина из ядра']);
  });
  test('сведения и предупреждение: «i» и треугольник; ожидание: крутилка без крестика', () => {
    expect(toastView('info', 'a').icon).toBe('info');
    expect(toastView('message', 'a').icon).toBe('info');
    expect(toastView('warning', 'a').icon).toBe('problem');
    const wait = toastView('loading', 'a');
    expect([wait.icon, wait.closable]).toEqual(['progress', false]);
  });
  test('действие сохраняется и ведёт к сроку 6 с; «View Meeting» повторяет переход и убирается', () => {
    let clicked = 0;
    const v = toastView('success', 'a', { action: { label: 'Open', onClick: () => void clicked++ } });
    expect(v.action).toBeDefined();
    v.action?.onClick();
    expect(clicked).toBe(1);
    expect(resultTimeout(Boolean(v.action))).toBe(6000);
    expect(toastView('success', 'a', { action: { label: 'View Meeting', onClick: () => undefined } }).action).toBeUndefined();
  });
});
