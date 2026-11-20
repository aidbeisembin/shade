// Карточка обновления в стопке у дока (RecordDock), как остальные уведомления (ui/notice.tsx).
// Когда она видна и что делает «Обновить»: lib/updates.ts.
//  - ready: «Доступна версия X», подпись «Shade перезапустится…», «Обновить» и крестик;
//  - installing: та же карточка, кнопка с индикатором «Обновляю…», без крестика;
//  - failed: «Не получилось обновить», текущая версия на месте, крестик.
'use client';

import { ArrowCircleUp, WarningCircle } from '@phosphor-icons/react';
import { Button } from '@/shade/components/ui/button';
import { Notice, NOTICE_SECONDARY } from '@/shade/components/ui/notice';
import { Spinner } from '@/shade/components/ui/spinner';
import type { UpdatePhase } from '@/shade/lib/updates';
import { cn } from '@/shade/lib/utils';
import { useLang } from '@/shade/lib/lang';
import { t, tf } from '@/shade/strings';

type Shown = Extract<UpdatePhase, { kind: 'ready' | 'installing' | 'failed' }>;

export function isShownUpdate(p: UpdatePhase): p is Shown {
  return p.kind === 'ready' || p.kind === 'installing' || p.kind === 'failed';
}

export function UpdateCard({ phase, onUpdate, onClose }: { phase: Shown; onUpdate: () => void; onClose: () => void }) {
  useLang();
  const failed = phase.kind === 'failed';
  const installing = phase.kind === 'installing';
  return (
    <Notice
      role="status"
      aria-live="polite"
      data-shade-update={phase.kind}
      className="w-[min(560px,calc(100vw-8rem))]"
      icon={failed ? <WarningCircle weight="bold" /> : <ArrowCircleUp weight="bold" />}
      tone={failed ? 'error' : 'neutral'}
      title={failed ? t('updateFailed') : tf('updateAvailable', { version: phase.version })}
      hint={failed ? t('updateFailedHint') : t('updateHint')}
      wrapHint
      actions={
        failed ? undefined : (
          <Button variant="secondary" className={cn(NOTICE_SECONDARY, 'shrink-0 px-4 text-sm font-medium')} onClick={onUpdate} disabled={installing}>
            {installing && <Spinner tone="inherit" />}
            {installing ? t('updateInstalling') : t('updateAction')}
          </Button>
        )
      }
      onClose={installing ? undefined : onClose}
      closeLabel={t('close')}
    />
  );
}
