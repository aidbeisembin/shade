'use client';

// Плитка в «Настройки → Распознавание», пока выбран Parakeet: он сам определяет язык каждого
// куска речи и не принимает «Частые слова», на русских встречах с английскими словами
// ошибается чаще (замер: docs/case/decisions.md). Shade всё равно убирает из его текста
// метки `<unk>` и реплики на чужих языках, но точнее Whisper: ему отдаётся язык встреч и
// подсказка-словарь. Кнопка «Перейти на Whisper» скачивает модель (если её нет) и только
// потом переключает выбор: пока модель не скачана, Parakeet продолжает работать.
// Переключение явное, по нажатию; сами выбор моделей не меняем.

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shade/components/ui/button';
import { Spinner } from '@/shade/components/ui/spinner';
import { useConfig } from '@/contexts/ConfigContext';
import { useLang } from '@/shade/lib/lang';
import { useRecordingControls } from '@/shade/lib/recording-controls';
import { DEFAULT_SPEECH_MODEL, DEFAULT_SPEECH_PROVIDER, saveDefaultSpeechModel, useDefaultSpeechModel } from '@/shade/lib/speech-model';
import { shadeToast } from '@/shade/lib/toasts';
import { t, tf } from '@/shade/strings';
import { Waveform } from '@/shade/components/icons';

export function SpeechEngineNotice() {
  useLang();
  const { transcriptModelConfig, setTranscriptModelConfig } = useConfig();
  const { isRecording } = useRecordingControls();
  const { state, start, retry } = useDefaultSpeechModel();
  const [asked, setAsked] = useState(false);
  const saved = useRef(false);

  // Модель скачана после нажатия: теперь можно переключить выбор
  useEffect(() => {
    if (!asked || !state.ready || saved.current) return;
    saved.current = true;
    saveDefaultSpeechModel()
      .then(() => {
        setTranscriptModelConfig({ provider: DEFAULT_SPEECH_PROVIDER, model: DEFAULT_SPEECH_MODEL, apiKey: null });
        shadeToast.success(t('engineSwitched'));
      })
      .catch((error) => {
        saved.current = false;
        setAsked(false);
        shadeToast.error(t('engineSwitchFailed'), { description: String(error) });
      });
  }, [asked, state.ready, setTranscriptModelConfig]);

  if (transcriptModelConfig?.provider !== 'parakeet') return null;

  const downloading = asked && !state.ready && !state.failed;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-nested bg-muted p-4" role="status">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-background" aria-hidden>
        <Waveform className="size-5" />
      </span>
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-base font-medium">{t('engineParakeetTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('engineParakeetHint')}</p>
        {isRecording && <p className="mt-1 text-sm font-medium">{t('speechNextMeeting')}</p>}
        {downloading && <p className="mt-1 text-sm text-muted-foreground">{tf('rerecDownloading', { p: Math.round(state.percent) })}</p>}
        {asked && state.failed && <p className="mt-1 text-sm text-destructive">{t('rerecDownloadFailed')}</p>}
      </div>
      <Button
        size="main"
        disabled={downloading}
        onClick={() => {
          if (asked && state.failed) {
            retry();
            return;
          }
          setAsked(true);
          void start();
        }}
      >
        {downloading && <Spinner tone="inherit" />}
        {asked && state.failed ? t('retry') : t('engineSwitch')}
      </Button>
    </div>
  );
}
