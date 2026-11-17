// Сценарии «titles» и «titles-en»: встречи с названиями по умолчанию («Meeting 16_11_26_15_02_11»),
// как их оставляет запись, и «ответы модели» для команды api_generate_title_text. Нужны для
// снимков «до и после» названий встреч и для проверки действия «Придумать названия для старых
// встреч». Тексты и названия вымышленные.

import { createFullMeetings } from './meetings';
import { createDemoEnMeetings } from './demo-en';
import type { MockMeeting } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Название по умолчанию, как у useRecordingStart: «Meeting ДД_ММ_ГГ_ЧЧ_ММ_СС». */
export function defaultTitle(iso: string): string {
  const d = new Date(iso);
  return `Meeting ${pad(d.getDate())}_${pad(d.getMonth() + 1)}_${pad(d.getFullYear() % 100)}_${pad(d.getHours())}_${pad(d.getMinutes())}_${pad(d.getSeconds())}`;
}

/** Что «ответит модель» по встрече: тема, 2-3 слова, без имён и сумм. */
export const TITLE_ANSWERS: Record<string, string> = {
  'mock-standup-0930': 'Блокеры по релизу',
  'mock-sync-granat': 'Подготовка релиза',
  'mock-retro-41': 'Итоги спринта',
  'mock-client-kedr': 'Условия пилота',
  'mock-session-training': 'Учебная сессия',
  'mock-design-weekly': 'Обзор дизайн-задач',
  'mock-budget-q4': 'Бюджет на квартал',
  'mock-interview-analyst': 'Интервью аналитика',
  'mock-vendor-harbor': 'Работа с подрядчиком',
  'demo-sync-weekly': 'Weekly priorities',
  'demo-planning-onboarding': 'Onboarding v2 scope',
  'demo-support-sync': 'Support backlog',
  'demo-design-billing': 'Billing page feedback',
  'demo-interview-admin': 'Admin pain points',
  'demo-client-harbor': 'Rollout questions',
  'demo-roadmap-q1': 'Q1 roadmap',
  'demo-retro-42': 'Release 4.2 lessons',
};

/** Встречи, которые остаются короткими (меньше минуты): названия им не придумываются, это видно в «после». */
const KEEP_SHORT = new Set(['mock-session-training', 'demo-support-sync']);

/** Реплики растягиваются до настоящей длины встречи: в вымышленных их мало, а названия положены встречам от минуты. */
function stretch(m: MockMeeting, minutes: number): MockMeeting {
  const last = m.transcripts[m.transcripts.length - 1]?.audio_end_time ?? 0;
  if (!last) return m;
  const k = (minutes * 60) / last;
  const r = (x: number) => Math.round(x * k * 10) / 10;
  return { ...m, transcripts: m.transcripts.map((t) => ({ ...t, audio_start_time: r(t.audio_start_time), audio_end_time: r(t.audio_end_time), duration: r(t.duration) })) };
}

/** Дата встречи: N дней назад в заданное время; список показывает группы «Сегодня», «Вчера», «На этой неделе», «Раньше». */
function redate(m: MockMeeting, daysAgo: number, hour: number, minute: number): MockMeeting {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 7, 0);
  return { ...m, created_at: d.toISOString(), updated_at: d.toISOString() };
}

const MINUTES = [29, 14, 41, 23, 8, 37, 19, 52, 26];
const WHEN: Array<[number, number, number]> = [[0, 9, 30], [0, 15, 2], [1, 11, 0], [2, 16, 45], [3, 10, 10], [5, 14, 30], [9, 12, 0], [14, 17, 20], [20, 10, 40]];

function retitle(list: MockMeeting[], redated: boolean): MockMeeting[] {
  return list.map((m, i) => {
    let out = KEEP_SHORT.has(m.id) ? m : stretch(m, MINUTES[i % MINUTES.length]);
    if (redated) out = redate(out, ...WHEN[i % WHEN.length]);
    return { ...out, title: defaultTitle(out.created_at) };
  });
}

export const createTitlesMeetings = () => retitle(createFullMeetings(), true);
export const createTitlesEnMeetings = () => retitle(createDemoEnMeetings(), false);
