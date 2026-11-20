// Показ окна Tauri при запуске. Окно создаётся скрытым ("visible": false в
// tauri.conf.json): иначе первые мгновения, пока WebView ждёт страницу, видно
// пустое окно ядра. Скрипт в <head> ставит окну чёрный фон заставки (LAUNCH_BACKGROUND:
// заставка чёрная в обеих темах), а показывает его скрипт в начале <body>, сразу после
// разметки заставки (LaunchScreen): окно появляется уже с логотипом на чёрном. Цвет
// темы окну потом ставит syncWindowTheme (window-theme.ts), под заставкой его не видно. Страховки: повтор через SHOW_FALLBACK_MS и вызов из
// эффекта layout (showWindow), если встроенный скрипт не сработал.
// Права: core:window:allow-show и core:window:allow-set-background-color.
// Аргументы команд как в @tauri-apps/api 2.11 (show с label, фон с color).
// В браузере (и на заглушках ?mock=) окна нет, скрипты ничего не делают.
'use client';

const SHOW_FALLBACK_MS = 3000;

/** Фон заставки и окна на запуске: чёрный в обеих темах. */
export const LAUNCH_BACKGROUND = '#000000';

/** Для <head>, после themeScript: чёрный фон окна и функция показа. */
export const windowBootScript = `
(function() {
  var w = window, T = w.__TAURI_INTERNALS__;
  if (!T || !T.invoke || /[?&]mock=/.test(location.search)) return;
  var shown = false;
  w.__shadeShowWindow = function() {
    if (shown) return;
    shown = true;
    T.invoke('plugin:window|show', { label: 'main' }).catch(function(e) { console.warn('[shade] Window did not show:', e); });
  };
  try {
    T.invoke('plugin:window|set_background_color', { color: '${LAUNCH_BACKGROUND}' }).catch(function() {});
  } catch (e) {}
  setTimeout(function() { w.__shadeShowWindow(); }, ${SHOW_FALLBACK_MS});
})();
`;

/** Для начала <body>, после заставки: показать окно. */
export const windowShowScript = `window.__shadeShowWindow && window.__shadeShowWindow();`;

/** Страховка из эффекта layout: показать окно через API Tauri. */
export async function showWindow() {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; __SHADE_MOCK__?: unknown; __shadeShowWindow?: () => void };
  if (!w.__TAURI_INTERNALS__ || w.__SHADE_MOCK__) return;
  if (w.__shadeShowWindow) {
    w.__shadeShowWindow();
    return;
  }
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().show();
  } catch (error) {
    console.warn('[shade] Не удалось показать окно:', error);
  }
}
