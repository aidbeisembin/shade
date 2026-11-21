// Карточка после «Остановить» в доке, на месте кнопки записи (RecordDock, docs/ui/notifications.md):
// одна и та же карточка меняет состояние на месте, одной ширины: «Дописываю реплики» →
// «Сохраняю» (крутилка) → «Встреча сохранена» с «Открыть» (галочка) → снова кнопка записи.
// Запись отбракована: «Пустая запись», «Речи не было» с «Проверить звук», «Речь не распознана»
// (значок «i», подпись - что с данными). Проверка моделью убрала встречу в корзину: «Мало
// содержания» / «Запись в корзине» с «Вернуть». Срок: итог без действия 4 с, с действием 8 с
// (notice-timing.ts), под указателем, в фокусе и с открытой «Проверить звук» время стоит.
// Одно устройство сообщения Shade (ui/notice.tsx).
// FinishGlyph (полосы волны) остался только на экране записи, «Слушаю» (pages/Recording.tsx).
'use client';

import { useEffect, useState } from 'react';
import { CheckFat } from '@phosphor-icons/react';
import { Notice, NoticeButton } from '@/shade/components/ui/notice';
import { resultTimeout } from '@/shade/lib/notice-timing';
import { SoundCheckDialog } from '@/shade/components/SoundCheck';
import { displayTitleBrief } from '@/shade/lib/format';
import { t, type StringKey } from '@/shade/strings';
import { useLang } from '@/shade/lib/lang';

export type FinishCardStage = 'transcribing' | 'saving' | 'saved' | 'discarded';
/** Почему записи нет в списке (recording-outcome.tsx, DiscardVerdict). */
export type DiscardReason = 'empty' | 'no-speech' | 'unrecognized' | 'low-content';

/** Через сколько «Встреча сохранена» (с «Открыть») уходит сама, если её не трогать. */
export const SAVED_CARD_MS = resultTimeout(true);

/** Ширина карточки дока: та же, что у угла (lib/notice-stack.ts, CORNER_WIDTH), шире только по содержимому. */
export const DOCK_CARD = 'w-max min-w-[min(500px,calc(100vw-8rem))] max-w-full';

const BARS = [0, 1, 2];

/** Знак шага: три полосы и галочка, положение задаёт data-stage (globals.css). */
export function FinishGlyph({ stage }: { stage: FinishCardStage }) {
  return (
    <span className="shade-fg" data-stage={stage} aria-hidden>
      {BARS.map((i) => (
        <span key={i} className="shade-fg-bar" style={{ ['--i' as string]: i }}>
          <span className="shade-fg-in" />
        </span>
      ))}
      <CheckFat className="shade-fg-check" />
    </span>
  );
}

const DISCARD_TITLE: Record<DiscardReason, StringKey> = {
  empty: 'discardedEmpty',
  'no-speech': 'discardedSilent',
  unrecognized: 'discardedUnrecognized',
  'low-content': 'lowContentTitle',
};

/** Подпись отбракованной записи: что с данными. */
const DISCARD_HINT: Record<DiscardReason, StringKey> = {
  empty: 'discardedNotSaved',
  'no-speech': 'discardedNotSaved',
  unrecognized: 'discardedUnrecognizedHint',
  'low-content': 'lowContentHint',
};

interface FinishCardProps {
  stage: FinishCardStage;
  /** Название встречи (как в ядре); подписью под шагом. */
  title?: string | null;
  reason?: DiscardReason;
  onOpen?: () => void;
  /** «Мало содержания»: вернуть встречу из корзины в список. */
  onUndo?: () => void;
  onClose?: () => void;
  /** Задержать уход карточки ('hover', 'focus', 'dialog'): у отбракованной время ведёт провайдер. */
  onHold?: (reason: string, on: boolean) => void;
  /** Предпросмотр и уходящая копия: без таймеров и клавиш. */
  still?: boolean;
}

export function FinishCard({ stage, title, reason = 'empty', onOpen, onUndo, onClose, onHold, still }: FinishCardProps) {
  useLang();
  const [soundCheck, setSoundCheck] = useState(false);
  const [held, setHeld] = useState(false);
  const hold = (why: string, on: boolean) => {
    if (why !== 'dialog') setHeld(on);
    onHold?.(why, on);
  };
  const closable = stage === 'saved' || stage === 'discarded';
  const suspectSound = stage === 'discarded' && reason === 'no-speech';

  // «Встреча сохранена» уходит сама через 8 с (с действием); под указателем и в фокусе ждёт
  useEffect(() => {
    if (still || stage !== 'saved' || held || !onClose) return;
    const id = window.setTimeout(onClose, SAVED_CARD_MS);
    return () => window.clearTimeout(id);
  }, [still, stage, held, onClose]);

  // Esc закрывает итог (если не открыта «Проверить звук»)
  useEffect(() => {
    if (still || !closable || !onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !soundCheck && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [still, closable, onClose, soundCheck]);

  // Пока открыта «Проверить звук», карточка не уходит: иначе диалог закрылся бы вместе с ней
  useEffect(() => onHold?.('dialog', soundCheck), [onHold, soundCheck]);

  const name = title ? displayTitleBrief(title) : null;
  const heading =
    stage === 'transcribing' ? t('finishTranscribing') : stage === 'saving' ? t('finishSaving') : stage === 'saved' ? t('finishSaved') : t(DISCARD_TITLE[reason]);
  const action =
    stage === 'saved' && onOpen
      ? { label: t('finishOpen'), onClick: onOpen }
      : stage === 'discarded' && reason === 'low-content' && onUndo
        ? { label: t('undoDelete'), onClick: onUndo }
        : suspectSound
          ? { label: t('soundCheck'), onClick: () => setSoundCheck(true) }
          : null;

  return (
    <>
      <Notice
        role="status"
        aria-live="polite"
        data-shade-finish={stage}
        data-shade-reason={stage === 'discarded' ? reason : undefined}
        // pointerenter не приходит, если карточка появилась под неподвижным курсором (там была «Остановить»)
        onPointerMove={() => !held && hold('hover', true)}
        onPointerLeave={() => hold('hover', false)}
        onFocus={() => hold('focus', true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && hold('focus', false)}
        // Ширина одна на всех шагах: карточка не прыгает, меняются только знак и текст
        className={DOCK_CARD}
        icon={stage === 'transcribing' || stage === 'saving' ? 'progress' : stage === 'saved' ? 'done' : 'info'}
        title={
          <span key={heading} className="shade-fg-text block truncate">
            {heading}
          </span>
        }
        hint={stage !== 'discarded' ? (name ?? undefined) : t(DISCARD_HINT[reason])}
        actions={action && <NoticeButton action={action} />}
        onClose={closable ? onClose : undefined}
        closeLabel={t('close')}
      />
      {suspectSound && !still && <SoundCheckDialog open={soundCheck} onOpenChange={setSoundCheck} />}
    </>
  );
}
