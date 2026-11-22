// Угол сообщений Shade (CornerStack) на месте прежнего тостера sonner: имя осталось, чтобы
// app/layout.tsx не менять. Вызовы toast.* оригинала и shadeToast перенаправлены в угол
// (lib/toasts.tsx, installShadeToasts), sonner ничего не рисует. Правила угла:
// docs/ui/notifications.md.
'use client';

import { installShadeToasts } from '@/shade/lib/toasts';
import { ShadeIcons } from '@/shade/components/ShadeIcons';
import { CornerStack } from '@/shade/components/CornerStack';
import { RESULT_MS } from '@/shade/lib/notice-timing';

/** Срок по умолчанию для итога без действия (прежнее имя, notice-timing.ts). */
export const TOAST_DURATION_MS = RESULT_MS;

installShadeToasts();

export function ShadeToaster() {
  // Смонтирован в layout.tsx вне ShadeIcons: значки без явного weight рисовались бы контуром
  return (
    <ShadeIcons>
      <CornerStack />
    </ShadeIcons>
  );
}
