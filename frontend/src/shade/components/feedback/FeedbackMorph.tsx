// «Написать отзыв» в Настройках → Общие. Механика «Morph Popover» (Kokonut UI, MIT, @dorianbaffier,
// kokonutui.com; лицензия в THIRD_PARTY_NOTICES.md), код свой, движение на @umbra/motion:
//  - кнопка вырастает в маленькую форму (звёзды, поле текста, «Отправить»); подпись кнопки
//    переезжает в заголовок формы; одна пружина MORPH (soft Umbra) ведёт размер, радиус, подпись
//    и проявление содержимого;
//  - Esc и щелчок вне формы закрывают (черновик остаётся до ухода со страницы), Cmd+Enter отправляет;
//  - фокус в поле при открытии, обратно на кнопку после закрытия;
//  - отправлено: форма сжимается в плашку «Спасибо» с галочкой размером с кнопку и через
//    THANKS_HOLD_MS снова становится кнопкой. Не ушло: форма закрывается, тост «Не получилось
//    отправить, попробуем позже» (отзыв в очереди) или «Не получилось отправить».
// Прервали (закрыли посреди раскрытия): пружина разворачивается с текущего места и скорости.
'use client';

import * as React from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import { Button } from '@/shade/components/ui/button';
import { Spinner } from '@/shade/components/ui/spinner';
import { StarRating } from '@/shade/components/feedback/StarRating';
import { FeedbackText } from '@/shade/components/feedback/FeedbackFields';
import { START, canSend, flowReducer, type Flow } from '@/shade/lib/feedback/flow';
import { submitFeedback } from '@/shade/lib/feedback/store';
import { after, spring } from '@/shade/lib/motion/spring';
import { MORPH, THANKS_HOLD_MS } from '@/shade/lib/motion/shade-springs';
import { shadeToast } from '@/shade/lib/toasts';
import { cn } from '@/shade/lib/utils';
import { useLang } from '@/shade/lib/lang';
import { t } from '@/shade/strings';
import { CheckIcon } from '@/shade/components/icons';

const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

/** Ширина раскрытой формы и внутренний отступ, px. */
const FORM_W = 380;
const PAD = 20;
/** Высота кнопки (h-12) и строки заголовка, px. */
const BTN_H = 48;
const HEAD_H = 20;
const HEAD_GAP = 12;
/** Радиус кнопки (таблетка) и формы (--tile-radius читается из CSS при открытии). */
const BTN_R = BTN_H / 2;

const FORM_START: Flow = { ...START, step: 'form', origin: 'low' };

type Phase = 'closed' | 'open' | 'closing' | 'plaque';

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** Ближайший прокручиваемый предок (плитка Настроек). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n;
  }
  return null;
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Каждый итог (ушло, в очереди, отвергнуто) начинает новый круг: кнопка с пустым черновиком. */
export function FeedbackMorph() {
  const [round, setRound] = React.useState(0);
  return <Morph key={round} onDone={() => setRound((r) => r + 1)} />;
}

function Morph({ onDone }: { onDone: () => void }) {
  useLang();
  const [phase, setPhase] = React.useState<Phase>('closed');
  const [flow, dispatch] = React.useReducer(flowReducer, FORM_START);
  const sending = flow.step === 'sending';

  const anchor = React.useRef<HTMLDivElement>(null);
  const shell = React.useRef<HTMLDivElement>(null);
  const muted = React.useRef<HTMLDivElement>(null);
  const glass = React.useRef<HTMLDivElement>(null);
  const label = React.useRef<HTMLSpanElement>(null);
  const body = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const plaque = React.useRef<HTMLDivElement>(null);
  const stepRef = React.useRef(flow.step);
  stepRef.current = flow.step;
  const doneRef = React.useRef(onDone);
  doneRef.current = onDone;
  const geo = React.useRef({ w0: 200, labelW: 120, h1: 280, r1: 28 });
  const phaseRef = React.useRef(phase);
  phaseRef.current = phase;
  const scroller = React.useRef<HTMLElement | null>(null);

  const draw = React.useCallback((p: number) => {
    const g = geo.current;
    const el = shell.current;
    if (!el) return;
    const q = clamp01(p);
    el.style.width = `${lerp(g.w0, FORM_W, p).toFixed(1)}px`;
    el.style.height = `${Math.max(BTN_H, lerp(BTN_H, g.h1, p)).toFixed(1)}px`;
    el.style.borderRadius = `${lerp(BTN_R, g.r1, q).toFixed(1)}px`;
    if (muted.current) muted.current.style.opacity = (1 - q).toFixed(3);
    if (glass.current) glass.current.style.opacity = q.toFixed(3);
    // Плашка «Спасибо» проявляется, когда форма почти сжалась в размер кнопки
    if (plaque.current) plaque.current.style.opacity = (1 - clamp01(p * 2.5)).toFixed(3);
    if (label.current) {
      const x = lerp((g.w0 - g.labelW) / 2, PAD, p);
      const y = lerp((BTN_H - HEAD_H) / 2, PAD, p);
      label.current.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    if (body.current) {
      // Содержимое проявляется во второй половине хода и гаснет в первой половине обратного
      const c = clamp01((p - 0.5) / 0.5);
      body.current.style.opacity = c.toFixed(3);
      body.current.style.transform = `translateY(${((1 - c) * 6).toFixed(1)}px)`;
    }
    // Строка в конце плитки Настроек, форма растёт вниз: пока раскрывается, плитка докручивается
    // вслед за нижним краем (в такт пружине), иначе «Отправить» уходит под нижнюю кромку.
    const sc = scroller.current;
    if (phaseRef.current === 'open' && sc) {
      const need = el.getBoundingClientRect().bottom + PAD - sc.getBoundingClientRect().bottom;
      if (need > 0.5) sc.scrollTop += need;
    }
  }, []);

  const [s] = React.useState(() =>
    spring(0, {
      ...MORPH,
      onUpdate: (p) => draw(p),
      onRest: (p) => {
        if (p <= 0 && phaseRef.current === 'closing') {
          setPhase('closed');
          button.current?.focus();
          // Не ушло (очередь или отказ): новый круг с пустой формой
          if (stepRef.current === 'queued' || stepRef.current === 'failed') doneRef.current();
        }
      },
    }),
  );
  React.useEffect(() => () => s.stop(), [s]);

  const measure = React.useCallback(() => {
    const g = geo.current;
    if (anchor.current) g.w0 = anchor.current.offsetWidth;
    if (label.current) g.labelW = label.current.offsetWidth;
    if (body.current) g.h1 = PAD + HEAD_H + HEAD_GAP + body.current.offsetHeight + PAD;
    if (shell.current) {
      const r = parseFloat(getComputedStyle(shell.current).getPropertyValue('--tile-radius'));
      if (Number.isFinite(r) && r > 0) g.r1 = r;
    }
  }, []);

  // Открыли: замер, кадр в виде кнопки, пружина к форме; фокус в поле
  useIsoLayoutEffect(() => {
    if (phase !== 'open') return;
    measure();
    draw(s.value);
    s.to(1);
    scroller.current = scrollParent(anchor.current);
    // Фокус без своей прокрутки: она шла бы к полю в ещё не раскрытой оболочке (докрутку делает draw)
    textRef.current?.focus({ preventScroll: true });
  }, [phase]);

  // Высота формы меняется (счётчик знаков, перенос): следим, пока открыта
  React.useEffect(() => {
    if (phase !== 'open' || !body.current) return;
    const ro = new ResizeObserver(() => {
      measure();
      draw(s.value);
    });
    ro.observe(body.current);
    return () => ro.disconnect();
  }, [phase, measure, draw, s]);

  const close = React.useCallback(() => {
    if (phaseRef.current !== 'open' || sending) return;
    setPhase('closing');
    s.to(0);
  }, [s, sending]);

  // Щелчок вне формы закрывает
  React.useEffect(() => {
    if (phase !== 'open') return;
    const onDown = (e: PointerEvent) => {
      if (shell.current && !shell.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [phase, close]);

  // Отправка: один запрос на вход в sending
  React.useEffect(() => {
    if (flow.step !== 'sending') return;
    let live = true;
    void submitFeedback(flow.rating, flow.text).then((result) => {
      if (!live) return;
      dispatch({ type: 'result', result });
      if (result === 'sent') {
        // Форма сжимается в плашку размером с кнопку, потом плашка снова кнопка
        setPhase('plaque');
        s.to(0);
      } else {
        setPhase('closing');
        s.to(0);
        if (result === 'queued') shadeToast.info(t('feedbackQueued'));
        else shadeToast.error(t('feedbackFailed'));
      }
    });
    return () => {
      live = false;
    };
    // только вход в шаг
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.step]);

  // Плашка держится THANKS_HOLD_MS, потом снова кнопка (новый круг, черновик отправлен)
  React.useEffect(() => {
    if (phase !== 'plaque') return;
    return after(THANKS_HOLD_MS, () => {
      doneRef.current();
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-shade-feedback-write]')?.focus());
    });
  }, [phase]);

  const expanded = phase !== 'closed';

  return (
    <div ref={anchor} className="relative h-12 w-full">
      {/* Кнопка в покое; пока форма раскрыта, на её месте стоит оболочка формы */}
      <Button
        ref={button}
        variant="secondary"
        className={cn('w-full', phase !== 'closed' && 'invisible')}
        data-shade-feedback-write
        aria-haspopup="dialog"
        aria-expanded={phase === 'open'}
        onClick={() => setPhase('open')}
      >
        <PencilSimple weight="fill" />
        {t('feedbackWrite')}
      </Button>

      {expanded && (
        <div
          ref={shell}
          role="dialog"
          aria-modal="false"
          aria-labelledby="shade-feedback-morph-title"
          // Размер и радиус только из draw (layout-эффект до первой отрисовки): стиль в разметке
          // React переписал бы при перерисовке посреди хода пружины (щелчок по звезде сжимал форму)
          className="absolute right-0 top-0 z-30 overflow-hidden"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.defaultPrevented) {
              e.preventDefault();
              close();
            }
          }}
        >
          <div ref={muted} className="absolute inset-0 bg-muted" aria-hidden />
          <div
            ref={glass}
            className="shade-glass shade-glass-dense absolute inset-0 opacity-0"
            style={{ borderRadius: 'inherit' }}
            aria-hidden
          />
          {phase === 'plaque' && (
            <div
              ref={plaque}
              role="status"
              className="absolute inset-0 flex items-center justify-center gap-2 text-sm font-medium opacity-0"
            >
              <CheckIcon className="size-5 text-primary-ink" aria-hidden />
              {t('feedbackSent')}
            </div>
          )}
          <span
            ref={label}
            id="shade-feedback-morph-title"
            className={cn(
              'absolute left-0 top-0 block whitespace-nowrap text-[15px] font-semibold leading-5',
              phase === 'plaque' && 'invisible',
            )}
          >
            {t('feedbackWrite')}
          </span>
          <div
            ref={body}
            className="absolute opacity-0"
            style={{
              left: PAD,
              top: PAD + HEAD_H + HEAD_GAP,
              width: FORM_W - 2 * PAD,
            }}
          >
            <div className="flex flex-col gap-3">
              <StarRating size={24} value={flow.rating} disabled={sending} onChange={(r) => dispatch({ type: 'commit', rating: r })} />
              <FeedbackText
                ref={textRef}
                labelledBy="shade-feedback-morph-title"
                value={flow.text}
                disabled={sending}
                onChange={(text) => dispatch({ type: 'text', text })}
                onSubmit={() => dispatch({ type: 'send' })}
                onCancel={close}
              />
              <div>
                <Button
                  onClick={() => dispatch({ type: 'send' })}
                  disabled={!canSend(flow) || sending}
                  aria-keyshortcuts="Meta+Enter Control+Enter"
                >
                  {sending && <Spinner tone="inherit" />}
                  {sending ? t('feedbackSending') : t('feedbackSend')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
