// Карточка обновления в правом нижнем углу (CornerStack, RecordDock ставит её в угол), одним
// устройством сообщения (ui/notice.tsx). Без таймера. Когда она видна и что делает «Обновить»:
// lib/updates.ts (во время записи не показывается, сбой фоновой проверки молчит).
//  - ready: «Доступна версия X» / «Встречи и настройки останутся», «Обновить» и крестик;
//  - installing: та же карточка, крутилка в кнопке «Обновляю…», без крестика;
//  - failed: только после нажатия «Обновить»: «Не получилось обновить» / «Текущая версия на
//    месте», role="alert", крестик.
'use client';

import { Notice, NoticeButton } from '@/shade/components/ui/notice';
import type { UpdatePhase } from '@/shade/lib/updates';
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
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
      data-shade-update={phase.kind}
      className="w-full"
      icon={failed ? 'problem' : 'update'}
      tone={failed ? 'error' : 'neutral'}
      title={failed ? t('updateFailed') : tf('updateAvailable', { version: phase.version })}
      hint={failed ? t('updateFailedHint') : t('updateHint')}
      actions={
        failed ? undefined : (
          <NoticeButton action={{ label: installing ? t('updateInstalling') : t('updateAction'), onClick: onUpdate }} disabled={installing} busy={installing} />
        )
      }
      onClose={installing ? undefined : onClose}
      closeLabel={t('close')}
    />
  );
}
