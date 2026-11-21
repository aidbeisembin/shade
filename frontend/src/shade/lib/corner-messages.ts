// Сообщения угла с правилами склейки (docs/ui/notifications.md): кто что показывает в правом
// нижнем углу. Однотипные склеиваются в одну карточку (lib/corner.ts, group):
//  - корзина: «Встреча в корзине» → «2 встречи в корзине», «Вернуть» возвращает все;
//  - возврат из корзины: «Встреча восстановлена» → «2 встречи восстановлены»;
//  - восстановление после сбоя: одна встреча с «Открыть», две и больше - «Восстановлено
//    2 встречи» с «Показать» (список встреч); без таймера: после сбоя человек смотрит не сразу.
'use client';

import { corner } from './corner';
import { displayTitleBrief, formatDuration } from './format';
import { openMeeting } from './open-meeting';
import { shadeToast } from './toasts';
import { t, tDays, tp } from '@/shade/strings';

export interface MeetingRef {
  id: string;
  title?: string | null;
}

/** Вернуть из корзины по «Вернуть»: каждую встречу, итог - «Встреча восстановлена» (склеивается). */
export async function restoreFromTrash(items: MeetingRef[], restore?: (id: string) => Promise<void>): Promise<void> {
  // Корзина подгружается по нажатию: модулю сообщений не нужны плагины файлов Tauri при загрузке
  const run = restore ?? (await import('./meeting-trash')).restoreMeeting;
  for (const m of items) {
    try {
      await run(m.id);
      notifyRestored(m);
    } catch (error) {
      shadeToast.error(t('restoreFailed'), { description: String(error) });
    }
  }
}

/** «Встреча в корзине» с «Вернуть»; вторая встреча за срок карточки склеивается с первой. */
export function notifyTrashed(m: MeetingRef, restore?: (id: string) => Promise<void>): string {
  return corner.show<MeetingRef>({
    group: 'trash',
    payload: m,
    view: (items) => ({
      icon: 'done',
      title: items.length === 1 ? t('deleted') : tp('deletedMany', items.length),
      hint: tDays('deletedHint'),
      action: { label: t('undoDelete'), onClick: () => void restoreFromTrash(items, restore) },
    }),
  });
}

/** «Встреча восстановлена» (из корзины); несколько подряд - одна карточка. */
export function notifyRestored(m: MeetingRef): string {
  return corner.show<MeetingRef>({
    group: 'restored',
    payload: m,
    view: (items) =>
      items.length === 1
        ? { icon: 'done', title: t('restored'), hint: items[0].title ? displayTitleBrief(items[0].title) : undefined }
        : { icon: 'done', title: tp('restoredMany', items.length), hint: t('restoredManyHint') },
  });
}

export interface RecoveredItem {
  meeting_id: string;
  title: string;
  duration_seconds: number | null;
  partial: boolean;
}

/** Показать список встреч (главная без открытой встречи и настроек). */
export function openMeetingList() {
  window.history.pushState(null, '', '/');
  window.scrollTo({ top: 0 });
}

/** Восстановлена после сбоя: одна - с «Открыть», несколько - одна карточка с «Показать». Без таймера. */
export function notifyRecovered(m: RecoveredItem): string {
  return corner.show<RecoveredItem>({
    group: 'recovered',
    payload: m,
    timeout: null,
    view: (items) => {
      if (items.length > 1) {
        return { icon: 'recovery', title: tp('recoveredManyTitle', items.length), hint: t('recoveredManyHint'), action: { label: t('recoveredShow'), onClick: openMeetingList } };
      }
      const one = items[0];
      return {
        icon: 'recovery',
        title: one.partial ? t('recoveredPartialHint') : t('recoveredHint'),
        hint: [displayTitleBrief(one.title), formatDuration(one.duration_seconds)].filter(Boolean).join(' · '),
        action: { label: t('finishOpen'), onClick: () => openMeeting(one.meeting_id) },
      };
    },
  });
}
