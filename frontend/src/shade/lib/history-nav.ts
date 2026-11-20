// «Назад» и «Вперёд» по истории окна: боковые кнопки мыши и ⌘[ / ⌘].
//
// Встречи и настройки открываются на главной через history.pushState (open-meeting.ts,
// in-place-router.tsx), так что history.back() и forward() возвращают на прошлый экран.
// Само окно Tauri (WKWebView) этого не делает: кнопки мыши 4 и 5 оно не переводит в
// переход, а жест «смахнуть назад» из Logi Options+ (OSX_GESTURE_BACK) пропускает, пока
// у окна выключены жесты навигации (включаются только в src-tauri). Поэтому здесь:
// - кнопки мыши 4 и 5 (MouseEvent.button 3 и 4): назад и вперёд;
// - ⌘[ и ⌘] (на Windows и Linux Ctrl), по коду клавиши, в любой раскладке;
// - клавиши BrowserBack и BrowserForward.
// Мышь MX Master в Logi Options+ шлёт жест, поэтому для Shade на её боковые кнопки
// назначаются ⌘[ и ⌘] (docs/ui/frame.md, «Переходы между экранами»).
'use client';

export type HistoryStep = 'back' | 'forward';

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat'>;

/** Кнопка мыши → шаг истории: 3 (четвёртая, «назад») и 4 (пятая, «вперёд»). */
export function mouseStep(button: number): HistoryStep | null {
  if (button === 3) return 'back';
  if (button === 4) return 'forward';
  return null;
}

/** Клавиши → шаг истории. Повтор при удержании не считается. */
export function keyStep(e: KeyLike): HistoryStep | null {
  if (e.repeat) return null;
  if (e.key === 'BrowserBack') return 'back';
  if (e.key === 'BrowserForward') return 'forward';
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return null;
  if (e.code === 'BracketLeft') return 'back';
  if (e.code === 'BracketRight') return 'forward';
  return null;
}

/** Фокус в поле ввода или редакторе заметок: там ⌘[ и ⌘] не перехватываем. */
export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable === true || Boolean(el.closest?.('[contenteditable="true"]'));
}

function go(step: HistoryStep) {
  if (step === 'back') window.history.back();
  else window.history.forward();
}

let installed = false;

/** Один раз на окно: слушатели мыши и клавиш на window в фазе захвата. */
export function installHistoryNav() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Кнопки 4 и 5: переход по mouseup, а mousedown и auxclick гасим, чтобы окно
  // не сделало с ними ничего своего (выделение, второй переход)
  const swallow = (e: MouseEvent) => {
    if (mouseStep(e.button)) e.preventDefault();
  };
  window.addEventListener('mousedown', swallow, true);
  window.addEventListener('auxclick', swallow, true);
  window.addEventListener(
    'mouseup',
    (e) => {
      const step = mouseStep(e.button);
      if (!step) return;
      e.preventDefault();
      go(step);
    },
    true,
  );

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented) return;
      const step = keyStep(e);
      if (!step) return;
      const isBrowserKey = e.key === 'BrowserBack' || e.key === 'BrowserForward';
      if (!isBrowserKey && isEditable(document.activeElement)) return;
      e.preventDefault();
      go(step);
    },
    true,
  );
}
