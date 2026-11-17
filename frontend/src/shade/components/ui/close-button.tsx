// Крестик «Закрыть» один на весь Shade: круглая кнопка 44 px на лёгкой подложке, значок X
// 14 px светло-серым (цвет подписи на 70 %). При наведении меняется только подложка, на тон
// ближе к тексту (.shade-icon-btn-glass, globals.css), значок прежний;
// bold с чуть более толстым контуром, .shade-close-glyph в globals.css;
// залитый X в Phosphor нарисован квадратом, docs/ui/foundations.md).
// Правило места: у карточек (уведомления, итог записи, карточки про микрофон) крестик справа
// по центру высоты, 20 px от правого края, как отступ карточки (CLOSE_CENTER), на одной линии с кнопкой действия:
// у карточки в одну строку зазор справа и сверху с снизу равны;
// у диалога в правом верхнем углу, 4 px сверху и справа (CLOSE_CORNER). Карточка с крестиком
// оставляет справа запас (CLOSE_RESERVE), чтобы текст и кнопки не заходили под него.
'use client';

import * as React from 'react';
import { X } from '@phosphor-icons/react';
import { cn } from '@/shade/lib/utils';

/** Значок крестика: 14 px, bold с утолщённым контуром. */
export function CloseGlyph({ className }: { className?: string }) {
  return <X weight="bold" aria-hidden className={cn('shade-close-glyph size-3.5', className)} />;
}

/** Классы круглой кнопки: для своих кнопок и для Radix Close. */
export const CLOSE_BUTTON =
  'flex size-11 shrink-0 items-center justify-center shade-icon-btn-glass rounded-full text-[hsl(var(--muted-foreground)/var(--close-glyph-alpha))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

/** Место крестика у диалога: правый верхний угол, 4 px сверху и справа (у родителя position: relative). */
export const CLOSE_CORNER = 'absolute right-1 top-1 z-10';

/** Место крестика у карточки: справа по центру высоты, 20 px от края (= p-5 карточки, зазор справа равен зазору сверху и снизу; у родителя position: relative). */
export const CLOSE_CENTER = 'absolute right-5 top-1/2 z-10 -translate-y-1/2';

/**
 * Запас справа у карточки с крестиком: 20 + 44 + 8 = 72 px от края, текст и действия
 * кончаются на 8 px левее кнопки.
 */
export const CLOSE_RESERVE = 'pr-[72px]';

/** Круглый крестик карточки: справа по центру высоты (CLOSE_CENTER). */
export const CloseButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  ({ className, label, ...props }, ref) => (
    <button ref={ref} type="button" aria-label={label} className={cn(CLOSE_BUTTON, CLOSE_CENTER, className)} {...props}>
      <CloseGlyph />
    </button>
  ),
);
CloseButton.displayName = 'CloseButton';
