// Чат беты в Telegram: одна константа на приложение, README и описание релиза.
// Пустая строка: ссылка нигде не показывается.
// Кто ещё читает эту строку: scripts/release/release-notes.sh (описание релиза) и тест
// beta-chat.test.ts (README сверяется с ней). Формат строки не менять: её разбирает sed.
export const BETA_CHAT_URL = 'https://t.me/shadebeta';

/** Адрес чата, если он задан и это ссылка на Telegram; иначе null (ссылку не показывать). */
export function betaChatUrl(raw: string = BETA_CHAT_URL): string | null {
  const url = raw.trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 't.me' || u.hostname === 'telegram.me') ? u.toString() : null;
  } catch {
    return null;
  }
}
