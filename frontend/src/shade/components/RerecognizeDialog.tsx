'use client';

// «Распознать заново» на странице встречи (в меню «Ещё», не главной кнопкой).
//
// Что делает: ядро берёт сохранённый звук встречи, распознаёт его Whisper с текущим языком
// встреч и частыми словами (audio/retranscription.rs, команда start_retranscription_command)
// и заменяет текст одной транзакцией, только когда новый текст готов целиком. Пока идёт
// работа, прежний текст на месте. Остановили, закрыли окно, ошибка, обрыв, пустой результат:
// прежний текст остаётся. Итоги не пересчитываются сами: после успеха окно предлагает
// «Обновить итоги», решает человек.
// Нет модели Whisper: окно говорит это словами и предлагает скачать (событиями
// model-download-*, как первый запуск), распознавание начинает после скачивания.

import { useEffect, useReducer, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { ArrowClockwise, DownloadSimple, Warning } from '@phosphor-icons/react';
import { Button } from '@/shade/components/ui/button';
import { Spinner } from '@/shade/components/ui/spinner';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/shade/components/ui/dialog';
import { useConfig } from '@/contexts/ConfigContext';
import { useLang } from '@/shade/lib/lang';
import { DEFAULT_SPEECH_MODEL, DEFAULT_SPEECH_PROVIDER } from '@/shade/lib/speech-model';
import { classifyFailure, isBusy, nextPhase, type RerecPhase } from '@/shade/lib/rerecognize';
import { choiceOf, parseWords, readWords } from '@/shade/lib/speech-settings';
import { shadeToast } from '@/shade/lib/toasts';
import { t, tf } from '@/shade/strings';
import type { ModelInfo } from '@/lib/whisper';

/** Размер модели из каталога ядра (config.rs), для подписи. */
const MODEL_MB = 547;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  folderPath: string | null;
  /** У встречи уже есть итоги: после успеха предложить их обновить. */
  hasSummary: boolean;
  /** Текст обновлён: перечитать встречу. */
  onDone: () => void;
  onUpdateSummary: () => void;
}

const log = (message: string, extra?: unknown) =>
  extra === undefined ? console.info('[shade] распознать заново:', message) : console.info('[shade] распознать заново:', message, extra);

export function RerecognizeDialog({ open, onOpenChange, meetingId, folderPath, hasSummary, onDone, onUpdateSummary }: Props) {
  useLang();
  const { selectedLanguage } = useConfig();
  const [phase, dispatch] = useReducer(nextPhase, 'confirm' as RerecPhase);
  const [percent, setPercent] = useState(0);
  const [progress, setProgress] = useState(0);
  const [segments, setSegments] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  // Окно закрыли, пока шла работа: о результате говорит уведомление
  const openRef = useRef(open);
  openRef.current = open;
  const summaryRef = useRef({ hasSummary, update: onUpdateSummary });
  summaryRef.current = { hasSummary, update: onUpdateSummary };

  // Свежее окно каждый раз
  useEffect(() => {
    if (open) {
      dispatch({ kind: 'reset' });
      setPercent(0);
      setProgress(0);
    }
  }, [open]);

  // События ядра: ход, готово, ошибка (только по этой встрече)
  useEffect(() => {
    const offs: Promise<UnlistenFn>[] = [
      listen<{ meeting_id: string; progress_percentage: number }>('retranscription-progress', (e) => {
        if (e.payload.meeting_id !== meetingId) return;
        setProgress(e.payload.progress_percentage);
        dispatch({ kind: 'running' });
      }),
      listen<{ meeting_id: string; segments_count: number }>('retranscription-complete', (e) => {
        if (e.payload.meeting_id !== meetingId) return;
        setSegments(e.payload.segments_count);
        dispatch({ kind: 'complete' });
        onDoneRef.current();
        if (!openRef.current) {
          const { hasSummary: has, update } = summaryRef.current;
          shadeToast.success(t('rerecDone'), {
            description: has ? t('rerecDoneSummary') : undefined,
            action: has ? { label: t('rerecUpdateSummary'), onClick: () => update() } : undefined,
          });
        }
      }),
      listen<{ meeting_id: string; error: string }>('retranscription-error', (e) => {
        if (e.payload.meeting_id !== meetingId) return;
        log('ошибка ядра', e.payload.error);
        dispatch({ kind: 'error', message: e.payload.error });
        if (!openRef.current && classifyFailure(e.payload.error) !== 'stopped') {
          shadeToast.error(t('rerecFailed'), { description: t('rerecFailedHint') });
        }
      }),
      listen<{ modelName: string; progress: number }>('model-download-progress', (e) => {
        if (e.payload.modelName === DEFAULT_SPEECH_MODEL) setPercent(e.payload.progress);
      }),
      listen<{ modelName: string }>('model-download-complete', (e) => {
        if (e.payload.modelName !== DEFAULT_SPEECH_MODEL) return;
        log('модель скачана, начинаем');
        void beginRef.current();
      }),
      listen<{ modelName: string }>('model-download-error', (e) => {
        if (e.payload.modelName !== DEFAULT_SPEECH_MODEL) return;
        dispatch({ kind: 'download-failed' });
        setPercent(-1);
      }),
    ];
    return () => {
      offs.forEach((p) => void p.then((off) => off()));
    };
    // begin читает только стабильные значения; слушатели ставим один раз на встречу
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  /** Проверить модель и запустить. Любой отказ команды разбирается теми же словами, что событие ядра. */
  const begin = async () => {
    if (!folderPath) return;
    dispatch({ kind: 'start' });
    try {
      await invoke('whisper_init');
      const models = await invoke<ModelInfo[]>('whisper_get_available_models');
      const model = models.find((m) => m.name === DEFAULT_SPEECH_MODEL);
      if (!model || model.status !== 'Available') {
        dispatch({ kind: 'error', message: `model-missing:${DEFAULT_SPEECH_MODEL}` });
        return;
      }
      await invoke('start_retranscription_command', {
        meetingId,
        meetingFolderPath: folderPath,
        language: selectedLanguage || 'auto',
        model: DEFAULT_SPEECH_MODEL,
        provider: DEFAULT_SPEECH_PROVIDER,
      });
      dispatch({ kind: 'model-ready' });
    } catch (error) {
      log('команда отказала', error);
      dispatch({ kind: 'error', message: error });
    }
  };

  const beginRef = useRef(begin);
  beginRef.current = begin;

  const download = () => {
    dispatch({ kind: 'download' });
    setPercent(0);
    invoke('whisper_download_model', { modelName: DEFAULT_SPEECH_MODEL }).catch((error) => {
      // «уже качается» не ошибка: ход придёт событиями
      if (String(error).toLowerCase().includes('already')) return;
      log('загрузка не началась', error);
      dispatch({ kind: 'download-failed' });
    });
  };

  const stop = () => {
    invoke('cancel_retranscription_command').catch((error) => log('остановка не удалась', error));
  };

  const busy = isBusy(phase);
  const choice = choiceOf(selectedLanguage || 'auto');
  const langName =
    choice === 'ru' ? t('speechLangRu') : choice === 'en' ? t('speechLangEn') : choice === 'auto' ? t('speechLangAuto') : selectedLanguage;
  const withWords = parseWords(readWords()).length > 0;

  return (
    // Закрытие окна во время работы только прячет окно: ядро продолжает, текст заменится по готовности
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {phase === 'confirm' && (
          <>
            <DialogTitle>{t('rerecTitle')}</DialogTitle>
            <DialogDescription>{tf(withWords ? 'rerecBodyWords' : 'rerecBody', { lang: langName ?? '' })}</DialogDescription>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" size="main">
                  {t('cancel')}
                </Button>
              </DialogClose>
              <Button size="main" onClick={() => void begin()} disabled={!folderPath}>
                <ArrowClockwise />
                {t('rerecStart')}
              </Button>
            </DialogFooter>
          </>
        )}

        {(phase === 'checking' || phase === 'running') && (
          <>
            <DialogTitle>{t('rerecRunning')}</DialogTitle>
            <DialogDescription>{t('rerecRunningHint')}</DialogDescription>
            <div className="mt-4 flex items-center gap-3" role="status" aria-live="polite">
              <Spinner />
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/15" aria-hidden>
                <div className="h-full rounded-full bg-foreground/70 transition-[width]" style={{ width: `${Math.max(progress, 3)}%` }} />
              </div>
              <span className="tabular w-10 text-right text-sm text-muted-foreground">{progress}%</span>
            </div>
            <DialogFooter>
              <Button variant="outline" size="main" onClick={stop}>
                {t('rerecStop')}
              </Button>
            </DialogFooter>
          </>
        )}

        {(phase === 'model-missing' || phase === 'downloading') && (
          <>
            <DialogTitle>{percent === -1 ? t('rerecDownloadFailed') : t('rerecModelMissing')}</DialogTitle>
            <DialogDescription>
              {percent === -1 ? t('rerecDownloadFailedHint') : tf('rerecModelMissingHint', { mb: MODEL_MB })}
            </DialogDescription>
            {phase === 'downloading' && (
              <div className="mt-4 flex items-center gap-3" role="status" aria-live="polite">
                <Spinner />
                <span className="text-sm text-muted-foreground">{tf('rerecDownloading', { p: percent })}</span>
              </div>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" size="main">
                  {t('cancel')}
                </Button>
              </DialogClose>
              <Button size="main" onClick={download} disabled={phase === 'downloading'}>
                <DownloadSimple />
                {t('rerecDownload')}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === 'done' && (
          <>
            <DialogTitle>{t('rerecDone')}</DialogTitle>
            <DialogDescription>
              {tf('rerecDoneHint', { n: segments })}
              {hasSummary && ` ${t('rerecDoneSummary')}`}
            </DialogDescription>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" size="main">
                  {hasSummary ? t('rerecLater') : t('close')}
                </Button>
              </DialogClose>
              {hasSummary && (
                <Button
                  size="main"
                  onClick={() => {
                    onOpenChange(false);
                    onUpdateSummary();
                  }}
                >
                  {t('rerecUpdateSummary')}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {(phase === 'stopped' || phase === 'busy' || phase === 'no-text' || phase === 'failed') && (
          <>
            <DialogTitle className="flex items-center gap-2">
              <Warning aria-hidden className="size-5 shrink-0" />
              {phase === 'stopped'
                ? t('rerecStopped')
                : phase === 'busy'
                  ? t('rerecBusy')
                  : phase === 'no-text'
                    ? t('rerecNoText')
                    : t('rerecFailed')}
            </DialogTitle>
            <DialogDescription>
              {phase === 'stopped' ? t('rerecFailedHint') : phase === 'busy' ? t('rerecBusyHint') : phase === 'no-text' ? t('rerecNoTextHint') : t('rerecFailedHint')}
            </DialogDescription>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" size="main">
                  {t('close')}
                </Button>
              </DialogClose>
              {phase !== 'busy' && (
                <Button size="main" onClick={() => dispatch({ kind: 'reset' })}>
                  <ArrowClockwise />
                  {t('retry')}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

