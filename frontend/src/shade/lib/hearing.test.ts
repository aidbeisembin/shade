// Таблица случаев «Слышу речь» (lib/hearing.ts). bun test src/shade (pnpm test).
import { describe, expect, test } from 'bun:test';
import { HOLD_MS, isHearing } from './hearing';

describe('isHearing', () => {
  const cases: Array<[string, { lastVoiceAt: number | null; lastTextAt: number | null; now: number }, boolean]> = [
    ['голоса не было: ждём речь', { lastVoiceAt: null, lastTextAt: null, now: 10_000 }, false],
    ['говорят, текста ещё нет: слышу', { lastVoiceAt: 9_900, lastTextAt: null, now: 10_000 }, true],
    ['говорят без пауз 15 с: всё время слышу', { lastVoiceAt: 15_000, lastTextAt: null, now: 15_030 }, true],
    ['пауза короче HOLD_MS: не мигает', { lastVoiceAt: 10_000, lastTextAt: null, now: 10_000 + HOLD_MS - 1 }, true],
    ['голос был, текст не пришёл (шум): гаснет через HOLD_MS', { lastVoiceAt: 10_000, lastTextAt: null, now: 10_000 + HOLD_MS }, false],
    ['текст пришёл после голоса: не слышу', { lastVoiceAt: 10_000, lastTextAt: 10_800, now: 11_000 }, false],
    ['после реплики снова говорят: слышу', { lastVoiceAt: 11_200, lastTextAt: 10_800, now: 11_300 }, true],
    ['голос в тот же миг, что реплика: относится к ней', { lastVoiceAt: 10_800, lastTextAt: 10_800, now: 10_900 }, false],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => expect(isHearing(input)).toBe(expected));
  }
});
