// Название встречи: настоящие зависимости (ядро Tauri, корзина, язык интерфейса) для createTitler
// из title-core.ts и точки входа для экранов: titler, onTitleSet,
// markTitleManual, titleMany. Правила и тесты: title-core.ts, meeting-title.ts.

import { invoke } from '@tauri-apps/api/core';
import { cleanSegments, isShownText } from './speech';
import { toSegment } from './meeting';
import { pickDuration, recordedSeconds } from './recording-duration';
import { isTrashed } from './meeting-trash';
import { getLang } from './lang';
import { createTitler, type SetResult, type TitleDeps } from './title-core';

export type { ModelInfo, SkipReason, TitleLog, TitleMode, TitleOutcome } from './title-core';
export { createTitler, stillBusy } from './title-core';

// --- настоящие зависимости ------------------------------------------------------

const TITLE_EVENT = 'shade-title-set';

export function onTitleSet(fn: (id: string, title: string) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (e: Event) => {
    const d = (e as CustomEvent<{ id: string; title: string }>).detail;
    if (d) fn(d.id, d.title);
  };
  window.addEventListener(TITLE_EVENT, handler);
  return () => window.removeEventListener(TITLE_EVENT, handler);
}

interface TranscriptRow {
  text?: string;
  audio_end_time?: number;
}

const realDeps: TitleDeps = {
  async model() {
    const cfg = await invoke<{ provider?: string | null; model?: string | null; ollamaEndpoint?: string | null } | null>('api_get_model_config');
    const configured = Boolean(cfg?.provider && cfg?.model);
    // privacy.ts тянет подписки на события Tauri: подключаем в момент вызова, а не при загрузке модуля
    const { summaryPrivacy } = await import('./privacy');
    const p = summaryPrivacy(cfg?.provider, cfg?.ollamaEndpoint);
    return { configured, level: configured ? p.level : 'unknown', provider: p.provider };
  },
  async load(id) {
    const [meta, page] = await Promise.all([
      invoke<{ title?: string; folder_path?: string | null } | null>('api_get_meeting_metadata', { meetingId: id }),
      invoke<{ transcripts?: TranscriptRow[] }>('api_get_meeting_transcripts', { meetingId: id, limit: 5000, offset: 0 }),
    ]);
    if (!meta) return null;
    const list = page?.transcripts ?? [];
    const recorded = await recordedSeconds(meta.folder_path);
    const texts = cleanSegments(list.map((t) => ({ text: toSegment(t as never).text })).filter((s) => isShownText(s.text))).map((s) => s.text);
    return { id, title: meta.title ?? '', durationSec: pickDuration(recorded, list[list.length - 1]?.audio_end_time), texts };
  },
  async origin(id) {
    return (await invoke<'manual' | 'auto' | null>('api_get_title_origin', { meetingId: id })) ?? null;
  },
  generate: (system, user, allowCloud) => invoke<string>('api_generate_title_text', { systemPrompt: system, userPrompt: user, allowCloud }),
  async setAuto(id, expected, title) {
    return invoke<SetResult>('api_set_auto_title', { meetingId: id, expectedTitle: expected, newTitle: title });
  },
  async summaryStatus(id) {
    const res = await invoke<{ status?: string } | null>('api_get_summary', { meetingId: id });
    return res?.status ?? '';
  },
  trashed: (id) => isTrashed(id),
  uiLang: () => getLang(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log(entry) {
    // Журнал разработчика (консоль окна): без текста встречи и без самого названия
    if (entry.event === 'skip') console.info(`[shade] Название встречи ${entry.id}: остаётся прежним (${entry.reason}${entry.detail ? `: ${entry.detail}` : ''})`);
    else console.info(`[shade] Название встречи ${entry.id}: записано (${entry.mode}, ${entry.lang})`);
  },
  announce(id, title) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TITLE_EVENT, { detail: { id, title } }));
  },
};

export const titler = createTitler(realDeps);

/** Человек переименовал встречу: пометка «моё название» до записи названия, дальше автоматика встречу не трогает. */
export async function markTitleManual(meetingId: string): Promise<void> {
  try {
    await invoke('api_mark_title_manual', { meetingId });
  } catch (error) {
    // Пометка не записалась: название всё равно сохраняется; от перезаписи его бережёт и проверка «ожидаемое → новое»
    console.warn('[shade] Пометка «название задал человек» не записана:', error);
  }
}

/** По одной, в фоне: встречи, восстановленные после сбоя, и другие списки id. Каждая только по правилам режима auto. */
export async function titleMany(ids: string[]): Promise<void> {
  for (const id of ids) await titler.titleOne(id, { mode: 'auto' }).catch(() => undefined);
}
