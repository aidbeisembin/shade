// Микрофон недоступен: карточка в доке сразу, без нажатия на запись (docs/ui/notifications.md).
// passiveMicProblem решает по тому, что известно без вопроса macOS: входы ядра и запомненный отказ.
import { describe, expect, test } from 'bun:test';
import { passiveMicProblem } from './mic-access';

describe('passiveMicProblem', () => {
  test('входов нет: «Микрофон не найден», даже если доступ разрешён', () => {
    expect(passiveMicProblem('granted', 0)).toBe('no-microphone');
    expect(passiveMicProblem(null, 0)).toBe('no-microphone');
    expect(passiveMicProblem('denied', 0)).toBe('no-microphone');
  });
  test('отказ уже известен, микрофон есть: «Нет доступа к микрофону»', () => {
    expect(passiveMicProblem('denied', 2)).toBe('mic-denied');
  });
  test('ядро не ответило про входы: решаем только по запомненному отказу', () => {
    expect(passiveMicProblem('denied', null)).toBe('mic-denied');
    expect(passiveMicProblem(null, null)).toBeNull();
  });
  test('доступ не известен или разрешён, входы есть: карточки нет (о статусе macOS без вопроса не узнать)', () => {
    expect(passiveMicProblem(null, 1)).toBeNull();
    expect(passiveMicProblem('granted', 1)).toBeNull();
  });
});
