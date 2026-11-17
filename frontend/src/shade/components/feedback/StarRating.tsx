// Оценка звёздами. Механика и значения из образца «Star Rating» (DesignBookmark), код свой, движение на
// пружинах @umbra/motion (lib/motion). Без автопроигрывания, которое есть в образце.
//  - Наведение зажигает звёзды до указателя по очереди, шаг STAR_STAGGER_MS; гаснут в обратном порядке.
//  - У каждой звезды пружина заливки STAR_FILL (слева направо, clip-path) и «прыжок» масштаба при
//    зажигании: STAR_POP от STAR_POP_FROM с толчком STAR_POP_VELOCITY.
//  - Цвет: жёлтые (--star), при 1-2 мягко-красные (--star-low), смена за 200 мс.
//  - Подпись под звёздами перекатывается (RollText, LABEL_ROLL).
//  - Щелчок ставит оценку и подтверждает её (onCommit), уход указателя возвращает к поставленной.
//  - role="radiogroup", у звезды role="radio" и aria-checked; одна звезда в порядке Tab (бегущий
//    tabindex); стрелки меняют оценку, Enter и пробел подтверждают (lib/feedback/stars.ts).
//  - Reduced motion: движок ставит итог сразу, очереди и прыжка нет.
'use client';

import * as React from 'react';
import { Star } from '@phosphor-icons/react';
import { RollText } from '@/shade/components/feedback/RollText';
import { after, prefersReducedMotion, spring, type Spring } from '@/shade/lib/motion/spring';
import { STAR_FILL, STAR_POP, STAR_POP_FROM, STAR_POP_VELOCITY, STAR_STAGGER_MS } from '@/shade/lib/motion/shade-springs';
import { RATING_LABELS, STARS, starKey } from '@/shade/lib/feedback/stars';
import { FORM_MAX } from '@/shade/lib/feedback/flow';
import { cn } from '@/shade/lib/utils';
import { t, tp } from '@/shade/strings';
import { useLang } from '@/shade/lib/lang';

export interface StarRatingProps {
  value: number;
  /** Оценка изменилась (щелчок, стрелки). */
  onChange: (rating: number) => void;
  /** Оценка подтверждена: щелчок, Enter или пробел. Здесь карточка выбирает ветку. */
  onCommit?: (rating: number) => void;
  /** Подпись под звёздами. */
  showLabel?: boolean;
  /** Фокус на звезду при появлении. */
  autoFocus?: boolean;
  disabled?: boolean;
  /** Размер значка, px: 32 в карточке, 28 в форме. */
  size?: number;
  className?: string;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

interface StarMotion {
  fill: Spring;
  pop: Spring;
  lit: boolean;
}

export function StarRating({ value, onChange, onCommit, showLabel = true, autoFocus, disabled, size = 32, className }: StarRatingProps) {
  useLang();
  const [hover, setHover] = React.useState(0);
  const shown = hover || value;
  // 1-2 звезды (ветка «Что улучшить?») мягко-красные, 3-5 жёлтые; цвет меняется вместе с наведением
  const low = shown > 0 && shown <= FORM_MAX;
  const fillRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const popRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const btnRefs = React.useRef<(HTMLButtonElement | null)[]>([]);

  // Пружины по одной паре на звезду; пишут прямо в DOM, без setState на кадр
  const motion = React.useRef<StarMotion[] | null>(null);
  if (motion.current === null) {
    motion.current = Array.from({ length: STARS }, (_, i) => ({
      lit: i < value,
      fill: spring(i < value ? 1 : 0, {
        ...STAR_FILL,
        onUpdate: (x) => fillRefs.current[i]?.style.setProperty('--shade-star-fill', String(Math.max(0, Math.min(1, x)))),
      }),
      pop: spring(1, {
        ...STAR_POP,
        onUpdate: (x) => {
          const el = popRefs.current[i];
          if (el) el.style.transform = `scale(${x.toFixed(4)})`;
        },
      }),
    }));
  }

  // Зажечь и погасить до shown по очереди; новая цель отменяет ещё не начавшиеся шаги
  const pending = React.useRef<(() => void)[]>([]);
  React.useEffect(() => {
    const stars = motion.current!;
    pending.current.forEach((cancel) => cancel());
    pending.current = [];
    const instant = prefersReducedMotion();
    const on: number[] = [];
    const off: number[] = [];
    stars.forEach((s, i) => {
      const want = i < shown;
      if (want && !s.lit) on.push(i);
      if (!want && s.lit) off.push(i);
    });
    const light = (i: number) => {
      const s = stars[i];
      s.lit = true;
      s.fill.to(1);
      if (instant) return;
      s.pop.set(STAR_POP_FROM);
      s.pop.to(1);
      s.pop.kick(STAR_POP_VELOCITY);
    };
    const dim = (i: number) => {
      const s = stars[i];
      s.lit = false;
      s.fill.to(0);
    };
    on.forEach((i, k) => (instant || k === 0 ? light(i) : pending.current.push(after(k * STAR_STAGGER_MS, () => light(i)))));
    off.reverse().forEach((i, k) => (instant || k === 0 ? dim(i) : pending.current.push(after(k * STAR_STAGGER_MS, () => dim(i)))));
  }, [shown]);

  React.useEffect(
    () => () => {
      pending.current.forEach((cancel) => cancel());
      motion.current?.forEach((s) => {
        s.fill.stop();
        s.pop.stop();
      });
    },
    [],
  );

  // Заливка в DOM сразу после монтирования, дальше ею владеет пружина (не стиль разметки: React
  // при смене value переписал бы значение посреди движения)
  useIsoLayoutEffect(() => {
    motion.current!.forEach((s, i) => fillRefs.current[i]?.style.setProperty('--shade-star-fill', String(s.fill.value)));
  }, []);

  React.useEffect(() => {
    if (autoFocus) btnRefs.current[Math.max(0, value - 1)]?.focus();
    // только при появлении
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const action = starKey(e.key, value);
    if (!action) return;
    e.preventDefault();
    if (action.kind === 'rate') {
      setHover(0);
      onChange(action.rating);
      btnRefs.current[action.rating - 1]?.focus();
    } else {
      onCommit?.(action.rating);
    }
  };

  const tabStop = Math.max(1, value);
  const box = size + 12;

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <div
        role="radiogroup"
        aria-label={t('feedbackRateGroup')}
        aria-disabled={disabled || undefined}
        className="-mx-1.5 flex items-center"
        onPointerLeave={() => setHover(0)}
        onKeyDown={onKeyDown}
      >
        {Array.from({ length: STARS }, (_, i) => {
          const n = i + 1;
          return (
            <button
              key={n}
              ref={(el) => {
                btnRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${tp('feedbackStar', n)}, ${t(RATING_LABELS[n])}`}
              tabIndex={n === tabStop ? 0 : -1}
              disabled={disabled}
              onPointerEnter={() => !disabled && setHover(n)}
              onPointerMove={() => !disabled && hover !== n && setHover(n)}
              onClick={() => {
                onChange(n);
                onCommit?.(n);
              }}
              className="flex shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
              style={{ width: box, height: box }}
            >
              <span
                ref={(el) => {
                  popRefs.current[i] = el;
                }}
                className="relative block will-change-transform"
                style={{ width: size, height: size }}
              >
                <Star weight="fill" aria-hidden className="absolute inset-0 size-full text-muted-foreground/30" />
                <span
                  ref={(el) => {
                    fillRefs.current[i] = el;
                  }}
                  className="shade-star-fill absolute inset-0"
                >
                  <Star
                    weight="fill"
                    aria-hidden
                    className={cn('size-full transition-colors duration-200 motion-reduce:transition-none', low ? 'text-[hsl(var(--star-low))]' : 'text-[hsl(var(--star))]')}
                  />
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {showLabel && <RollText text={t(RATING_LABELS[shown])} className="h-5 text-sm leading-5 text-muted-foreground" />}
    </div>
  );
}
