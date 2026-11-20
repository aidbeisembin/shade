// Название встречи, которое придумывает автоматика (title-service.ts): пока модель думает,
// дата переливается (.shade-shimmer, globals.css); когда название записано, оно проявляется
// перебором букв (как DecryptedText из React Bits, логика без пакета: lib/title-reveal.ts).
//
// Всё в DOM, без холста: шрифт, цвет, многоточие и перенос те же, что у обычного текста.
// Диктор читает итоговое название (sr-only) с самого начала, перебор помечен aria-hidden.
// Одно проявление за раз; requestAnimationFrame, при размонтировании всё снимается.
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isTitlePending, onTitlePending, onTitleSet, setTitlePending } from '@/shade/lib/title-service';
import { REVEAL_MS, decideReveal, scrambleFrame, type Armed, type ScrambleChar } from '@/shade/lib/title-reveal';
import { cn } from '@/shade/lib/utils';

const DEV = process.env.NODE_ENV !== 'production';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Текущее проявление: новое гасит прежнее (одно за раз). */
let active: (() => void) | null = null;

// --- перезапуск для разработки ------------------------------------------------------------

interface Mounted {
  id: string;
  el: () => HTMLElement | null;
  play: () => void;
}

const mounted = new Set<Mounted>();

declare global {
  interface Window {
    /** Только в разработке: перелив 2 с и проявление у названия встречи id или верхнего видимого. */
    shadeRevealTitle?: (id?: string, pendingMs?: number) => boolean;
  }
}

/** Верхнее видимое название (или названия встречи id): перелив, как будто модель думает, потом проявление. */
function replay(id?: string, pendingMs = 2000): boolean {
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
  // ⌥⇧R: перелив и проявление у верхнего видимого названия
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyR') {
      e.preventDefault();
      replay();
    }
  });
}

// --- хук и компонент ----------------------------------------------------------------------

export interface TitleRevealState<T extends HTMLElement> {
  /** Повесить на элемент с названием (нужен только для перезапуска в разработке). */
  ref: React.RefObject<T>;
  /** Что положить внутрь элемента вместо текста. */
  content: ReactNode;
  /** Модель придумывает название: элементу класс перелива. */
  pending: boolean;
}

/** Название встречи id: перелив, пока модель думает, и проявление перебором букв, когда придумала. */
export function useTitleReveal<T extends HTMLElement>(id: string, text: string): TitleRevealState<T> {
  const ref = useRef<T>(null);
  const armed = useRef<Armed | null>(null);
  const prev = useRef(text);
  const textRef = useRef(text);
  textRef.current = text;
  const [run, setRun] = useState(0);
  const [frame, setFrame] = useState<ScrambleChar[] | null>(null);
  const [pending, setPending] = useState(() => isTitlePending(id));

  // Событие приходит раньше перерисовки с новым названием: запоминаем, какое название ждать
  useEffect(() => onTitleSet((eventId, title) => eventId === id && (armed.current = { title, at: Date.now() })), [id]);
  useEffect(() => {
    setPending(isTitlePending(id));
    return onTitlePending((eventId, on) => eventId === id && setPending(on));
  }, [id]);

  // До отрисовки окна: текст сменился на придуманный, значит, сразу перебор, без кадра с итоговым текстом
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
    if (!run) {
      setFrame(null);
      return;
    }
    const target = textRef.current;
    const seed = (Math.random() * 1e9) | 0;
    let raf = 0;
    let stopped = false;
    let last = '';
    const show = (elapsed: number) => {
      const f = scrambleFrame(target, elapsed, seed);
      const key = f.chars.map((c) => c.ch).join('');
      // перерисовка только когда буквы сменились (раз в SCRAMBLE_TICK_MS), а не каждый кадр
      if (key !== last) {
        last = key;
        setFrame(f.chars);
      }
      return f.done;
    };
    const cancel = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      if (active === end) active = null;
    };
    const end = () => {
      const was = stopped;
      cancel();
      if (!was) setRun(0);
    };
    active?.();
    active = end;
    const start = performance.now();
    show(0);
    const tick = (now: number) => {
      if (stopped) return;
      if (show(now - start) || now - start > REVEAL_MS * 4) end();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return cancel;
  }, [run]);

  const play = useCallback(() => setRun((n) => n + 1), []);
  useEffect(() => {
    if (!DEV) return;
    const entry: Mounted = { id, el: () => ref.current, play };
    mounted.add(entry);
    return () => void mounted.delete(entry);
  }, [id, play]);

  const content: ReactNode = frame ? (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {frame.map((c, i) => (c.settled ? c.ch : <span key={i} className="text-muted-foreground">{c.ch}</span>))}
      </span>
    </>
  ) : (
    text
  );
  return { ref, content, pending: pending && !frame };
}

interface TitleRevealTextProps {
  /** Встреча, чьё название показано. */
  id: string;
  text: string;
  className?: string;
  /** Подсказка при наведении (полное название при многоточии). */
  title?: string;
}

/** Строка с названием встречи: обычный span с переливом и проявлением (useTitleReveal). */
export function TitleRevealText({ id, text, className, title }: TitleRevealTextProps) {
  const { ref, content, pending } = useTitleReveal<HTMLSpanElement>(id, text);
  return (
    <span ref={ref} className={cn(className, pending && 'shade-shimmer')} title={title} aria-busy={pending || undefined}>
      {content}
    </span>
  );
}
