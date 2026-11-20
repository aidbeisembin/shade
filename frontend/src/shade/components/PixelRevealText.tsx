// «Пиксельное проявление» названия встречи, когда автоматика заменила дату придуманным
// названием (событие shade-title-set). Когда играть и ход времени: lib/title-reveal.ts.
//
// Как устроено: обычный DOM-текст лежит на месте всегда (его читает диктор, его можно
// выделить и скопировать), на время проявления он прозрачен, а поверх лежит canvas
// с aria-hidden. Каждый кадр текст рисуется на маленький холст (1/блок) и растягивается
// на основной без сглаживания (imageSmoothingEnabled = false), поэтому видны блоки; клетки
// открываются в случайном порядке, у блоков зерно. ctx.filter не используется: в WKWebView
// он не работает. В конце холст убирается, остаётся обычный текст. Шрифт, цвет, межстрочный
// интервал и отступы берутся из getComputedStyle элемента (цвет уже из переменных темы),
// холст в физических пикселях (devicePixelRatio). Одновременно играет одно проявление.
// Не влезает в одну строку (многоточие): сразу итоговый текст, без проявления.
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { onTitleSet } from '@/shade/lib/title-service';
import { DISSOLVE_CELL, blockSizes, cellAlpha, cellThreshold, decideReveal, revealFrame, type Armed } from '@/shade/lib/title-reveal';
import { cn } from '@/shade/lib/utils';

const DEV = process.env.NODE_ENV !== 'production';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Цвет текста в RGB: computed color может быть oklch или lab, холст переводит его сам. */
function rgbOf(color: string): [number, number, number] {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [127, 127, 127];
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/** Остановить проигрыш на месте: холст в покое, текст обычный. */
type Stop = () => void;

/** Текущее проявление: новое гасит прежнее (одно за раз). */
let active: Stop | null = null;

/**
 * Запустить проявление text в элементе el на холсте canvas. Первый кадр рисуется сразу
 * (до отрисовки окна), дальше requestAnimationFrame. Возвращает отмену без onEnd.
 * Нечем рисовать или текст не влезает в строку: onEnd сразу, текст обычный.
 */
function startReveal(el: HTMLElement, canvas: HTMLCanvasElement, text: string, onEnd: () => void): Stop {
  const small = document.createElement('canvas');
  const sctx = small.getContext('2d', { willReadFrequently: true });
  const ctx = canvas.getContext('2d');
  const cs = getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize) || 16;
  const lineHeight = cs.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(cs.lineHeight) || fontSize * 1.2;
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const spacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
  const setFont = (c: CanvasRenderingContext2D) => {
    c.font = font;
    if ('letterSpacing' in c) (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = spacing;
    c.textBaseline = 'alphabetic';
  };
  // Холст по умолчанию 300×150: до замеров он не должен раздувать прокрутку элемента
  Object.assign(canvas.style, { left: '0px', top: '0px', width: '0px', height: '0px' });
  const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
  const range = document.createRange();
  if (node) range.selectNodeContents(node);
  // Где текст на самом деле: по DOM, а не по холсту. Шрифт холста может отличаться
  // (Chromium не знает -apple-system в canvas), поэтому ширину и место берём у DOM
  const rr = range.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  // Многоточие (текст шире элемента) или перенос на вторую строку: сразу итоговый текст
  const clipped = el.scrollWidth > el.clientWidth + 1 || rr.height > lineHeight * 1.5;

  if (!ctx || !sctx || !node || rr.width <= 0 || clipped) {
    onEnd();
    return () => undefined;
  }
  setFont(sctx);
  const m = sctx.measureText(text);
  const sx = m.width > 0 ? rr.width / m.width : 1;

  const [r, g, b] = rgbOf(cs.color);
  const left = rr.left - box.left - el.clientLeft;
  const lineTop = rr.top - box.top - el.clientTop - (lineHeight - rr.height) / 2;
  // Холст по тексту с небольшим запасом, а не во всю строку: шум только вокруг слов
  const W = Math.ceil(Math.min(el.clientWidth - left, rr.width + fontSize * 0.5));
  const H = Math.ceil(lineHeight);
  const dpr = window.devicePixelRatio || 1;
  // Базовая линия как у DOM: строка делится поровну над и под ascent+descent шрифта
  const asc = m.fontBoundingBoxAscent ?? fontSize * 0.8;
  const desc = m.fontBoundingBoxDescent ?? fontSize * 0.2;
  const baseline = (lineHeight - rr.height) / 2 + (rr.height * asc) / (asc + desc);

  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  Object.assign(canvas.style, { left: `${left}px`, top: `${lineTop}px`, width: `${W}px`, height: `${H}px` });

  const sizes = blockSizes(fontSize);
  const seed = (Math.random() * 1e9) | 0;
  const prevFill = el.style.getPropertyValue('-webkit-text-fill-color');
  const restore = () => {
    if (prevFill) el.style.setProperty('-webkit-text-fill-color', prevFill);
    else el.style.removeProperty('-webkit-text-fill-color');
  };

  const draw = (elapsed: number) => {
    const f = revealFrame(elapsed, sizes);
    const s = f.block;
    const sw = Math.ceil(W / s);
    const sh = Math.ceil(H / s);
    if (small.width !== sw || small.height !== sh) {
      small.width = sw;
      small.height = sh;
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, sw, sh);
    // sx подгоняет ширину текста холста под DOM: конец проявления совпадает с обычным текстом
    sctx.setTransform(sx / s, 0, 0, 1 / s, 0, 0);
    setFont(sctx);
    sctx.fillStyle = cs.color;
    sctx.fillText(text, 0, baseline);
    const img = sctx.getImageData(0, 0, sw, sh);
    const d = img.data;
    for (let y = 0; y < sh; y++) {
      const cy = Math.floor((y * s) / DISSOLVE_CELL);
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        const open = cellAlpha(f.open, cellThreshold(Math.floor((x * s) / DISSOLVE_CELL), cy, seed));
        if (open === 0) {
          d[i + 3] = 0;
          continue;
        }
        if (d[i + 3] > 0) {
          // зерно: блок светлее или темнее, к концу ровный
          const n = 1 + (Math.random() * 2 - 1) * 0.6 * f.grain;
          d[i + 3] = Math.min(255, d[i + 3] * open * n);
        } else if (f.grain > 0 && Math.random() < 0.06 * f.grain * open) {
          // редкие блоки шума вокруг букв, пока блоки крупные
          d[i] = r;
          d[i + 1] = g;
          d[i + 2] = b;
          d[i + 3] = 70 * f.grain;
        }
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1 - f.text;
    ctx.drawImage(small, 0, 0, sw, sh, 0, 0, sw * s * dpr, sh * s * dpr);
    // Обычный текст проступает в последней фазе: от холста к нему без скачка
    el.style.setProperty('-webkit-text-fill-color', f.text > 0 ? `rgba(${r}, ${g}, ${b}, ${f.text.toFixed(3)})` : 'transparent');
    return f.done;
  };

  let raf = 0;
  let stopped = false;
  const cancel: Stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    restore();
    if (active === end) active = null;
  };
  const end: Stop = () => {
    const was = stopped;
    cancel();
    if (!was) onEnd();
  };

  active?.();
  active = end;
  const start = performance.now();
  const tick = (now: number) => {
    if (stopped) return;
    if (draw(now - start)) end();
    else raf = requestAnimationFrame(tick);
  };
  if (draw(0)) end();
  else raf = requestAnimationFrame(tick);
  return cancel;
}

// --- перезапуск для разработки ------------------------------------------------------------

interface Mounted {
  id: string;
  el: () => HTMLElement | null;
  play: () => void;
}

const mounted = new Set<Mounted>();

declare global {
  interface Window {
    /** Только в разработке: проиграть проявление названия встречи id или верхнего видимого. */
    shadeRevealTitle?: (id?: string) => boolean;
  }
}

/** Верхнее видимое название (или названия встречи id) проявляется заново. */
function replay(id?: string): boolean {
  const seen = [...mounted]
    .filter((x) => !id || x.id === id)
    .map((x) => ({ x, rect: x.el()?.getBoundingClientRect() }))
    .filter((v) => v.rect && v.rect.bottom > 0 && v.rect.top < window.innerHeight)
    .sort((a, b) => a.rect!.top - b.rect!.top);
  if (!seen[0]) return false;
  if (prefersReducedMotion()) {
    console.info('[shade] Проявление названия: включено «уменьшить движение», анимации нет');
    return false;
  }
  seen[0].x.play();
  return true;
}

if (DEV && typeof window !== 'undefined' && !window.shadeRevealTitle) {
  window.shadeRevealTitle = replay;
  // ⌥⇧R: проиграть проявление у верхнего видимого названия
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyR') {
      e.preventDefault();
      replay();
    }
  });
}

// --- хук и компонент ----------------------------------------------------------------------

/**
 * Проявление названия встречи id в своём элементе. ref повесить на элемент с текстом
 * (ему нужен position: relative), overlay положить внутрь него последним ребёнком.
 */
export function usePixelReveal<T extends HTMLElement>(id: string, text: string): { ref: RefObject<T>; overlay: ReactNode } {
  const ref = useRef<T>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const armed = useRef<Armed | null>(null);
  const prev = useRef(text);
  const textRef = useRef(text);
  textRef.current = text;
  const [run, setRun] = useState(0);

  // Событие приходит раньше перерисовки с новым названием: запоминаем, какое название ждать
  useEffect(() => onTitleSet((eventId, title) => eventId === id && (armed.current = { title, at: Date.now() })), [id]);

  // До отрисовки окна: текст сменился на придуманный, значит, сразу холст, без кадра с чётким текстом
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = text;
    if (before === text) return;
    const play = decideReveal({ armed: armed.current, prev: before, next: text, now: Date.now(), reducedMotion: prefersReducedMotion() });
    armed.current = null;
    // Текст сменился во время проявления (например, переименовали): старое гасим
    setRun((n) => (play ? n + 1 : 0));
  }, [text]);

  useLayoutEffect(() => {
    const el = ref.current;
    const canvas = canvasRef.current;
    if (!run || !el || !canvas) return;
    return startReveal(el, canvas, textRef.current, () => setRun(0));
  }, [run]);

  const play = useCallback(() => setRun((n) => n + 1), []);
  useEffect(() => {
    if (!DEV) return;
    const entry: Mounted = { id, el: () => ref.current, play };
    mounted.add(entry);
    return () => void mounted.delete(entry);
  }, [id, play]);

  const overlay = run ? <canvas key={run} ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute" /> : null;
  return { ref, overlay };
}

interface PixelRevealTextProps {
  /** Встреча, чьё название показано. */
  id: string;
  text: string;
  className?: string;
  /** Подсказка при наведении (полное название при многоточии). */
  title?: string;
}

/** Строка с названием встречи: обычный span, который проявляется, когда автоматика придумала название. */
export function PixelRevealText({ id, text, className, title }: PixelRevealTextProps) {
  const { ref, overlay } = usePixelReveal<HTMLSpanElement>(id, text);
  return (
    <span ref={ref} className={cn('relative', className)} title={title}>
      {text}
      {overlay}
    </span>
  );
}
