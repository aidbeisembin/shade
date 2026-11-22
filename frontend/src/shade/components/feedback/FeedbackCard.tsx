// Карточка «Как вам Shade?» в правом нижнем углу (CornerStack; ставит её RecordDock), тихая, не
// модальная, без таймера, той же ширины, что весь стек угла. Когда её показывать, решает
// lib/feedback/policy.ts; шаги и переходы в lib/feedback/flow.ts.
//  - 3-5 звёзд: оценка уходит сразу. Звезда допрыгивает (FOLD_DELAY_MS), и как только ответ пришёл,
//    карточка сворачивается в плашку «Спасибо / Отзыв отправлен» с зелёной галочкой (высота на
//    пружине) и «Обсудить в чате беты» справа, если адрес чата задан. Плашка - итог действия:
//    4 с, с кнопкой чата 6 с (notice-timing.ts), под указателем и в фокусе время стоит.
//  - 1-2 звезды: карточка растёт вверх в форму «Что улучшить?» на том же месте (низ стека стоит,
//    высота на пружине), поле в фокусе (единственное место, где сообщение берёт фокус),
//    Cmd+Enter отправляет, Esc закрывает. Без «Отправить» ничего не уходит.
//  - Наведение и стрелки ничего не отправляют. Крестик или Esc до выбора: закрыто, ничего не ушло.
//  - Не ушло (нет сети, функция не настроена): «Не получилось отправить, попробуем позже», отзыв в
//    очереди. Звезды на GitHub в карточке нет (будет отдельной иконкой).
//  - Уходит из дока с тем видом, что был виден последним: шаг «закрыто» звёзды не возвращает.
//  - Рядом с «Отправить» кнопка «Обсудить в чате беты» со знаком Telegram, если адрес задан (lib/beta-chat.ts). В плашках
//    «не получилось» ссылки нет: сети нет, чат тоже не откроется.
'use client';

import * as React from 'react';
import { Button } from '@/shade/components/ui/button';
import { CloseButton } from '@/shade/components/ui/close-button';
import { Spinner } from '@/shade/components/ui/spinner';
import { StarRating } from '@/shade/components/feedback/StarRating';
import { RollText } from '@/shade/components/feedback/RollText';
import { FeedbackText, OutcomePlaque, useSpringHeight, useSpringWidth } from '@/shade/components/feedback/FeedbackFields';
import { START, canSend, flowReducer, type Flow } from '@/shade/lib/feedback/flow';
import { noteDismissed, submitFeedback } from '@/shade/lib/feedback/store';
import { after, prefersReducedMotion } from '@/shade/lib/motion/spring';
import { RESULT_ACTION_MS, RESULT_MS } from '@/shade/lib/notice-timing';
import { cn } from '@/shade/lib/utils';
import { useLang } from '@/shade/lib/lang';
import { t } from '@/shade/strings';
import { invoke } from '@tauri-apps/api/core';
import { betaChatUrl } from '@/shade/lib/beta-chat';
import { TelegramLogo } from '@phosphor-icons/react';
import { NoticeButton } from '@/shade/components/ui/notice';
import { shadeToast } from '@/shade/lib/toasts';

function openBetaChat(url: string) {
  invoke('open_external_url', { url }).catch((error) => shadeToast.error(t('openLinkFailed'), { description: String(error) }));
}

/** «Спасибо» со ссылкой на чат беты: итог с действием, 6 с. */
export const CHAT_HOLD_MS = RESULT_ACTION_MS;

/** «Спасибо» без ссылки и «Не получилось отправить»: итог без действия, 4 с. */
export const FAILED_HOLD_MS = RESULT_MS;
export const THANKS_CARD_MS = RESULT_MS;

/** Звезда допрыгивает («прыжок» 520/13 почти успокоился), потом карточка сжимается в плашку итога. */
export const FOLD_DELAY_MS = 450;

/** Ширину задаёт стек угла (CORNER_WIDTH): карточка во всю его ширину на всех шагах. */
const CARD_MAX = 10_000;

export function FeedbackCard({ onDone, initial }: { onDone: () => void; initial?: Flow }) {
  useLang();
  const [flow, dispatch] = React.useReducer(flowReducer, initial ?? START);
  // Вид рисуется по последнему шагу до «закрыто»: карточка уходит из дока (DockLeave) с плашкой
  // «Спасибо», а не с вернувшимися звёздами
  const viewRef = React.useRef(flow);
  if (flow.step !== 'closed') viewRef.current = flow;
  const view = viewRef.current;
  const outcome = view.step === 'sent' || view.step === 'queued' || view.step === 'failed' ? view.step : null;
  const sending = view.step === 'sending';
  // Оценка ушла сразу с карточки (3-5 звёзд): пока звезда допрыгивает и ждём ответа, видны звёзды
  const direct = view.origin === null && view.step !== 'ask';
  const [folded, setFolded] = React.useState(false);
  const plaque = outcome && (!direct || folded) ? outcome : null;
  const inForm = view.step === 'form' || (sending && view.origin === 'low');
  const titleId = React.useId();
  const { outer, inner } = useSpringHeight<HTMLDivElement, HTMLDivElement>();
  const frame = useSpringWidth<HTMLElement>(inner, false, CARD_MAX);

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

  // Сразу с карточки: дать звезде допрыгать, потом сжаться в плашку (если ответ уже есть)
  React.useEffect(() => {
    if (!direct || folded) return;
    return after(prefersReducedMotion() ? 0 : FOLD_DELAY_MS, () => setFolded(true));
  }, [direct, folded]);

  // Плашка итога видна и уходит сама (таймер во времени движка: на ×0,25 ждёт вчетверо дольше).
  // Со ссылкой на чат: дольше, и пока указатель или фокус на карточке, не уходит (отсчёт заново после)
  const chat = betaChatUrl();
  const chatInPlaque = plaque === 'sent' && chat !== null;
  // Указатель и фокус отдельно: звезда в фокусе исчезает при сворачивании в плашку (focusout),
  // а указатель при этом остаётся на карточке
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const paused = hovered || focused;
  React.useEffect(() => {
    if (!plaque || paused) return;
    const hold = plaque !== 'sent' ? FAILED_HOLD_MS : chatInPlaque ? CHAT_HOLD_MS : THANKS_CARD_MS;
    return after(hold, () => dispatch({ type: 'close' }));
  }, [plaque, paused, chatInPlaque]);

  // Закрыто: закрытие без отправки записывается (журнал; следующий показ по расписанию policy.ts)
  const closedOnce = React.useRef(false);
  React.useEffect(() => {
    if (flow.step !== 'closed' || closedOnce.current) return;
    closedOnce.current = true;
    if (flow.dismissed) noteDismissed();
    onDone();
  }, [flow.step, flow.dismissed, onDone]);

  const titleKey = inForm ? 'feedbackImproveTitle' : 'feedbackAskTitle';

  return (
    <section
      aria-labelledby={plaque ? undefined : titleId}
      aria-label={plaque ? t('feedbackAskTitle') : undefined}
      ref={frame}
      data-step={flow.step}
      data-plaque={plaque ?? undefined}
      // Стекло снаружи, обрезка по высоте внутри: в WebKit backdrop-filter вместе с overflow: hidden на
      // одном элементе перестаёт размывать, и строки под карточкой просвечивают
      // Ширина стека угла на всех шагах; высоту ведёт useSpringHeight, низ стоит, карточка растёт вверх
      className="shade-glass shade-glass-dense relative w-full max-w-full rounded-tile"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onKeyDown={(e) => {
        // Esc вне поля: закрыть (в поле Esc обрабатывает само поле)
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          dispatch({ type: 'close' });
        }
      }}
    >
      {/* Содержимое по центру: пока рамка догоняет ширину, край обрезает его поровну с двух сторон;
          items-start, чтобы пружина высоты не растягивала его при замере */}
      <div ref={outer} className="flex items-start justify-center overflow-hidden rounded-[inherit]">
        <div ref={inner} className={cn('shrink-0 p-4', !plaque && !direct && 'pr-16')}>
          {plaque ? (
            <div className="shade-dock-in">
              <OutcomePlaque
                outcome={plaque}
                action={
                  <>
                    {chatInPlaque && chat && (
                      <NoticeButton
                        action={{
                          label: t('betaChat'),
                          icon: <TelegramLogo weight="fill" />,
                          onClick: () => {
                            openBetaChat(chat);
                            dispatch({ type: 'close' });
                          },
                        }}
                      />
                    )}
                    <CloseButton label={t('close')} onClick={() => dispatch({ type: 'close' })} className="static size-10 translate-y-0" />
                  </>
                }
              />
            </div>
          ) : (
            <div className="flex min-w-0 flex-col">
              <RollText as="h2" id={titleId} text={t(titleKey)} className="h-5 text-[15px] font-semibold leading-5" />

              {!inForm && (
                <StarRating
                  className="mt-2"
                  value={view.rating}
                  disabled={direct}
                  onChange={(r) => dispatch({ type: 'rate', rating: r })}
                  onCommit={(r) => dispatch({ type: 'commit', rating: r })}
                />
              )}

              {inForm && (
                <div className="shade-dock-in mt-2 flex flex-col gap-3">
                  <StarRating size={24} value={view.rating} disabled={sending} onChange={(r) => dispatch({ type: 'commit', rating: r })} />
                  <FeedbackText
                    autoFocus
                    labelledBy={titleId}
                    value={view.text}
                    disabled={sending}
                    onChange={(text) => dispatch({ type: 'text', text })}
                    onSubmit={() => dispatch({ type: 'send' })}
                    onCancel={() => dispatch({ type: 'cancel' })}
                  />
                  <div className="flex items-center gap-2">
                    <Button onClick={() => dispatch({ type: 'send' })} disabled={!canSend(view) || sending} aria-keyshortcuts="Meta+Enter Control+Enter">
                      {sending && <Spinner tone="inherit" />}
                      {sending ? t('feedbackSending') : t('feedbackSend')}
                    </Button>
                    {chat && <NoticeButton action={{ label: t('betaChat'), icon: <TelegramLogo weight="fill" />, onClick: () => openBetaChat(chat) }} />}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
      {!plaque && !direct && (
        <CloseButton label={t('close')} onClick={() => dispatch({ type: 'close' })} className={cn('right-4 size-10', inForm && 'top-4 translate-y-0')} disabled={sending} />
      )}
    </section>
  );
}
