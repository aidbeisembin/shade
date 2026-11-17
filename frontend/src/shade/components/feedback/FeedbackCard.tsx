// Карточка «Как вам Shade?» в стопке уведомлений у дока (RecordDock), тихая, не модальная. Когда её
// показывать, решает lib/feedback/policy.ts; шаги и переходы в lib/feedback/flow.ts.
//  - 1-3 звезды: карточка раскрывается в форму «Что улучшить?» (механика Morph Popover: заголовок
//    перекатывается, высота на пружине), поле в фокусе, Cmd+Enter отправляет, Esc закрывает.
//  - 4-5 звёзд: «Спасибо!», «Поставить звезду на GitHub», «Отправить оценку» и тихая «Написать отзыв».
//  - Ничего не уходит без «Отправить» или «Отправить оценку». Крестик или Esc: закрыто, ничего не ушло.
//  - Отправлено: плашка «Спасибо» с галочкой, через THANKS_HOLD_MS карточка уходит. Не ушло (нет сети,
//    функция не настроена): «Не получилось отправить, попробуем позже», отзыв в очереди.
'use client';

import * as React from 'react';
import { Star } from '@phosphor-icons/react';
import { Button } from '@/shade/components/ui/button';
import { CloseButton } from '@/shade/components/ui/close-button';
import { NoticeMark } from '@/shade/components/ui/notice';
import { Spinner } from '@/shade/components/ui/spinner';
import { StarRating } from '@/shade/components/feedback/StarRating';
import { RollText } from '@/shade/components/feedback/RollText';
import { FeedbackText, GithubButton, OutcomePlaque, useSpringHeight } from '@/shade/components/feedback/FeedbackFields';
import { START, canSend, flowReducer, type Flow, type Step } from '@/shade/lib/feedback/flow';
import { noteDismissed, submitFeedback } from '@/shade/lib/feedback/store';
import { after } from '@/shade/lib/motion/spring';
import { THANKS_HOLD_MS } from '@/shade/lib/motion/shade-springs';
import { cn } from '@/shade/lib/utils';
import { useLang } from '@/shade/lib/lang';
import { t } from '@/shade/strings';

/** «Не получилось отправить» держится дольше «Спасибо»: его надо успеть прочитать. */
export const FAILED_HOLD_MS = 4000;

const TITLE: Partial<Record<Step, 'feedbackAskTitle' | 'feedbackImproveTitle' | 'feedbackThanksTitle'>> = {
  ask: 'feedbackAskTitle',
  form: 'feedbackImproveTitle',
  thanks: 'feedbackThanksTitle',
};

export function FeedbackCard({ onDone, initial }: { onDone: () => void; initial?: Flow }) {
  useLang();
  const [flow, dispatch] = React.useReducer(flowReducer, initial ?? START);
  // Отправка в sending шла из формы или из «Спасибо!»: пока ждём ответа, виден тот же шаг
  const shownStep: Step = flow.step === 'sending' ? (flow.origin ? 'form' : 'thanks') : flow.step;
  const outcome = flow.step === 'sent' || flow.step === 'queued' || flow.step === 'failed' ? flow.step : null;
  const sending = flow.step === 'sending';
  const titleId = React.useId();
  const writeRef = React.useRef<HTMLButtonElement>(null);
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

  // Итог виден и уходит сам (таймер во времени движка: на ×0,25 ждёт вчетверо дольше)
  React.useEffect(() => {
    if (!outcome) return;
    return after(outcome === 'sent' ? THANKS_HOLD_MS : FAILED_HOLD_MS, () => dispatch({ type: 'close' }));
  }, [outcome]);

  // Закрыто: закрытие без отправки идёт в счёт (после двух больше не спрашиваем)
  const closedOnce = React.useRef(false);
  React.useEffect(() => {
    if (flow.step !== 'closed' || closedOnce.current) return;
    closedOnce.current = true;
    if (flow.dismissed) noteDismissed();
    onDone();
  }, [flow.step, flow.dismissed, onDone]);

  // Из формы «Написать отзыв» вернулись к «Спасибо!»: фокус обратно на ссылку
  const prevStep = React.useRef(flow.step);
  React.useEffect(() => {
    if (prevStep.current === 'form' && flow.step === 'thanks') writeRef.current?.focus();
    prevStep.current = flow.step;
  }, [flow.step]);

  const titleKey = TITLE[shownStep];
  const tall = shownStep !== 'ask' && !outcome;

  return (
    <section
      aria-labelledby={titleKey ? titleId : undefined}
      aria-label={titleKey ? undefined : t('feedbackSent')}
      data-step={flow.step}
      // Стекло снаружи, обрезка по высоте внутри: в WebKit backdrop-filter вместе с overflow: hidden на
      // одном элементе перестаёт размывать, и строки под карточкой просвечивают
      className="shade-glass shade-glass-dense relative w-full max-w-[520px] rounded-tile"
      onKeyDown={(e) => {
        // Esc вне поля: закрыть (в поле Esc обрабатывает само поле: из «Написать отзыв» назад)
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          dispatch({ type: 'close' });
        }
      }}
    >
      <div ref={outer} className="overflow-hidden rounded-[inherit]">
        <div ref={inner} className={cn('p-5', !outcome && 'pr-[72px]')}>
          {outcome ? (
            <OutcomePlaque outcome={outcome} />
          ) : (
            <div className="flex min-w-0 items-start gap-3">
              <NoticeMark tone="success">
                <Star weight="fill" />
              </NoticeMark>
              <div className="flex min-w-0 flex-1 flex-col">
                {titleKey && <RollText as="h2" id={titleId} text={t(titleKey)} className="h-5 text-[15px] font-semibold leading-5" />}

                {shownStep === 'ask' && (
                  <StarRating
                    className="mt-2"
                    value={flow.rating}
                    onChange={(r) => dispatch({ type: 'rate', rating: r })}
                    onCommit={(r) => dispatch({ type: 'commit', rating: r })}
                  />
                )}

                {shownStep === 'form' && (
                  <div className="shade-dock-in mt-2 flex flex-col gap-3">
                    <StarRating
                      size={24}
                      value={flow.rating}
                      disabled={sending}
                      onChange={(r) => dispatch({ type: 'commit', rating: r })}
                    />
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
                )}

                {shownStep === 'thanks' && (
                  <div className="shade-dock-in mt-1 flex flex-col gap-3">
                    <p className="text-sm leading-5 text-muted-foreground [text-wrap:pretty]">{t('feedbackThanksHint')}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <GithubButton />
                      <Button variant="secondary" onClick={() => dispatch({ type: 'send' })} disabled={sending}>
                        {sending && <Spinner tone="inherit" />}
                        {sending ? t('feedbackSending') : t('feedbackSendRating')}
                      </Button>
                      <Button
                        ref={writeRef}
                        variant="link"
                        className="h-10 px-2"
                        onClick={() => dispatch({ type: 'write' })}
                        disabled={sending}
                      >
                        {t('feedbackWrite')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {!outcome && (
        <CloseButton
          label={t('close')}
          onClick={() => dispatch({ type: 'close' })}
          className={cn(tall && 'top-5 translate-y-0')}
          disabled={sending}
        />
      )}
    </section>
  );
}
