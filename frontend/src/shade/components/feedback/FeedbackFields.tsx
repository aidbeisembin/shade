// Общие части отзыва для карточки в доке (FeedbackCard) и формы в Настройках (FeedbackMorph):
// поле текста со счётчиком, плашка итога, высота на пружине, ссылка на GitHub.
'use client';

import * as React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Warning } from '@phosphor-icons/react';
import { NoticeMark } from '@/shade/components/ui/notice';
import { spring } from '@/shade/lib/motion/spring';
import { MORPH } from '@/shade/lib/motion/shade-springs';
import { MAX_TEXT, textLength } from '@/shade/lib/feedback/contract';
import { GITHUB_URL } from '@/shade/lib/feedback/store';
import { shadeToast } from '@/shade/lib/toasts';
import { cn } from '@/shade/lib/utils';
import { t, tp } from '@/shade/strings';
import { useLang } from '@/shade/lib/lang';

const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

/** Счётчик появляется, когда до предела осталось столько знаков. */
const COUNTER_FROM = 200;

const FIELD =
  'min-h-[96px] w-full resize-none rounded-nested bg-muted px-4 py-3 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export interface FeedbackTextProps {
  value: string;
  onChange: (text: string) => void;
  /** Cmd+Enter (Ctrl+Enter). */
  onSubmit: () => void;
  /** Esc. */
  onCancel: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  labelledBy?: string;
}

/** Поле «Что улучшить?»: до MAX_TEXT знаков (вставка длиннее обрезается), счётчик у предела. */
export const FeedbackText = React.forwardRef<HTMLTextAreaElement, FeedbackTextProps>(
  ({ value, onChange, onSubmit, onCancel, disabled, autoFocus, labelledBy }, ref) => {
    useLang();
    const left = MAX_TEXT - textLength(value);
    const noteId = React.useId();
    return (
      <div className="flex flex-col gap-2">
        <textarea
          ref={ref}
          value={value}
          rows={3}
          autoFocus={autoFocus}
          disabled={disabled}
          aria-labelledby={labelledBy}
          aria-describedby={left <= COUNTER_FROM ? noteId : undefined}
          aria-keyshortcuts="Meta+Enter Control+Enter Escape"
          placeholder={t('feedbackPlaceholder')}
          className={FIELD}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
        />
        {left <= COUNTER_FROM && (
          <p id={noteId} className={cn('text-xs leading-4 text-muted-foreground tabular', left <= 0 && 'text-destructive-ink')} aria-live="polite">
            {tp('feedbackCharsLeft', Math.max(0, left))}
          </p>
        )}
      </div>
    );
  },
);
FeedbackText.displayName = 'FeedbackText';

export type Outcome = 'sent' | 'queued' | 'failed';

/** Плашка итога: «Спасибо» с галочкой, или «Не получилось отправить». */
export function OutcomePlaque({ outcome, compact }: { outcome: Outcome; compact?: boolean }) {
  useLang();
  const ok = outcome === 'sent';
  const title = ok ? t('feedbackSent') : outcome === 'queued' ? t('feedbackQueued') : t('feedbackFailed');
  return (
    <div role="status" className="flex min-w-0 items-center gap-3">
      <NoticeMark tone={ok ? 'success' : 'giants'} className={compact ? 'size-8 [&_svg]:size-4' : undefined}>
        {ok ? <Check weight="bold" /> : <Warning />}
      </NoticeMark>
      <div className="min-w-0">
        <p className={cn('font-semibold leading-5', compact ? 'truncate text-sm' : 'text-[15px] [text-wrap:balance]')}>{title}</p>
        {ok && !compact && <p className="mt-1 text-sm leading-5 text-muted-foreground">{t('feedbackSentHint')}</p>}
      </div>
    </div>
  );
}

/** Открыть репозиторий Shade в браузере. Для будущей иконки GitHub (из карточки и Настроек кнопка убрана). */
export function openGithub() {
  invoke('open_external_url', { url: GITHUB_URL }).catch((error) => shadeToast.error(t('openLinkFailed'), { description: String(error) }));
}

/**
 * Высота обёртки следует за содержимым на пружине MORPH (soft Umbra, перелёт до 4 %): карточка
 * раскрывается в форму и сжимается в плашку без скачка. Первое измерение ставится сразу.
 */
export function useSpringHeight<O extends HTMLElement, I extends HTMLElement>() {
  const outer = React.useRef<O>(null);
  const inner = React.useRef<I>(null);
  const [s] = React.useState(() =>
    spring(-1, {
      ...MORPH,
      precision: 0.5,
      onUpdate: (h) => {
        if (outer.current && h >= 0) outer.current.style.height = `${h.toFixed(1)}px`;
      },
      onRest: () => {
        // В покое высота по содержимому: перенос строк при смене языка или окна без пружины
        if (outer.current) outer.current.style.height = '';
      },
    }),
  );
  useIsoLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => {
      const h = el.offsetHeight;
      if (s.target < 0) {
        s.set(h);
        if (outer.current) outer.current.style.height = '';
      } else if (Math.abs(h - s.target) > 0.5) {
        if (outer.current) outer.current.style.height = `${s.value.toFixed(1)}px`;
        s.to(h);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      s.stop();
    };
  }, [s]);
  return { outer, inner };
}
