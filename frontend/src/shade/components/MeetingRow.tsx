// Строка списка встреч: состояние встречи иконкой и словами, переименование
// прямо в строке, удаление с подтверждением. Кнопки появляются при наведении
// и при фокусе с клавиатуры; те же действия есть в меню по правому клику.
'use client';

import { useState } from 'react';
import { meetingHref, openMeeting } from '@/shade/lib/open-meeting';
import {
  CaretRight,
  ChatText,
  FolderOpen,
  PencilSimple,
  Sparkle,
  Trash,
  type Icon,
} from '@phosphor-icons/react';
import { Spinner } from '@/shade/components/ui/spinner';
import { Button } from '@/shade/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shade/components/ui/tooltip';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/shade/components/ui/context-menu';
import { editableTitle, formatOffset, formatRowDate, formatTime, formatVolume, shownTitle } from '@/shade/lib/format';
import type { TranscriptMatch } from '@/shade/lib/transcript-search';
import { InlineRename } from '@/shade/components/InlineRename';
import { TitlePixels, TitleRevealText } from '@/shade/components/TitleReveal';
import type { MeetingDetails, MeetingStatus } from '@/shade/lib/meeting-details-cache';
import { cn } from '@/shade/lib/utils';
import { t, tp, type StringKey } from '@/shade/strings';
import { useLang } from '@/shade/lib/lang';
import { recoveredLabel, useRecoveredMark } from '@/shade/lib/crash-recovery';
import { MicrophoneSlash } from '@/shade/components/icons';

export interface MeetingListItem {
  id: string;
  title: string;
  created_at?: string;
  /** Папка записи из метаданных: по ней узнаются пометки Shade (recording-marks.ts). */
  folder_path?: string | null;
  /** Число реплик; null, если не удалось узнать. 0: запись без текста. */
  transcriptCount?: number | null;
  /** Догружается после списка; null, пока не пришло. */
  details: MeetingDetails | null;
}

// Цвет иконки по роли: итоги Indigo (ИИ), «Не распознано» Giants, транскрипт серый
const STATUS: Record<Exclude<MeetingStatus, 'unknown'>, { icon: Icon | null; label: StringKey; className: string }> = {
  summary: { icon: Sparkle, label: 'statusSummary', className: 'text-indigo-ink' },
  // Итоги в работе: общий Spinner вместо иконки (см. ниже)
  summarizing: { icon: null, label: 'statusSummarizing', className: '' },
  transcript: { icon: ChatText, label: 'statusTranscript', className: 'text-muted-foreground' },
  silent: { icon: MicrophoneSlash, label: 'statusSilent', className: 'text-giants-ink' },
};

/** Миниатюра состояния: круг 48 px на ступени тона, иконка 20 px в цвете роли. */
export function StatusThumb({ kind }: { kind: MeetingStatus }) {
  const status = kind !== 'unknown' ? STATUS[kind] : null;
  const Glyph = status?.icon;
  return (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-input" aria-hidden>
      {kind === 'summarizing' ? <Spinner /> : Glyph ? <Glyph className={cn('size-5', status?.className)} /> : null}
    </span>
  );
}

/**
 * Встреча, которая ещё обрабатывается после «Остановить»: первой строкой списка, в
 * миниатюре спиннер, под названием время и шаг. Та же геометрия, что у MeetingRow, без
 * действий и без перехода: встречи в базе ещё нет. Когда сохранится, на её месте
 * встанет обычная строка (Home.tsx). Названия ещё нет: вместо него и даты полоса пикселей.
 */
export function PendingRow({ stage, done = false }: { stage: string; done?: boolean }) {
  useLang();
  const now = formatTime(new Date());
  return (
    <li className="flex min-h-[64px] select-none items-center gap-3 rounded-nested py-2 pl-2 pr-3" aria-busy={!done} data-shade-pending>
      {/* Сохранена, а список ещё не перечитан (доли секунды): знак транскрипта вместо спиннера */}
      <StatusThumb kind={done ? 'transcript' : 'summarizing'} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium">
          <TitlePixels />
        </span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground" role="status">
          <span className="sr-only">, </span>
          {[now, stage].filter(Boolean).join(' · ')}
        </span>
      </span>
    </li>
  );
}

function IconAction({
  label,
  ariaLabel,
  onClick,
  children,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-full text-muted-foreground [&_svg]:size-5"
          onClick={onClick}
          aria-label={ariaLabel}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface MeetingRowProps {
  meeting: MeetingListItem;
  onRename: (title: string) => Promise<void>;
  onDelete: () => void;
  onOpenFolder: () => void;
  /** В группе «Сегодня» и «Вчера» дата в заголовке группы, в строке только время. */
  timeOnly?: boolean;
  /** Совпадение поиска в тексте встречи: фрагмент с подсветкой под названием. */
  match?: TranscriptMatch | null;
}

export function MeetingRow({ meeting, onRename, onDelete, onOpenFolder, timeOnly, match }: MeetingRowProps) {
  useLang();
  const [editing, setEditing] = useState(false);
  const recovered = useRecoveredMark(meeting.id);
  const d = meeting.details;
  const shown = shownTitle(meeting.title, d?.contentTitle);
  const kind = d?.status ?? 'unknown';
  const status = kind !== 'unknown' ? STATUS[kind] : null;
  // Дата и время есть всегда, перед длительностью: «16 нояб., 15:02 · 29 мин · 1 953 слова». Название-тема
  // даты не говорит, а у названия по дате («Встреча 16 ноября, 15:02») строка не меняется,
  // когда название придумано: ни мигания, ни сдвига (docs/ui/meetings-list.md)
  const date = meeting.created_at ? (timeOnly ? formatTime(meeting.created_at) : formatRowDate(meeting.created_at)) : null;
  // Полезное вместо «Только транскрипт»: длительность и объём. «Итоги готовы» словами
  // не повторяется в каждой строке: это знак Sparkle, подпись есть у диктора
  const volume = kind === 'transcript' || kind === 'summary' || kind === 'summarizing' ? formatVolume(d?.durationSec, d?.words) : null;
  const label = kind === 'transcript' || kind === 'summary' || !status ? null : t(status.label);
  const meta = [date, volume, label, recovered ? recoveredLabel(recovered) : null].filter(Boolean).join(' · ');

  const begin = () => setEditing(true);

  if (editing) {
    return (
      // Без подложки; поле и кнопки в высоту строки (64 px), чтобы список не прыгал
      <li className="flex min-h-[64px] items-center">
        <InlineRename
          className="flex-1"
          initial={editableTitle(meeting.title, d?.contentTitle)}
          onSave={onRename}
          onClose={() => setEditing(false)}
          inputClassName="h-16 text-base font-medium"
          buttonClassName="size-16"
        />
      </li>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          // Вся строка открывает встречу: клик по шеврону и полям мимо ссылки тоже.
          // Кнопки действий и поле переименования не открывают (свои обработчики).
          onClick={(e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            if ((e.target as HTMLElement).closest('a, button, input, [role="menuitem"]')) return;
            openMeeting(meeting.id);
          }}
          className={cn(
            // Без вложенной карточки: строки разделены отступом, подложка только при наведении
            'group relative flex min-h-[64px] cursor-pointer select-none items-center gap-2 rounded-nested pr-3 transition-colors hover:bg-muted has-[:focus-visible]:bg-muted data-[state=open]:bg-muted',
          )}
        >
          <a
            href={meetingHref(meeting.id)}
            // WebKit на macOS даёт тянуть ссылку: лёгкое движение при нажатии начинает
            // перетаскивание вместо клика (в Tauri его ещё перехватывает обработчик файлов)
            draggable={false}
            onClick={(e) => {
              // Встреча открывается на главной без перехода между страницами (open-meeting.ts)
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              openMeeting(meeting.id);
            }}
            className="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-nested py-2 pl-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <StatusThumb kind={kind} />
            <span className="min-w-0 flex-1">
              <TitleRevealText id={meeting.id} text={shown} className="block truncate text-base font-medium" title={shown} />
              {/* Разделители для диктора: иначе имя ссылки читается слитно, «НазваниеСегодня, 10:00» */}
              {kind === 'summary' && <span className="sr-only">, {t('statusSummary')}</span>}
              {meta && (
                <span className="mt-0.5 block truncate text-sm text-muted-foreground" title={meta}>
                  <span className="sr-only">, </span>
                  {meta}
                </span>
              )}
              {match && (
                <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground" data-shade-match>
                  <span className="sr-only">, {t('foundInText')}: </span>
                  {match.start !== null && <span className="tabular mr-1.5 text-xs">{formatOffset(match.start)}</span>}
                  {match.before}
                  <mark className="rounded-[3px] bg-primary/20 text-foreground">{match.hit}</mark>
                  {match.after}
                  {match.hits > 1 && <span className="ml-1.5 whitespace-nowrap text-xs">{tp('searchMoreHits', match.hits - 1)}</span>}
                </span>
              )}
            </span>
          </a>
          {/* Только у строки под курсором или с фокусом от клавиатуры: после клика не залипают */}
          <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100">
            <IconAction label={t('rename')} ariaLabel={`${t('rename')}: ${shown}`} onClick={begin}>
              <PencilSimple />
            </IconAction>
            <IconAction label={t('delete')} ariaLabel={`${t('delete')}: ${shown}`} onClick={onDelete}>
              <Trash />
            </IconAction>
          </div>
          {/* Шеврон: исключение из правила fill (docs/ui/foundations.md) */}
          <CaretRight weight="bold" className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={begin}>
          <PencilSimple />
          {t('rename')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onOpenFolder}>
          <FolderOpen />
          {t('openRecordingFolder')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={onDelete}>
          <Trash />
          {t('delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
