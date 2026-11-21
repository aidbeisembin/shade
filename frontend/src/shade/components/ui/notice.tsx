// Одно устройство сообщения на весь Shade (docs/ui/notifications.md, «Устройство карточки»):
// карточки дока (итог записи, проблемы микрофона, подсказки над капсулой) и угла (CornerStack)
// рисует только Notice. Одна строка:
//   [круг 40 px со значком] [заголовок / подпись в одну строку] [действия] [крестик 40 px]
// Плотное стекло, радиус плитки, внутри 16 px. Значок по смыслу (NoticeGlyph): готово - галочка,
// сведения - «i», проблема - треугольник, в процессе - крутилка, восстановление - часы,
// обновление - стрелка вверх. Подпись одна строка: длину держит текст (strings.test.ts),
// длинная ошибка ядра обрезается многоточием, целиком в подсказке. Действие - серая капсула
// (NOTICE_SECONDARY): лайм только у кнопки записи и «Отправить» в форме отзыва.
// Ошибки role="alert", остальное role="status"; фокус карточка не забирает.
'use client';

import * as React from 'react';
import { ArrowFatUp, CheckFat, ClockCounterClockwise, Warning } from '@phosphor-icons/react';
import { CloseButton } from '@/shade/components/ui/close-button';
import { Spinner } from '@/shade/components/ui/spinner';
import { Button } from '@/shade/components/ui/button';
import { InfoFatIcon } from '@/shade/components/InfoFatIcon';
import type { NoticeAction, NoticeIconKind } from '@/shade/lib/corner';
import { cn } from '@/shade/lib/utils';

/** Высота круга, кнопки действия и крестика: одна линия, 40 px. */
export const NOTICE_ACTION = 'h-10';

/** Вторичная кнопка-капсула: та же подложка, что у круга знака и крестика (--glass-btn), видна на стекле в обеих темах. */
export const NOTICE_SECONDARY = `${NOTICE_ACTION} rounded-full px-4 text-sm font-medium bg-[hsl(var(--foreground)/var(--glass-btn))] hover:bg-[hsl(var(--foreground)/var(--glass-btn-hover))]`;

/** Заголовок: 17 px полужирный, одна строка. */
export const NOTICE_TITLE = 'truncate text-[17px] font-semibold leading-6';

/** Подпись: 14 px, одна строка, многоточие только у текста ошибки ядра. */
export const NOTICE_HINT = 'truncate text-sm leading-5 text-muted-foreground';

/** Внутренний отступ карточки (одинаковый в доке и углу). */
export const NOTICE_PAD = 'p-4';

export type NoticeTone = 'neutral' | 'ok' | 'error';

// Подложка знака та же, что у крестика (тон текста на --glass-btn), чтобы круги слева и справа были одним тоном.
const MARK_BG = 'bg-[hsl(var(--foreground)/var(--glass-btn))]';

const MARK_TONE: Record<NoticeTone, string> = {
  neutral: `${MARK_BG} text-foreground`,
  // «Отзыв отправлен»: зелёная галочка на своей подложке 14 % (feedback.md), не лаймом
  ok: 'bg-[hsl(var(--ok)/0.14)] text-[hsl(var(--ok))]',
  error: `${MARK_BG} text-destructive-ink`,
};

/** Значок по смыслу. Все Phosphor в заливке, «i» свой (InfoFatIcon), ожидание - Spinner. */
export function NoticeGlyph({ kind }: { kind: NoticeIconKind }) {
  switch (kind) {
    case 'done':
      return <CheckFat weight="fill" />;
    case 'info':
      return <InfoFatIcon />;
    case 'problem':
      return <Warning weight="fill" />;
    case 'progress':
      return <Spinner />;
    case 'recovery':
      return <ClockCounterClockwise weight="fill" />;
    case 'update':
      return <ArrowFatUp weight="fill" />;
  }
}

/** Круг знака 40 px, значок 20 px. */
export function NoticeMark({ tone = 'neutral', children, className }: { tone?: NoticeTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5', MARK_TONE[tone], className)} aria-hidden>
      {children}
    </span>
  );
}

/** Подложка: плотное стекло, радиус плитки, 16 px внутри. */
export const NoticeSurface = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('shade-glass shade-glass-dense relative rounded-tile', NOTICE_PAD, className)} {...props} />
));
NoticeSurface.displayName = 'NoticeSurface';

/** Серая кнопка-капсула действия. */
export function NoticeButton({ action, disabled, busy }: { action: NoticeAction; disabled?: boolean; busy?: boolean }) {
  return (
    <Button variant="secondary" className={cn(NOTICE_SECONDARY, 'shrink-0')} onClick={action.onClick} disabled={disabled}>
      {busy ? <Spinner tone="inherit" /> : action.icon}
      {action.label}
    </Button>
  );
}

export interface NoticeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Значок по смыслу; без него круга нет. */
  icon?: NoticeIconKind;
  tone?: NoticeTone;
  title: React.ReactNode;
  hint?: React.ReactNode;
  /** Полный текст подписи подсказкой (обрезанная ошибка ядра). */
  hintTitle?: string;
  /** Действия справа в строке: NoticeButton или своя кнопка той же высоты. */
  actions?: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
}

export const Notice = React.forwardRef<HTMLDivElement, NoticeProps>(
  ({ icon, tone = 'neutral', title, hint, hintTitle, actions, onClose, closeLabel, className, ...props }, ref) => (
    <NoticeSurface ref={ref} className={cn('flex min-w-0 items-center gap-3', className)} data-shade-notice="" {...props}>
      {icon && (
        <NoticeMark tone={icon === 'problem' && tone === 'neutral' ? 'error' : tone}>
          <NoticeGlyph kind={icon} />
        </NoticeMark>
      )}
      <div className={cn('min-w-0 flex-1', !icon && 'pl-1')}>
        <p className={NOTICE_TITLE} title={typeof title === 'string' ? title : undefined}>
          {title}
        </p>
        {hint && (
          <p className={cn('mt-0.5', NOTICE_HINT)} title={hintTitle ?? (typeof hint === 'string' ? hint : undefined)}>
            {hint}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      {onClose && <CloseButton label={closeLabel ?? ''} onClick={onClose} className="static size-10 translate-y-0" />}
    </NoticeSurface>
  ),
);
Notice.displayName = 'Notice';
