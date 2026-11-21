// Действия со встречей для списка и страницы встречи: те же команды ядра,
// что вызывает сайдбар оригинала (api_save_meeting_title, api_delete_meeting,
// open_meeting_folder). Удаление кладёт встречу и папку записи в корзину на TRASH_TTL_DAYS
// дней (30, discard-policy.ts; meeting-trash.ts); строки базы стираются по сроку.
'use client';

import { invoke } from '@tauri-apps/api/core';
import { trashMeeting } from './meeting-trash';
import { notifyTrashed } from './corner-messages';
import { markTitleManual } from './title-service';

export async function renameMeeting(meetingId: string, title: string) {
  // Пометка «название задал человек» до записи: после неё автоматика встречу не трогает
  // (title-service.ts, ядро summary/title.rs). Не записалась: название всё равно сохраняется
  await markTitleManual(meetingId);
  await invoke('api_save_meeting_title', { meetingId, title });
}

/** Удаление человеком: в корзину на 30 дней, оттуда можно вернуть (meeting-trash.ts). */
export async function deleteMeeting(meetingId: string) {
  await trashMeeting(meetingId);
}

/** Уведомление в углу после удаления: «Встреча в корзине» и «Вернуть»; вторая склеивается с первой (corner-messages.ts). */
export function toastTrashed(meetingId: string, title?: string | null) {
  notifyTrashed({ id: meetingId, title });
}

export async function openMeetingFolder(meetingId: string) {
  await invoke('open_meeting_folder', { meetingId });
}
