// Звёзды оценки: клавиатура и подписи без React (тесты в feedback.test.ts).

import type { StringKey } from '@/shade/strings';

export const STARS = 5;

/** Подпись под звёздами: 0 «Нажмите на звезду», 1..5 от «Плохо» до «Очень нравится». */
export const RATING_LABELS: readonly StringKey[] = [
  'feedbackRate0',
  'feedbackRate1',
  'feedbackRate2',
  'feedbackRate3',
  'feedbackRate4',
  'feedbackRate5',
];

export type StarKeyAction = { kind: 'rate'; rating: number } | { kind: 'commit'; rating: number } | null;

/**
 * Клавиша на группе звёзд (role="radiogroup"). Стрелки вправо и вверх прибавляют, влево и вниз
 * убавляют, без перехода через край; Home и End к первой и последней. Enter и пробел подтверждают
 * оценку (выбор ветки), стрелки только меняют её. 0 значит «ещё не выбрано»: первая стрелка вперёд
 * встаёт на 1.
 */
export function starKey(key: string, current: number): StarKeyAction {
  const cur = Math.max(0, Math.min(STARS, current));
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return { kind: 'rate', rating: Math.min(STARS, cur + 1) };
    case 'ArrowLeft':
    case 'ArrowDown':
      return { kind: 'rate', rating: Math.max(1, cur - 1) };
    case 'Home':
      return { kind: 'rate', rating: 1 };
    case 'End':
      return { kind: 'rate', rating: STARS };
    case 'Enter':
    case ' ':
      return cur > 0 ? { kind: 'commit', rating: cur } : null;
    default:
      return null;
  }
}
