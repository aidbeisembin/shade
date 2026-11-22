// Сроки сообщений Shade, одни для дока и угла (docs/ui/notifications.md, «Сроки»).
// Итог действия без кнопки живёт RESULT_MS, с кнопкой (Открыть, Вернуть, Проверить звук)
// RESULT_ACTION_MS: кнопку надо успеть заметить и нажать. Под указателем и в фокусе время стоит.
// Без таймера (null): «Доступна версия», восстановление после сбоя, «Как вам Shade?» и форма,
// проблемы, мешающие записи (держатся, пока проблема есть), и ожидание (крутилка).

/** Итог без действия, мс. */
export const RESULT_MS = 4000;

/** Итог с действием, мс. */
export const RESULT_ACTION_MS = 6000;

/** Срок по умолчанию: с действием дольше. */
export function resultTimeout(hasAction: boolean): number {
  return hasAction ? RESULT_ACTION_MS : RESULT_MS;
}

/**
 * Итог записи в доке по причине: «Речи не было» (Проверить звук) и «Мало содержания» (Вернуть)
 * с действием, 6 с; «Пустая запись» и «Речь не распознана» без действия, 4 с.
 */
export function outcomeTimeout(verdict: 'empty' | 'no-speech' | 'unrecognized' | 'low-content'): number {
  return resultTimeout(verdict === 'no-speech' || verdict === 'low-content');
}
