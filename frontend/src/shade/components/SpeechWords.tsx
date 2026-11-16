'use client';

// «Частые слова» (Настройки → Распознавание): имена, термины и названия продуктов через
// запятую. Сохраняется при уходе из поля (и через секунду после последней правки),
// ядру уходит командой `set_vocabulary_hint`. По умолчанию пусто; в подсказке поля примеры
// вымышленные. Whisper получает слова подсказкой, любому движку слова задают написание
// («figma» → «Figma»). Правка во время записи работает со следующей встречи.

import { useEffect, useRef, useState } from 'react';
import { useLang } from '@/shade/lib/lang';
import { useRecordingControls } from '@/shade/lib/recording-controls';
import { readWords, saveWords, parseWords } from '@/shade/lib/speech-settings';
import { shadeToast } from '@/shade/lib/toasts';
import { t, tf } from '@/shade/strings';

const FIELD =
  'min-h-[96px] w-full resize-y rounded-nested bg-muted px-5 py-4 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const SAVE_DELAY_MS = 1000;

export function SpeechWords() {
  useLang();
  const { isRecording } = useRecordingControls();
  const [value, setValue] = useState('');
  const saved = useRef('');
  const timer = useRef<number | null>(null);
  const [state, setState] = useState<'idle' | 'saved'>('idle');

  useEffect(() => {
    const stored = readWords();
    saved.current = stored;
    setValue(stored);
  }, []);

  const flush = (raw: string) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (raw === saved.current) return;
    saved.current = raw;
    saveWords(raw)
      .then(() => setState('saved'))
      .catch((error) => shadeToast.error(t('speechWordsFailed'), { description: String(error) }));
  };

  // Ушли со страницы, не дождавшись паузы: сохранить то, что набрано
  const latest = useRef('');
  useEffect(
    () => () => {
      if (timer.current !== null) flushRef.current(latest.current);
    },
    [],
  );
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const onChange = (raw: string) => {
    latest.current = raw;
    setValue(raw);
    setState('idle');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(raw), SAVE_DELAY_MS);
  };

  const count = parseWords(value).length;
  return (
    <div className="py-3">
      <label htmlFor="speech-words" className="block text-base font-medium">
        {t('speechWordsTitle')}
      </label>
      <p className="mt-1 text-sm text-muted-foreground">{t('speechWordsHint')}</p>
      <textarea
        id="speech-words"
        className={`${FIELD} mt-3`}
        value={value}
        placeholder={t('speechWordsPlaceholder')}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => flush(e.target.value)}
      />
      <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
        {count > 0 ? tf('speechWordsCount', { n: count }) : t('speechWordsEmpty')}
        {state === 'saved' && ` · ${t('speechWordsSaved')}`}
        {isRecording && state === 'saved' && ` · ${t('speechNextMeeting')}`}
      </p>
    </div>
  );
}
