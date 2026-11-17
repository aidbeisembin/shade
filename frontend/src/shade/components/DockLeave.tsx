// Уход карточки над капсулой записи (RecordDock): держит последний вид и уводит его с размытием.
'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/shade/lib/utils';

/** Сколько длится уход (.shade-dock-out в globals.css). */
export const LEAVE_MS = 280;

/**
 * Карточка над капсулой (подсказки про микрофон и речь, доступ к микрофону): появляется из
 * размытия, а когда show сменилось на false, ещё LEAVE_MS держит последний вид и уходит
 * с размытием (.shade-dock-out). Обёртка одна и та же, содержимое не пересоздаётся.
 */
export function DockLeave({ show, children }: { show: boolean; children: ReactNode }) {
  const last = useRef<ReactNode>(null);
  if (show) last.current = children;
  const [leaving, setLeaving] = useState(false);
  // Уход начинается в том же рендере, где show стал false (смена состояния во время рендера):
  // иначе один кадр обёртка пуста, содержимое размонтируется и уходит уже заново собранным,
  // с начальным видом (так мелькали звёзды у «Как вам Shade?» после «Спасибо»)
  const [shownBefore, setShownBefore] = useState(show);
  if (show !== shownBefore) {
    setShownBefore(show);
    setLeaving(!show);
  }
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => setLeaving(false), LEAVE_MS);
    return () => window.clearTimeout(id);
  }, [leaving]);
  if (!show && !leaving) return null;
  return (
    <div className={cn('flex w-full flex-col items-center', !show && 'shade-dock-out pointer-events-none')} aria-hidden={!show || undefined}>
      {show ? children : last.current}
    </div>
  );
}
