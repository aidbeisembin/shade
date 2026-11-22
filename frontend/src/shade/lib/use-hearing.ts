// Подписка на «Слышу речь» для ленты записи; правило и сроки в lib/hearing.ts.
'use client';

import { useEffect, useRef, useState } from 'react';
import { HOLD_MS, VOICE_ON, isHearing } from './hearing';
import { onRecordingLevel, voiceAmount } from './recording-level';

/** Подписка на «Слышу речь» для ленты записи. textCount: сколько реплик в ленте сейчас. */
export function useHearing(active: boolean, textCount: number): boolean {
  const [hearing, setHearing] = useState(false);
  const voiceAt = useRef<number | null>(null);
  const textAt = useRef<number | null>(null);

  // Новая реплика закрывает ожидание по голосу до неё
  useEffect(() => {
    if (textCount > 0) textAt.current = performance.now();
  }, [textCount]);

  useEffect(() => {
    if (!active) {
      voiceAt.current = null;
      setHearing(false);
      return;
    }
    const check = () => setHearing(isHearing({ lastVoiceAt: voiceAt.current, lastTextAt: textAt.current, now: performance.now() }));
    const off = onRecordingLevel((level) => {
      if (voiceAmount(level) >= VOICE_ON) voiceAt.current = performance.now();
      check();
    });
    // Событий нет на паузе и при тишине у некоторых устройств: строка гаснет и без них
    const id = window.setInterval(check, Math.min(250, HOLD_MS));
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [active]);

  // Реплика пришла: сразу перепроверить, не дожидаясь следующего события
  useEffect(() => {
    setHearing(isHearing({ lastVoiceAt: voiceAt.current, lastTextAt: textAt.current, now: performance.now() }));
  }, [textCount]);

  return hearing;
}
