// Карточки про микрофон в доке записи (docs/ui/notifications.md, «Док»), одним устройством
// сообщения (ui/notice.tsx):
// - MicAccessCard: на месте кнопки записи, пока проблема есть: «Нет доступа к микрофону»
//   (Системные настройки, при возврате в окно доступ перепроверяется сам) и «Микрофон не
//   найден» (настройки Shade, вкладка «Запись»). Видна сразу, как только проблема известна,
//   без нажатия «Записать» (recording.ts, passiveMicProblem). Фокус не забирает.
// - MicHint: над капсулой во время записи «Не слышу микрофон», «Микрофон отключился» и
//   напоминание «Пишу только звук компьютера». Запись не обрывается.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Notice, NoticeButton } from '@/shade/components/ui/notice';
import { DOCK_CARD } from '@/shade/components/FinishCard';
import { SoundCheckDialog } from '@/shade/components/SoundCheck';
import { openPrivacySettings } from '@/shade/lib/onboarding';
import type { StartBlocker } from '@/shade/lib/recording';
import type { MicWatchState } from '@/shade/lib/mic-watch';
import { t } from '@/shade/strings';
import { useLang } from '@/shade/lib/lang';

type MicBlocker = Extract<StartBlocker, { kind: 'no-microphone' | 'mic-denied' }>;

/**
 * Окно снова в фокусе после Системных настроек: вызвать cb. Тот же способ, что в
 * онбординге (useAccessChecks): focus, visibilitychange и событие окна Tauri.
 */
function useWindowReturn(cb: () => void) {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    let last = 0;
    const onBack = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - last < 800) return; // focus и visibilitychange приходят парой
      last = now;
      cbRef.current();
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    let offTauri: (() => void) | undefined;
    let cancelled = false;
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().onFocusChanged(({ payload }) => payload && onBack()))
      .then((off) => {
        if (cancelled) off();
        else offTauri = off;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
      offTauri?.();
    };
  }, []);
}

/** Настройки Shade на месте (in-place-router.tsx): вкладка «Запись», выбор микрофона. */
export function openRecordingSettings() {
  window.history.pushState(null, '', '/?view=settings&tab=recording');
  window.scrollTo({ top: 0 });
}

/** Чем кончилась перепроверка после настроек: доступ есть или проверить не удалось. */
export type MicResolved = 'granted' | 'unknown';

/** Запись не начнётся: нет доступа к микрофону или микрофона. В доке вместо кнопки записи. */
export function MicAccessCard({
  blocker,
  onRecheck,
  onClose,
  onResolved,
}: {
  blocker: MicBlocker;
  /** Перепроверить доступ: есть, нет или проверить не удалось. */
  onRecheck: () => Promise<'granted' | 'denied' | 'unknown'>;
  onClose: () => void;
  /** Доступ появился или проверить не удалось: док показывает итог 4 с и снова кнопку. */
  onResolved?: (answer: MicResolved) => void;
}) {
  useLang();
  const [checking, setChecking] = useState(false);
  const awaiting = useRef(false);

  const recheck = useCallback(async () => {
    setChecking(true);
    const answer = await onRecheck().catch(() => 'denied' as const);
    setChecking(false);
    // Проверить не удалось: карточка уходит, но «доступ есть» не утверждаем
    if (answer !== 'denied') onResolved?.(answer);
  }, [onRecheck, onResolved]);

  // Вернулись из Системных настроек: перепроверяем сами, без лишнего нажатия
  useWindowReturn(() => {
    if (!awaiting.current) return;
    awaiting.current = false;
    void recheck();
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const denied = blocker.kind === 'mic-denied';
  // Подпись: что с записью или что сделать (шаблон текстов, notifications.md)
  const hint = denied ? (blocker.zeros ? t('micNotSaved') : blocker.stillDenied ? t('micRestartNote') : t('micDeniedHint')) : t('micMissingHint');
  const open = () => {
    if (denied) {
      awaiting.current = true;
      void openPrivacySettings('microphone');
    } else openRecordingSettings();
  };

  return (
    <Notice
      role="alert"
      data-shade-mic={blocker.kind}
      className={DOCK_CARD}
      icon="problem"
      title={denied ? t('micDeniedTitle') : t('micMissingTitle')}
      hint={hint}
      actions={<NoticeButton action={{ label: t('micOpenSettings'), onClick: open }} disabled={checking} busy={checking} />}
      onClose={onClose}
      closeLabel={t('close')}
    />
  );
}

const HINT = {
  silent: { title: 'micSilentTitle', hint: 'micSilentHint' },
  lost: { title: 'micLostTitle', hint: 'micLostHint' },
  'system-only': { title: 'systemOnlyTitle', hint: 'systemOnlyHint' },
  blind: { title: 'micBlindTitle', hint: 'micBlindHint' },
} as const;

export type MicHintKind = keyof typeof HINT;

/** Какую подсказку о микрофоне показать во время записи, или null. */
export function micHintKind(watch: MicWatchState, systemOnly: boolean, blind: boolean, duration: number): MicHintKind | null {
  // Выбор человека: напомнить в первые 8 секунд, дальше не мешать
  if (systemOnly) return duration < 8 ? 'system-only' : null;
  if (watch === 'lost') return 'lost';
  if (watch === 'silent') return 'silent';
  if (blind) return 'blind';
  return null;
}

/** Подсказка над капсулой записи: тихая, с крестиком, запись не трогает. */
export function MicHint({ kind, onClose }: { kind: MicHintKind; onClose: () => void }) {
  useLang();
  const [soundCheck, setSoundCheck] = useState(false);
  const action =
    kind === 'blind'
      ? { label: t('micOpenSettings'), onClick: () => void openPrivacySettings('microphone') }
      : kind !== 'system-only'
        ? { label: t('soundCheck'), onClick: () => setSoundCheck(true) }
        : null;
  return (
    <>
      <Notice
        role="status"
        data-shade-mic-hint={kind}
        className={DOCK_CARD}
        icon={kind === 'system-only' ? 'info' : 'problem'}
        title={t(HINT[kind].title)}
        hint={t(HINT[kind].hint)}
        hintTitle={t(HINT[kind].hint)}
        actions={action && <NoticeButton action={action} />}
        onClose={onClose}
        closeLabel={t('close')}
      />
      <SoundCheckDialog open={soundCheck} onOpenChange={setSoundCheck} />
    </>
  );
}
