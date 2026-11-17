// Карточка «Как вам Shade?» в стопке уведомлений у дока (RecordDock), тихая, не модальная. Когда её
// показывать, решает lib/feedback/policy.ts; шаги и переходы в lib/feedback/flow.ts.
//  - 3-5 звёзд: оценка уходит сразу. Звезда допрыгивает (FOLD_DELAY_MS), заголовок перекатывается
//    в «Спасибо!», строка звёзд сворачивается на пружине высоты, через THANKS_HOLD_MS карточка уходит.
//  - 1-2 звезды: карточка раскрывается в форму «Что улучшить?» (заголовок перекатывается, высота на
//    пружине), поле в фокусе, Cmd+Enter отправляет, Esc закрывает. Без «Отправить» ничего не уходит.
//  - Наведение и стрелки ничего не отправляют. Крестик или Esc до выбора: закрыто, ничего не ушло.
//  - Не ушло (нет сети, функция не настроена): «Не получилось отправить, попробуем позже», отзыв в
//    очереди. Звезды на GitHub в карточке нет (будет отдельной иконкой).
'use client';

import * as React from 'react';
import { Button } from '@/shade/components/ui/button';
import { CloseButton } from '@/shade/components/ui/close-button';
import { Spinner } from '@/shade/components/ui/spinner';
import { StarRating } from '@/shade/components/feedback/StarRating';
import { RollText } from '@/shade/components/feedback/RollText';
import { FeedbackText, OutcomePlaque, useSpringHeight } from '@/shade/components/feedback/FeedbackFields';
import { START, canSend, flowReducer, type Flow } from '@/shade/lib/feedback/flow';
import { noteDismissed, submitFeedback } from '@/shade/lib/feedback/store';
import { after, prefersReducedMotion } from '@/shade/lib/motion/spring';
import { THANKS_HOLD_MS } from '@/shade/lib/motion/shade-springs';
import { cn } from '@/shade/lib/utils';
import { useLang } from '@/shade/lib/lang';
import { t } from '@/shade/strings';

/** «Не получилось отправить» держится дольше «Спасибо»: его надо успеть прочитать. */
export const FAILED_HOLD_MS = 4000;

/** Звезда допрыгивает («прыжок» 520/13 почти успокоился), потом карточка сворачивается в «Спасибо!». */
export const FOLD_DELAY_MS = 450;

type TitleKey = 'feedbackAskTitle' | 'feedbackImproveTitle' | 'feedbackThanksTitle';

export function FeedbackCard({ onDone, initial }: { onDone: () => void; initial?: Flow }) {
  useLang();
  const [flow, dispatch] = React.useReducer(flowReducer, initial ?? START);
  const outcome = flow.step === 'sent' || flow.step === 'queued' || flow.step === 'failed' ? flow.step : null;
  const sending = flow.step === 'sending';
  // Оценка ушла сразу с карточки (3-5 звёзд): та же карточка сворачивается в «Спасибо!»
  const direct = flow.origin === null && flow.step !== 'ask' && flow.step !== 'closed';
  const [folded, setFolded] = React.useState(false);
  // Плашка итога: всё, кроме удачной отправки сразу с карточки (там «Спасибо!» в заголовке)
  const plaque = outcome && !(outcome === 'sent' && direct) ? outcome : null;
  const inForm = flow.step === 'form' || (sending && flow.origin === 'low');
  const titleId = React.useId();
  const { outer, inner } = useSpringHeight<HTMLDivElement, HTMLDivElement>();

  // Отправка: один запрос на вход в sending (повторное «Отправить» редуктор не пропускает)
  React.useEffect(() => {
    if (flow.step !== 'sending') return;
    let live = true;
    void submitFeedback(flow.rating, flow.text).then((result) => live && dispatch({ type: 'result', result }));
    return () => {
      live = false;
    };
    // только вход в шаг
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.step]);

  // Сразу с карточки: дать звезде допрыгать, потом свернуться в «Спасибо!»
  React.useEffect(() => {
    if (!direct || folded) return;
    return after(prefersReducedMotion() ? 0 : FOLD_DELAY_MS, () => setFolded(true));
  }, [direct, folded]);

  // Итог виден и уходит сам (таймер во времени движка: на ×0,25 ждёт вчетверо дольше).
  // «Спасибо!» после отправки сразу с карточки считается от сворачивания, а не от ответа сети.
  const holding = outcome !== null && (outcome !== 'sent' || !direct || folded);
  React.useEffect(() => {
    if (!holding) return;
    return after(outcome === 'sent' ? THANKS_HOLD_MS : FAILED_HOLD_MS, () => dispatch({ type: 'close' }));
  }, [holding, outcome]);

  // Закрыто: закрытие без отправки идёт в счёт (после двух больше не спрашиваем)
  const closedOnce = React.useRef(false);
  React.useEffect(() => {
    if (flow.step !== 'closed' || closedOnce.current) return;
    closedOnce.current = true;
    if (flow.dismissed) noteDismissed();
    onDone();
  }, [flow.step, flow.dismissed, onDone]);

  const titleKey: TitleKey = inForm ? 'feedbackImproveTitle' : direct && folded ? 'feedbackThanksTitle' : 'feedbackAskTitle';

  return (
    <section
      aria-labelledby={plaque ? undefined : titleId}
      aria-label={plaque ? t('feedbackAskTitle') : undefined}
      data-step={flow.step}
      data-folded={folded || undefined}
      // Стекло снаружи, обрезка по высоте внутри: в WebKit backdrop-filter вместе с overflow: hidden на
      // одном элементе перестаёт размывать, и строки под карточкой просвечивают
      className="shade-glass shade-glass-dense relative w-full max-w-[520px] rounded-tile"
      onKeyDown={(e) => {
        // Esc вне поля: закрыть (в поле Esc обрабатывает само поле)
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          dispatch({ type: 'close' });
        }
      }}
    >
      <div ref={outer} className="overflow-hidden rounded-[inherit]">
        <div ref={inner} className={cn('p-5', !plaque && !direct && 'pr-[72px]')}>
          {plaque ? (
            <OutcomePlaque outcome={plaque} />
          ) : (
            <div className="flex min-w-0 flex-col">
              <RollText as="h2" id={titleId} text={t(titleKey)} className="h-5 text-[15px] font-semibold leading-5" />

              {!inForm && (
                // Сворачивание: блок звёзд схлопывается в ноль, видимое гаснет, а высоту карточки ведёт
                // пружина useSpringHeight (звёзды обрезаются краем карточки, а не исчезают рывком)
                <div
                  className={cn('transition-opacity duration-200 motion-reduce:transition-none', folded ? 'h-0 opacity-0' : 'mt-2')}
                  aria-hidden={folded || undefined}
                >
                  <StarRating
                    value={flow.rating}
                    disabled={direct}
                    onChange={(r) => dispatch({ type: 'rate', rating: r })}
                    onCommit={(r) => dispatch({ type: 'commit', rating: r })}
                  />
                </div>
              )}

              {inForm && (
                <div className="shade-dock-in mt-2 flex flex-col gap-3">
                  <StarRating size={24} value={flow.rating} disabled={sending} onChange={(r) => dispatch({ type: 'commit', rating: r })} />
                  <FeedbackText
                    autoFocus
                    labelledBy={titleId}
                    value={flow.text}
                    disabled={sending}
                    onChange={(text) => dispatch({ type: 'text', text })}
                    onSubmit={() => dispatch({ type: 'send' })}
                    onCancel={() => dispatch({ type: 'cancel' })}
                  />
                  <div>
                    <Button onClick={() => dispatch({ type: 'send' })} disabled={!canSend(flow) || sending} aria-keyshortcuts="Meta+Enter Control+Enter">
                      {sending && <Spinner tone="inherit" />}
                      {sending ? t('feedbackSending') : t('feedbackSend')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Для чтения с экрана: заголовок сменился сам, итог объявляем явно */}
              <p role="status" className="sr-only">
                {direct && outcome === 'sent' ? t('feedbackSentHint') : ''}
              </p>
            </div>
          )}
        </div>
      </div>
      {!plaque && !direct && (
        <CloseButton label={t('close')} onClick={() => dispatch({ type: 'close' })} className={cn(inForm && 'top-5 translate-y-0')} disabled={sending} />
      )}
    </section>
  );
}
