// Название встречи, которое придумывает автоматика (title-service.ts), как пиксельная «генерация».
// После «Остановить» и пока модель думает: вместо названия и даты мерцает полоса пикселей с бегущей
// волной (строка обработки, строка встречи, шапка; карточка у кнопки записи показывает дату). Придумала: поверх
// настоящего названия пиксели мельчают (4 → 2 → 1 px) и рассыпаются в случайном порядке, текст
// проступает. Логика и время: lib/title-reveal.ts.
//
// Холст рисует только пиксели, буквы всегда обычный DOM-текст: шрифт, многоточие и выделение
// как у остального текста. Цвет пикселей из computed color элемента (тема). Холст в физических
// пикселях (devicePixelRatio), без ctx.filter (WKWebView). Диктор слышит «Придумываю название»,
// затем само название; холсты aria-hidden. Одно проявление за раз; requestAnimationFrame,
// при размонтировании всё снимается.
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isTitlePending, onTitlePending, onTitleSet, setTitlePending } from '@/shade/lib/title-service';
import { PIXEL, cellAlive, decideReveal, loadingAlpha, revealFrame, type Armed } from '@/shade/lib/title-reveal';
import { cn } from '@/shade/lib/utils';
import { t } from '@/shade/strings';
import { useLang } from '@/shade/lib/lang';

const DEV = process.env.NODE_ENV !== 'production';
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
/** Высота полосы пикселей в долях кегля: примерно высота строчных и прописных букв. */
const BAND_EM = 0.85;

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

/** Холст под размер в CSS px и devicePixelRatio; контекст с цветом текста. */
function prepare(canvas: HTMLCanvasElement, w: number, h: number, color: string) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = color;
  }
  return ctx;
}

/**
 * Текущее проявление: одна встреча за раз. Новое у другой встречи гасит прежние; у той же
 * (одно название в нескольких местах) играют вместе.
 */
let active: { id: string; ends: Set<() => void> } | null = null;

// --- перезапуск для разработки ------------------------------------------------------------

interface Mounted {
  id: string;
  el: () => HTMLElement | null;
  play: () => void;
}

const mounted = new Set<Mounted>();

declare global {
  interface Window {
    /** Только в разработке: «генерация» (мс) и проявление у названия встречи id или верхнего видимого. */
    shadeRevealTitle?: (id?: string, pendingMs?: number) => boolean;
  }
}

function replay(id?: string, pendingMs = 2500): boolean {
  const seen = [...mounted]
    .filter((x) => !id || x.id === id)
    .map((x) => ({ x, rect: x.el()?.getBoundingClientRect() }))
    .filter((v) => v.rect && v.rect.bottom > 0 && v.rect.top < window.innerHeight)
    .sort((a, b) => a.rect!.top - b.rect!.top);
  const target = seen[0]?.x;
  if (!target) return false;
  if (pendingMs > 0) setTitlePending(target.id, true);
  window.setTimeout(() => {
    if (pendingMs > 0) setTitlePending(target.id, false);
    if (prefersReducedMotion()) console.info('[shade] Проявление названия: включено «уменьшить движение», анимации нет');
    else target.play();
  }, pendingMs);
  return true;
}

if (DEV && typeof window !== 'undefined' && !window.shadeRevealTitle) {
  window.shadeRevealTitle = replay;
  // ⌥⇧R: «генерация» и проявление у верхнего видимого названия
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyR') {
      e.preventDefault();
      replay();
    }
  });
}

// --- ожидание: полоса пикселей -------------------------------------------------------------

/** Мерцающая полоса пикселей на месте названия, пока модель думает. Ширина как у среднего названия. */
function GeneratingPixels() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const ctx = prepare(canvas, w, h, getComputedStyle(canvas).color);
    if (!ctx) return;
    const cols = Math.max(1, Math.floor(w / PIXEL));
    const rows = Math.max(1, Math.floor(h / PIXEL));
    const top = (h - rows * PIXEL) / 2;
    const seed = (Math.random() * 1e9) | 0;
    const draw = (elapsed: number) => {
      ctx.clearRect(0, 0, w, h);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.globalAlpha = loadingAlpha(c, r, cols, elapsed, seed);
          ctx.fillRect(c * PIXEL, top + r * PIXEL, PIXEL - 1, PIXEL - 1);
        }
      }
      ctx.globalAlpha = 1;
    };
    draw(0);
    // «Уменьшить движение»: полоса стоит
    if (prefersReducedMotion()) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      draw(now - start);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span aria-hidden="true" className="relative inline-block max-w-full align-middle" style={{ width: '11em', height: `${BAND_EM}em` }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </span>
  );
}

/** Название ещё придумывается: диктору «Придумываю название», глазу полоса пикселей. */
export function TitlePixels() {
  useLang();
  return (
    <>
      <span className="sr-only">{t('titleGenerating')}</span>
      <GeneratingPixels />
    </>
  );
}

// --- хук и компонент ----------------------------------------------------------------------

export interface TitleRevealState<T extends HTMLElement> {
  /** Повесить на элемент с названием; ему нужен position: relative (на нём лежит холст проявления). */
  ref: React.RefObject<T>;
  /** Что положить внутрь элемента вместо текста. */
  content: ReactNode;
  /** Модель придумывает название (показана полоса пикселей). */
  pending: boolean;
}

/** Название встречи id: полоса пикселей, пока модель думает, и пиксельное проявление, когда придумала. */
export function useTitleReveal<T extends HTMLElement>(id: string, text: string): TitleRevealState<T> {
  useLang();
  const ref = useRef<T>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const armed = useRef<Armed | null>(null);
  const prev = useRef(text);
  const textRef = useRef(text);
  textRef.current = text;
  const [run, setRun] = useState(0);
  const [pending, setPending] = useState(() => isTitlePending(id));

  // Событие приходит раньше перерисовки с новым названием: запоминаем, какое название ждать.
  // Название пришло: полоса уходит сразу, даже если путь после «Остановить» ещё держит ожидание
  useEffect(
    () =>
      onTitleSet((eventId, title) => {
        if (eventId !== id) return;
        armed.current = { title, at: Date.now() };
        setPending(false);
      }),
    [id],
  );
  // До отрисовки: ожидание могли взять в том же кадре, где строка появилась (recording-outcome.tsx)
  useIsoLayoutEffect(() => {
    setPending(isTitlePending(id));
    return onTitlePending((eventId, on) => eventId === id && setPending(on));
  }, [id]);

  // До отрисовки окна: текст сменился на придуманный, значит, сразу пиксели, без кадра с чистым текстом
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
    const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    if (!node) {
      setRun(0);
      return;
    }
    // Где текст на самом деле: по DOM. Полоса пикселей ложится на строку текста
    const range = document.createRange();
    range.selectNodeContents(node);
    const rr = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 16;
    // У строчного элемента (шапка встречи) clientWidth = 0: тогда только ширина текста; у блочного с многоточием не шире блока
    const w = Math.ceil(el.clientWidth ? Math.min(rr.width, el.clientWidth) : rr.width);
    const h = Math.ceil(fontSize * BAND_EM);
    const left = rr.left - box.left - el.clientLeft;
    const top = rr.top - box.top - el.clientTop + (Math.min(rr.height, fontSize * 1.6) - h) / 2;
    Object.assign(canvas.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
    const ctx = prepare(canvas, w, h, cs.color);
    if (!ctx || w <= 0) {
      setRun(0);
      return;
    }
    const [r, g, b] = rgbOf(cs.color);
    const cols = Math.max(1, Math.floor(w / PIXEL));
    const seed = (Math.random() * 1e9) | 0;
    const prevFill = el.style.getPropertyValue('-webkit-text-fill-color');
    const restore = () => {
      if (prevFill) el.style.setProperty('-webkit-text-fill-color', prevFill);
      else el.style.removeProperty('-webkit-text-fill-color');
    };

    const draw = (elapsed: number) => {
      const f = revealFrame(elapsed);
      const s = f.block;
      ctx.clearRect(0, 0, w, h);
      for (let y = 0; y < h; y += s) {
        for (let x = 0; x < w; x += s) {
          if (!cellAlive(x, y, f.gone, seed)) continue;
          // мерцание как в ожидании: «генерация» продолжается, пока пиксели не рассыпались
          ctx.globalAlpha = Math.min(1, 0.25 + loadingAlpha(Math.floor(x / PIXEL), Math.floor(y / PIXEL), cols, elapsed, seed)) * (1 - 0.6 * f.text);
          ctx.fillRect(x, y, s >= PIXEL ? s - 1 : s, s >= PIXEL ? s - 1 : s);
        }
      }
      ctx.globalAlpha = 1;
      el.style.setProperty('-webkit-text-fill-color', f.text > 0 ? `rgba(${r}, ${g}, ${b}, ${f.text.toFixed(3)})` : 'transparent');
      return f.done;
    };

    let raf = 0;
    let stopped = false;
    const cancel = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      restore();
      active?.ends.delete(end);
      if (active?.ends.size === 0) active = null;
    };
    const end = () => {
      const was = stopped;
      cancel();
      if (!was) setRun(0);
    };
    if (active && active.id !== id) [...active.ends].forEach((stop) => stop());
    if (!active) active = { id, ends: new Set() };
    active.ends.add(end);
    const start = performance.now();
    const tick = (now: number) => {
      if (stopped) return;
      if (draw(now - start)) end();
      else raf = requestAnimationFrame(tick);
    };
    draw(0);
    raf = requestAnimationFrame(tick);
    return cancel;
    // id у хука постоянный на время проигрыша; перезапуск только по run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const play = useCallback(() => setRun((n) => n + 1), []);
  useEffect(() => {
    if (!DEV) return;
    const entry: Mounted = { id, el: () => ref.current, play };
    mounted.add(entry);
    return () => void mounted.delete(entry);
  }, [id, play]);

  const showPixels = pending && !run;
  const content: ReactNode = showPixels ? (
    <TitlePixels />
  ) : (
    <>
      {text}
      {run ? <canvas key={run} ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute" /> : null}
    </>
  );
  return { ref, content, pending: showPixels };
}

interface TitleRevealTextProps {
  /** Встреча, чьё название показано. */
  id: string;
  text: string;
  className?: string;
  /** Подсказка при наведении (полное название при многоточии). */
  title?: string;
}

/** Строка с названием встречи: обычный span с пиксельной «генерацией» (useTitleReveal). */
export function TitleRevealText({ id, text, className, title }: TitleRevealTextProps) {
  const { ref, content, pending } = useTitleReveal<HTMLSpanElement>(id, text);
  return (
    <span ref={ref} className={cn('relative', className)} title={pending ? undefined : title} aria-busy={pending || undefined}>
      {content}
    </span>
  );
}
