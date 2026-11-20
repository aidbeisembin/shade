// Название встречи: кто, когда и кому может отправлять текст, и что делать с ответом (ядро решений,
// без Tauri и без экрана; настоящие зависимости и запуск в title-service.ts).
// Чистая часть (запрос, чистка ответа, «годится ли») в meeting-title.ts; ядро (запрос к
// модели итогов, запись названия с проверкой, пометка «задал человек») в
// src-tauri/src/summary/title.rs. Здесь связка: createTitler(deps) с подставляемыми
// зависимостями (тесты title-core.test.ts идут на подставных), titler на настоящих.
//
// Режимы запуска (mode):
// - auto: сама, после «Остановить» и после «Распознать заново». Только локальная модель
//   (privacy.ts: builtin-ai, Ollama на этом компьютере). Облачному провайдеру ничего не уходит.
// - after-summary: человек нажал «Подвести итоги», текст уже уходит этому провайдеру,
//   название создаётся вместе с итогами (watchSummary).
// Названия для старых встреч и «Придумать заново» убраны по просьбе владельца (2026-11-17):
// название придумывается только по двум путям выше.
// Любая неудача: название остаётся прежним (датой), без уведомлений, причина в журнале.

import { countWords } from './speech';
import {
  buildTitlePrompt,
  checkTitleAnswer,
  detectMeetingLang,
  ineligibleReason,
  sampleTranscript,
  type TitleLang,
} from './meeting-title';

/** Где обрабатывается модель итогов: как в privacy.ts. */
export type PrivacyLevel = 'local' | 'cloud' | 'unknown';

export type TitleMode = 'auto' | 'after-summary';

export type SkipReason =
  | 'no-model'
  | 'cloud-not-allowed'
  | 'manual'
  | 'not-default'
  | 'too-short'
  | 'no-text'
  | 'bad-answer'
  | 'error'
  | 'missing'
  | 'changed'
  | 'trashed'
  | 'busy';

export type TitleOutcome = { status: 'set'; title: string } | { status: 'skipped'; reason: SkipReason; detail?: string };

export interface ModelInfo {
  configured: boolean;
  level: PrivacyLevel;
  provider: string | null;
}

export interface MeetingForTitle {
  id: string;
  title: string;
  durationSec: number | null;
  /** Реплики встречи после чистки галлюцинаций. */
  texts: string[];
}

export type SetResult = 'set' | 'manual' | 'changed' | 'missing' | 'rejected';

export interface TitleDeps {
  model(): Promise<ModelInfo>;
  load(id: string): Promise<MeetingForTitle | null>;
  origin(id: string): Promise<'manual' | 'auto' | null>;
  generate(system: string, user: string, allowCloud: boolean): Promise<string>;
  setAuto(id: string, expected: string, title: string): Promise<SetResult>;
  summaryStatus(id: string): Promise<string>;
  trashed(id: string): boolean;
  uiLang(): TitleLang;
  sleep(ms: number): Promise<void>;
  log(entry: TitleLog): void;
  /** Название записано: список и страница встречи обновляются. */
  announce(id: string, title: string): void;
  /**
   * Модель придумывает название (true) и закончила (false), чем бы ни кончилось: экран
   * показывает перелив на дате. Только вокруг запроса к модели, проверки до него не в счёт.
   */
  progress?(id: string, generating: boolean): void;
}

/** Запись журнала: структура, а не текст (текст собирает console в настоящих зависимостях, тесты читают поля). */
export type TitleLog =
  | { event: 'skip'; id: string; reason: SkipReason; detail?: string }
  | { event: 'set'; id: string; mode: TitleMode; lang: TitleLang };

export interface TitleOptions {
  mode: TitleMode;
}

/** Сколько ждать итогов (мс), прежде чем перестать следить: итоги, которые длятся дольше, не наш случай. */
const WATCH_POLL_MS = 3000;
const WATCH_MAX_MS = 30 * 60_000;
/** Итоги так и не начались за это время (запуск не состоялся): следить не за чем. */
const WATCH_START_MS = 60_000;

export function createTitler(deps: TitleDeps) {
  const inflight = new Set<string>();
  const watching = new Set<string>();

  const skip = (id: string, reason: SkipReason, detail?: string): TitleOutcome => {
    deps.log({ event: 'skip', id, reason, detail });
    return { status: 'skipped', reason, detail };
  };

  async function titleOne(id: string, opts: TitleOptions): Promise<TitleOutcome> {
    if (inflight.has(id)) return skip(id, 'busy');
    inflight.add(id);
    let generating = false;
    try {
      // Сети и текста ещё нет: сначала то, что решается без них
      const model = await deps.model().catch(() => null);
      if (!model || !model.configured) return skip(id, 'no-model');
      // Облако: только если человек сам запустил то, что и так отправляет текст провайдеру
      const allowCloud = opts.mode === 'after-summary';
      if (model.level !== 'local' && !allowCloud) return skip(id, 'cloud-not-allowed', model.provider ?? undefined);
      if (deps.trashed(id)) return skip(id, 'trashed');
      if ((await deps.origin(id).catch(() => null)) === 'manual') return skip(id, 'manual');

      const meeting = await deps.load(id).catch(() => null);
      if (!meeting) return skip(id, 'missing');
      const why = ineligibleReason({ title: meeting.title, durationSec: meeting.durationSec, words: countWords(meeting.texts.join(' ')) });
      if (why) return skip(id, why);

      const text = meeting.texts.join(' ');
      const lang = detectMeetingLang(text, deps.uiLang());
      const prompt = buildTitlePrompt(sampleTranscript(meeting.texts), lang);
      let answer: string;
      generating = true;
      deps.progress?.(id, true);
      try {
        answer = await deps.generate(prompt.system, prompt.user, allowCloud);
      } catch (error) {
        const message = String(error);
        if (message.includes('model-not-configured')) return skip(id, 'no-model');
        if (message.includes('cloud-not-allowed')) return skip(id, 'cloud-not-allowed');
        return skip(id, 'error', message.slice(0, 160));
      }
      const checked = checkTitleAnswer(answer, lang);
      if (!checked.ok) return skip(id, 'bad-answer', checked.reason);
      const result = await deps.setAuto(id, meeting.title, checked.title).catch((e) => `error:${String(e)}`);
      if (result !== 'set') {
        const reason: SkipReason = result === 'manual' || result === 'changed' || result === 'missing' ? result : 'error';
        return skip(id, reason, result.startsWith('error:') ? result.slice(0, 160) : undefined);
      }
      deps.log({ event: 'set', id, mode: opts.mode, lang });
      deps.announce(id, checked.title);
      return { status: 'set', title: checked.title };
    } finally {
      inflight.delete(id);
      if (generating) deps.progress?.(id, false);
    }
  }

  /**
   * «Подвести итоги» нажато: когда итоги готовы, название создаётся вместе с ними. Следим по
   * состоянию итогов в ядре, а не по открытой странице: человек мог уйти на главную.
   */
  async function watchSummary(id: string): Promise<void> {
    if (watching.has(id)) return;
    watching.add(id);
    try {
      let seenWork = false;
      for (let waited = 0; waited < WATCH_MAX_MS; waited += WATCH_POLL_MS) {
        const status = (await deps.summaryStatus(id).catch(() => '')).toLowerCase();
        if (status === 'completed') {
          await titleOne(id, { mode: 'after-summary' });
          return;
        }
        if (['processing', 'pending', 'started', 'running', 'summarizing', 'regenerating'].includes(status)) seenWork = true;
        // Ошибка, отмена: итогов нет, и названия «вместе с ними» тоже
        else if (['failed', 'error', 'cancelled'].includes(status) || (seenWork && status === 'idle')) return;
        if (!seenWork && waited >= WATCH_START_MS) return;
        await deps.sleep(WATCH_POLL_MS);
      }
    } finally {
      watching.delete(id);
    }
  }

  return {
    titleOne,
    watchSummary,
  };
}

/**
 * Ждёт, пока условие истинно (идёт запись), не дольше tries * ms. Возвращает true, если условие
 * так и не стало ложным: тогда называть встречу сейчас нельзя (модель делила бы процессор с распознаванием).
 */
export async function stillBusy(busy: () => boolean, tries: number, ms: number, sleep: (ms: number) => Promise<unknown>): Promise<boolean> {
  for (let i = 0; i < tries && busy(); i++) await sleep(ms);
  return busy();
}
