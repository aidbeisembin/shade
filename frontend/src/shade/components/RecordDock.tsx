// Док записи: место кнопки записи внизу по центру, только текущая запись (docs/ui/notifications.md, «Док»).
// В доке одно место, и оно по очереди:
// - покой: круглая кнопка лайм 104 px, на 28 px от низа, со знаком из полос звука и двумя мягкими
//   волнами; сочетание клавиш в подсказке;
// - запись: стеклянная капсула (.shade-glass): красная точка с кольцом на речь, таймер, полосы
//   уровня звука, «Пауза» и красная «Остановить»; над капсулой подсказки про микрофон и «Не слышу речи»;
// - после «Остановить»: кнопка превращается в карточку (FinishCard), та меняет состояние на месте:
//   «Дописываю реплики» → «Сохраняю» → итог («Встреча сохранена» и «Открыть», пустая запись, «Речи
//   не было» и «Проверить звук», «Речь не распознана», «Мало содержания» и «Вернуть») → снова кнопка;
// - проблема, мешающая записи («Нет доступа к микрофону», «Нет микрофона»): карточка на месте
//   кнопки сразу, как только проблема известна, и держится, пока она есть (MicNotices.tsx).
// Всё, что не про текущую запись («Доступна версия», «Как вам Shade?», корзина, восстановление),
// живёт в правом нижнем углу (CornerStack, lib/corner.ts): док ставит туда отзыв и обновление.
// Смена состояния появляется из размытия (.shade-dock-in, 240 мс), уходит без размытия (.shade-dock-out, 160 мс),
// только transform, opacity и filter; prefers-reduced-motion оставляет одну прозрачность.
// Страницы оставляют снизу запас --dock-space, капсула не закрывает последние строки.
//
// Полосы показывают уровень звука из ядра (событие recording-level, lib/recording-level.ts):
// тот же уровень ведёт свечение голоса (VoiceGlow) у плитки транскрипта. Кольцо вокруг
// точки вспыхивает на каждый сигнал детектора речи и каждую реплику.
'use client';

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MicrophoneSlash, Pause, Play, Stop } from '@phosphor-icons/react';
import { DOCK_CARD, FinishCard, type FinishCardStage, type DiscardReason } from '@/shade/components/FinishCard';
import { Button } from '@/shade/components/ui/button';
import { Spinner } from '@/shade/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shade/components/ui/tooltip';
import { SoundCheckDialog, silenceCause, useSoundState } from '@/shade/components/SoundCheck';
import { useRecordingControls, type FinishState } from '@/shade/lib/recording-controls';
import { previewFinish } from '@/shade/lib/finish-preview';
import { isMicBlocker } from '@/shade/lib/recording';
import { MicAccessCard, MicHint, micHintKind, type MicHintKind, type MicResolved } from '@/shade/components/MicNotices';
import { useRecordingOutcome } from '@/shade/lib/recording-outcome';
import { useNoticeStackAnchor } from '@/shade/lib/notice-stack';
import { Notice, NoticeButton } from '@/shade/components/ui/notice';
import { formatTimer } from '@/shade/lib/format';
import { onRecordingLevel, voiceAmount } from '@/shade/lib/recording-level';
import { cn } from '@/shade/lib/utils';
import { t } from '@/shade/strings';
import { useConfig } from '@/contexts/ConfigContext';
import { LANGUAGES } from '@/constants/languages';
import { useLang } from '@/shade/lib/lang';
import { FeedbackCard } from '@/shade/components/feedback/FeedbackCard';
import { DockLeave, LEAVE_MS } from '@/shade/components/DockLeave';
import { corner } from '@/shade/lib/corner';
import { RESULT_MS } from '@/shade/lib/notice-timing';
import { clearOffer, flushFeedbackOnLaunch, useOfferedMeeting } from '@/shade/lib/feedback/store';
import { trackLaunch } from '@/shade/lib/stats';
import { previewFeedback, previewMotion } from '@/shade/lib/feedback/preview';
import type { Flow } from '@/shade/lib/feedback/flow';
import { UpdateCard, isShownUpdate } from '@/shade/components/UpdateCard';
import { previewUpdate, scheduleChecks, updateController, useUpdatePhase, type UpdatePhase } from '@/shade/lib/updates';
import { shadeToast } from '@/shade/lib/toasts';

/** Через сколько секунд без единой осмысленной реплики показать «Не слышу речи». */
export const NO_SPEECH_HINT_SEC = 20;

const LEVEL_BARS = 9;
/** Шаг полос уровня, мс: новая полоса раз в 100 мс. */
const LEVEL_STEP_MS = 100;

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Точка записи с кольцом: вспышка на каждый сигнал речи (ключ меняется, анимация начинается заново). */
function ActivityDot({ pulse, paused }: { pulse: number; paused: boolean }) {
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center" aria-hidden>
      {!paused && pulse > 0 && <span key={pulse} className="shade-dock-speech absolute inset-0 rounded-full border-2 border-record" />}
      <span className={cn('size-3 rounded-full', paused ? 'bg-foreground/40' : 'shade-dock-dot shade-record-dot')} />
    </span>
  );
}

/**
 * Уровень звука: 9 полос, последние ~0,9 с по событию ядра recording-level (пик за каждые
 * 100 мс, новая полоса справа). Высоты ставятся прямо в DOM, без перерисовки React на
 * каждое событие; отдельного цикла кадров нет, ведёт само событие (~30 раз в секунду).
 * На паузе ядро молчит: полосы ложатся.
 */
function LevelBars({ paused }: { paused: boolean }) {
  const barsRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = barsRef.current;
    if (!root) return;
    const bars = Array.from(root.children) as HTMLElement[];
    const history: number[] = Array(LEVEL_BARS).fill(0);
    const paint = () =>
      history.forEach((v, i) => {
        const bar = bars[i];
        if (!bar) return;
        bar.style.transform = `scaleY(${paused ? 0.12 : 0.18 + v * 0.82})`;
        bar.style.opacity = !paused && v > 0.05 ? '1' : '0.35';
      });
    paint();
    if (paused) return;
    let peak = 0;
    let windowStart = performance.now();
    const off = onRecordingLevel((level) => {
      peak = Math.max(peak, voiceAmount(level));
      const now = performance.now();
      if (now - windowStart < LEVEL_STEP_MS) return;
      windowStart = now;
      history.shift();
      history.push(peak);
      peak = 0;
      paint();
    });
    return off;
  }, [paused]);
  return (
    <span ref={barsRef} className="flex h-7 items-end gap-[3px] px-1" aria-hidden>
      {Array.from({ length: LEVEL_BARS }, (_, i) => (
        <span key={i} className="shade-level-bar h-full w-1 rounded-full bg-foreground" />
      ))}
    </span>
  );
}

/** Настройки Shade на месте (in-place-router.tsx). */
function openSettingsTab(tab: string) {
  window.history.pushState(null, '', `/?view=settings&tab=${tab}`);
  window.scrollTo({ top: 0 });
}

/** «Не слышу речи» над капсулой: детектор речь слышит или речь не доходит. */
function SpeechHint({ heard }: { heard: boolean }) {
  useLang();
  const [open, setOpen] = useState(false);
  const sound = useSoundState(true);
  const { transcriptModelConfig, selectedLanguage } = useConfig();
  if (heard) {
    const model = [transcriptModelConfig?.provider, transcriptModelConfig?.model].filter(Boolean).join(' · ') || t('unknownModel');
    const code = selectedLanguage || 'auto';
    const language =
      code === 'auto' ? t('languageAuto') : code === 'auto-translate' ? t('languageAutoTranslate') : (LANGUAGES.find((l) => l.code === code)?.name ?? code);
    return (
      <Notice
        role="status"
        className={DOCK_CARD}
        icon="info"
        title={t('heardNoTextTitle')}
        hint={`${t('recognitionModel')}: ${model} · ${t('recognitionLanguage')}: ${language}`}
        actions={<NoticeButton action={{ label: t('openTranscriptionSettings'), onClick: () => openSettingsTab('transcription') }} />}
      />
    );
  }
  return (
    <>
      <Notice
        role="status"
        className={DOCK_CARD}
        icon="info"
        title={t('noSpeechTitle')}
        hint={silenceCause(sound)}
        actions={<NoticeButton action={{ label: t('soundCheck'), onClick: () => setOpen(true) }} />}
      />
      <SoundCheckDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Что показывает карточка после «Остановить». */
interface CardView {
  stage: FinishCardStage;
  title: string | null;
  meetingId: string | null;
  reason?: DiscardReason;
}

/** Знак на кнопке записи: пять полос звука (контур от владельца 2026-11-20), цвет от кнопки. */
function RecordGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={0.5} strokeLinejoin="round" aria-hidden className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V4C11.25 3.58579 11.5858 3.25 12 3.25ZM8 6.25C8.41421 6.25 8.75 6.58579 8.75 7V17C8.75 17.4142 8.41421 17.75 8 17.75C7.58579 17.75 7.25 17.4142 7.25 17V7C7.25 6.58579 7.58579 6.25 8 6.25ZM16 6.25C16.4142 6.25 16.75 6.58579 16.75 7V17C16.75 17.4142 16.4142 17.75 16 17.75C15.5858 17.75 15.25 17.4142 15.25 17V7C15.25 6.58579 15.5858 6.25 16 6.25ZM4 10.25C4.41421 10.25 4.75 10.5858 4.75 11V13C4.75 13.4142 4.41421 13.75 4 13.75C3.58579 13.75 3.25 13.4142 3.25 13V11C3.25 10.5858 3.58579 10.25 4 10.25ZM20 10.25C20.4142 10.25 20.75 10.5858 20.75 11V13C20.75 13.4142 20.4142 13.75 20 13.75C19.5858 13.75 19.25 13.4142 19.25 13V11C19.25 10.5858 19.5858 10.25 20 10.25Z"
      />
    </svg>
  );
}

/** Кнопка записи в покое: круг 104 px, сплошной Mikado, от него расходятся две волны. */
function RecordButton() {
  useLang();
  const c = useRecordingControls();
  // Известно, что доступа к микрофону нет: кнопка «нужен доступ» (не лаймовая,
  // перечёркнутый микрофон, без волн), клик открывает карточку про микрофон
  if (c.micNeedsAccess && !c.isStarting) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={c.openMicCard}
            aria-label={t('micNeedsAccess')}
            data-shade-record="needs-access"
            className="flex size-[104px] shrink-0 items-center justify-center rounded-full bg-muted text-foreground shadow-lg transition-colors hover:bg-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95"
          >
            <MicrophoneSlash className="size-7" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{t('micNeedsAccess')}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="group relative inline-flex size-[104px] shrink-0">
          {!c.isStarting && (
            <>
              <span className="shade-record-wave pointer-events-none absolute inset-0 rounded-full" aria-hidden />
              <span className="shade-record-wave shade-record-wave-late pointer-events-none absolute inset-0 rounded-full" aria-hidden />
            </>
          )}
          <button
            type="button"
            onClick={() => void c.startAnywhere()}
            disabled={c.isStarting}
            aria-label={t('startRecording')}
            aria-keyshortcuts="Meta+Shift+R Control+Shift+R"
            className="shade-record-button relative flex size-full items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 disabled:opacity-80"
          >
            {c.isStarting ? <Spinner tone="inherit" /> : <RecordGlyph className="size-7" />}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {t('startRecording')} · {c.hotkey} {c.hotkeyScope}
      </TooltipContent>
    </Tooltip>
  );
}

/** Открыт список встреч (не встреча и не настройки): только здесь кнопка записи в покое. */
function isListRoute(pathname: string, params: URLSearchParams | null): boolean {
  return pathname === '/' && !params?.has('id') && params?.get('view') !== 'settings' && !params?.has('finish');
}

/**
 * Кнопка записи в покое только на списке встреч. На настройках и на странице встречи её нет:
 * там она закрывала строки внизу. Записать можно со списка и сочетанием клавиш, оно работает
 * везде. Капсула идущей записи и итог после неё показываются на всех экранах: это управление
 * записью, его не прячем. Пока кнопки нет, у прокрутки обычный нижний отступ вместо запаса под
 * капсулу (data-dock-off). Сообщает доку, открыт ли список (onList): найденная без нажатия
 * проблема с микрофоном встаёт на место кнопки только там.
 */
function IdleRecordButton({ onList, showButton }: { onList: (v: boolean) => void; showButton: boolean }) {
  const pathname = usePathname() ?? '/';
  const params = useSearchParams();
  const list = isListRoute(pathname, params);
  useEffect(() => onList(list), [list, onList]);
  const hidden = !list || !showButton;
  // Запас снизу снимается только в покое вне списка: капсула и карточки дока его требуют везде
  const off = !list && showButton;
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute('data-dock-off', off);
    return () => root.removeAttribute('data-dock-off');
  }, [off]);
  return hidden ? null : <RecordButton />;
}

export function RecordDock() {
  useLang();
  const c = useRecordingControls();
  const { live, notice } = useRecordingOutcome();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [onList, setOnList] = useState(true);

  // Разработка: карточка на заданном шаге без записи (?finish=…, finish-preview.ts)
  const [preview, setPreview] = useState<FinishState | null>(null);
  useEffect(() => setPreview(previewFinish(new URLSearchParams(window.location.search))), [pathname]);
  const fromFinish = (f: FinishState): CardView => ({ stage: f.stage, title: f.title, meetingId: f.meetingId });
  // Одна карточка на все шаги после стопа: обработка и итог из recording-controls, отбракованная
  // запись из recording-outcome (notice). Ключ состояния один, поэтому она не пересоздаётся
  const card: CardView | null = preview
    ? fromFinish(preview)
    : c.finish
      ? fromFinish(c.finish)
      : notice
        ? { stage: 'discarded', title: notice.title ?? null, meetingId: notice.meetingId ?? null, reason: notice.verdict }
        : null;
  // Проблема с микрофоном на месте кнопки: найденная при нажатии «Записать» - везде, найденная
  // без нажатия (passive) - только там, где кнопка записи (список встреч)
  const micBlocker = !c.isRecording && !card && isMicBlocker(c.blocker) && (!c.blocker.passive || onList) ? c.blocker : null;
  // Доступ появился (или проверить не удалось): итог 4 с, под указателем ждёт, потом кнопка
  const [micBack, setMicBack] = useState<MicResolved | null>(null);
  const [micBackHeld, setMicBackHeld] = useState(false);
  useEffect(() => {
    if (!micBack || micBackHeld) return;
    const id = window.setTimeout(() => setMicBack(null), RESULT_MS);
    return () => window.clearTimeout(id);
  }, [micBack, micBackHeld]);
  useEffect(() => {
    if (c.isRecording) setMicBack(null);
  }, [c.isRecording]);
  const state = c.isRecording ? 'recording' : card ? 'finishing' : micBlocker ? 'mic' : micBack ? 'mic-back' : 'idle';
  const openSaved = (id: string) => {
    c.dismissFinish();
    router.push(`/meeting-details?id=${encodeURIComponent(id)}`);
  };
  const closeCard = card?.stage === 'discarded' ? notice?.dismiss : c.dismissFinish;
  // Подсказки о микрофоне во время записи (MicNotices)
  const [micHintClosed, setMicHintClosed] = useState<MicHintKind | null>(null);
  useEffect(() => setMicHintClosed(null), [c.isRecording]);
  const micHint = state === 'recording' ? micHintKind(c.micState, c.micMode === 'system-only', c.micBlind, c.duration) : null;
  const showMicHint = micHint !== null && micHint !== micHintClosed;
  const openRecording = () => {
    c.setView('recording');
    if (pathname !== '/') router.push('/');
  };
  // Правило экрана записи: ложные срабатывания детектора на шум без осмысленного
  // текста речью не считаются
  const showSpeechHint =
    state === 'recording' && !showMicHint && live.tracking && live.textSegments === 0 && !live.recognitionFailed && c.duration >= NO_SPEECH_HINT_SEC;
  // Карточка уходит плавно: последний вид держим ещё LEAVE_MS с анимацией ухода. До отрисовки
  // (layout effect): иначе на кадр карточки нет, и угол над доком дёргается вниз и обратно
  const [leaving, setLeaving] = useState<CardView | null>(null);
  const lastCard = useRef<CardView | null>(null);
  const cardKey = card ? `${card.stage}:${card.meetingId ?? ''}:${card.reason ?? ''}:${card.title ?? ''}` : '';
  useIsoLayoutEffect(() => {
    if (state === 'finishing' && card) {
      lastCard.current = card;
      setLeaving(null);
      return;
    }
    const gone = lastCard.current;
    if (!gone) return;
    lastCard.current = null;
    // Ушла в запись (новый старт): без уходящей копии под капсулой
    if (state === 'recording') return;
    setLeaving(gone);
    const id = window.setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => window.clearTimeout(id);
    // card пересоздаётся на каждом рендере; его смысл в cardKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, cardKey]);

  // Обратная связь: «Как вам Shade?» в правом нижнем углу, когда страница встречи предложила
  // (lib/feedback/store.ts). Во время записи её нет: запись снимает предложение (это не закрытие
  // человеком, в счёт не идёт). При запуске уходит очередь прошлых отзывов
  const offeredMeeting = useOfferedMeeting();
  const [feedbackPreview, setFeedbackPreview] = useState<Flow | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFeedbackPreview(previewFeedback(params));
    previewMotion(params);
  }, [pathname]);
  useEffect(() => {
    flushFeedbackOnLaunch();
    trackLaunch();
  }, []);
  useEffect(() => {
    if (c.isRecording) clearOffer();
  }, [c.isRecording]);
  const showFeedback = !c.isRecording && (offeredMeeting !== null || feedbackPreview !== null);
  const feedbackKey = offeredMeeting ?? (feedbackPreview ? `preview-${feedbackPreview.step}` : null);
  useEffect(() => {
    if (!showFeedback || !feedbackKey) {
      corner.dismiss('feedback');
      return;
    }
    const initial = feedbackPreview ?? undefined;
    const done = () => {
      clearOffer();
      setFeedbackPreview(null);
    };
    corner.show({
      id: 'feedback',
      timeout: null,
      view: { title: t('feedbackAskTitle'), render: () => <FeedbackCard key={feedbackKey} initial={initial} onDone={done} /> },
    });
    // feedbackPreview входит в feedbackKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFeedback, feedbackKey]);

  // Обновления: проверка при запуске и раз в сутки; во время записи не проверяем, не ставим и не
  // показываем. Карточка в правом нижнем углу, без таймера (UpdateCard)
  const updates = updateController();
  const update = useUpdatePhase(updates);
  const [updatePreview, setUpdatePreview] = useState<UpdatePhase | null>(null);
  useEffect(() => setUpdatePreview(previewUpdate(new URLSearchParams(window.location.search))), [pathname]);
  useEffect(() => updates.setRecording(c.isRecording), [updates, c.isRecording]);
  useEffect(() => scheduleChecks(() => void updates.check()), [updates]);
  // «Проверить обновления» в меню трея: явный вопрос, поэтому ответ виден и когда обновления нет
  useEffect(() => {
    const onTray = () =>
      void updates.check().then((r) => {
        if (r === 'none') shadeToast(t('updateLatest'));
        else if (r === 'skipped') shadeToast.error(t('updateCheckFailed'));
      });
    window.addEventListener('check-updates-from-tray', onTray);
    return () => window.removeEventListener('check-updates-from-tray', onTray);
  }, [updates]);
  const updateShown = updatePreview ?? (update.visible ? update.phase : null);
  const shownUpdate = updateShown !== null && isShownUpdate(updateShown) && !c.isRecording ? updateShown : null;
  useEffect(() => {
    if (!shownUpdate) {
      corner.dismiss('update');
      return;
    }
    const closePreview = updatePreview !== null;
    corner.show({
      id: 'update',
      timeout: null,
      view: {
        title: t('updateAction'),
        render: () => (
          <UpdateCard phase={shownUpdate} onUpdate={() => void updates.install()} onClose={() => (closePreview ? setUpdatePreview(null) : updates.dismiss())} />
        ),
      },
    });
    // вид карточки задают шаг и версия
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownUpdate?.kind, shownUpdate?.version, updates]);

  // Угол в правом нижнем углу, над доком, если сбоку не помещается (lib/notice-stack.ts)
  const sectionRef = useRef<HTMLElement>(null);
  useNoticeStackAnchor(sectionRef);

  return (
    <section
      ref={sectionRef}
      aria-label={t('recordingTile')}
      className="pointer-events-none absolute inset-x-0 bottom-7 z-30 flex flex-col items-center gap-2 px-4"
    >
      <DockLeave show={showMicHint && micHint !== null}>
        {micHint && (
          <div key={`mic-${micHint}`} className="shade-dock-in pointer-events-auto flex max-w-full justify-center">
            <MicHint kind={micHint} onClose={() => setMicHintClosed(micHint)} />
          </div>
        )}
      </DockLeave>

      <DockLeave show={showSpeechHint}>
        <div key="hint" className="shade-dock-in pointer-events-auto flex max-w-full justify-center">
          <SpeechHint heard={live.vadSegments > 0} />
        </div>
      </DockLeave>

      <div key={state} className="shade-dock-in pointer-events-auto flex max-w-full justify-center">
        {/* useSearchParams в статической выгрузке требует границу Suspense. Наблюдатель списка
            живёт и тогда, когда кнопку заменила карточка: сообщает, открыт ли список */}
        <Suspense fallback={null}>
          <IdleRecordButton onList={setOnList} showButton={state === 'idle'} />
        </Suspense>

        {state === 'mic' && micBlocker && (
          <MicAccessCard
            blocker={micBlocker}
            onRecheck={c.recheckMicrophone}
            onSystemOnly={() => void c.startAnywhere({ systemOnly: true })}
            onClose={c.dismissBlocker}
            onResolved={(answer) => {
              c.dismissBlocker();
              setMicBack(answer);
            }}
          />
        )}

        {state === 'mic-back' && micBack && (
          <Notice
            role="status"
            className={DOCK_CARD}
            icon={micBack === 'granted' ? 'done' : 'info'}
            title={micBack === 'granted' ? t('micAccessBack') : t('micAccessUnknownBack')}
            hint={micBack === 'granted' ? t('micAccessBackHint') : t('micAccessUnknownBackHint')}
            onPointerMove={() => setMicBackHeld(true)}
            onPointerLeave={() => setMicBackHeld(false)}
            onClose={() => setMicBack(null)}
            closeLabel={t('close')}
          />
        )}

        {state === 'recording' && (
          <div role="group" aria-label={c.isPaused ? t('paused') : t('recording')} className="shade-glass relative flex items-center gap-2 rounded-full p-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={openRecording}
                  aria-label={`${t('openRecording')}, ${formatTimer(c.duration)}`}
                  className="flex h-14 shrink-0 items-center gap-2 rounded-full pl-3 pr-4 transition-colors hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ActivityDot pulse={live.vadSegments + live.textSegments} paused={c.isPaused} />
                  <span className="tabular text-2xl font-bold tracking-tight">{formatTimer(c.duration)}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{c.isPaused ? t('paused') : t('openRecording')}</TooltipContent>
            </Tooltip>

            <LevelBars paused={c.isPaused} />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="shade-icon-btn-glass size-14 [&_svg]:size-5"
                  onClick={() => void c.togglePause()}
                  disabled={c.busy !== null}
                  aria-label={c.isPaused ? t('resumeRecording') : t('pauseRecording')}
                >
                  {c.isPaused ? <Play /> : <Pause />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{c.isPaused ? t('resumeRecording') : t('pauseRecording')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="destructive" size="main" onClick={() => void c.stop()} disabled={c.busy !== null}>
                  {c.busy === 'stop' ? <Spinner tone="inherit" /> : <Stop />}
                  {t('stopRecording')}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t('stopRecording')} · {c.hotkey} {c.hotkeyScope}
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {state === 'finishing' && card && (
          <FinishCard
            stage={card.stage}
            title={card.title}
            reason={card.reason}
            still={preview !== null}
            onOpen={card.meetingId && !preview ? () => openSaved(card.meetingId!) : preview && card.meetingId ? () => undefined : undefined}
            onUndo={
              card.reason === 'low-content' && notice?.undo
                ? () => {
                    notice.dismiss();
                    void notice.undo?.();
                  }
                : undefined
            }
            onClose={preview ? () => undefined : closeCard}
            onHold={card.stage === 'discarded' ? notice?.hold : undefined}
          />
        )}
      </div>

      {/* Уходящий итог: тот же вид, плавно гаснет и опускается, пока на его месте проявляется кнопка записи */}
      {leaving && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4" aria-hidden>
          <div className="shade-dock-out flex max-w-full justify-center">
            <FinishCard
              stage={leaving.stage}
              title={leaving.title}
              reason={leaving.reason}
              still
              onClose={() => undefined}
              onOpen={leaving.meetingId ? () => undefined : undefined}
              onUndo={leaving.reason === 'low-content' ? () => undefined : undefined}
            />
          </div>
        </div>
      )}
    </section>
  );
}
