// Микрофон недоступен: карточка в доке сразу, без нажатия на запись (docs/ui/notifications.md).
// passiveMicProblem решает по тому, что известно без вопроса macOS: входы ядра и запомненный отказ.
import { describe, expect, test } from 'bun:test';
import { offersSystemOnly, passiveMicProblem } from './mic-access';

describe('passiveMicProblem', () => {
  test('входов нет: «Нет микрофона», даже если доступ разрешён', () => {
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

describe('offersSystemOnly', () => {
  test('микрофона нет: «Только звук компьютера» (ядро без микрофона пишет звук компьютера)', () => {
    expect(offersSystemOnly({ kind: 'no-microphone', passive: true } as { kind: string })).toBe(true);
    expect(offersSystemOnly({ kind: 'no-microphone', systemAudio: true })).toBe(true);
  });
  test('микрофона нет и звук компьютера недоступен: кнопки нет, остаётся «Открыть настройки»', () => {
    expect(offersSystemOnly({ kind: 'no-microphone', systemAudio: false })).toBe(false);
  });
  test('микрофон есть, доступа нет: кнопки нет даже при звуке компьютера (ядро не стартует)', () => {
    expect(offersSystemOnly({ kind: 'mic-denied', systemAudio: true })).toBe(false);
    expect(offersSystemOnly({ kind: 'mic-denied', systemAudio: false })).toBe(false);
  });
});
