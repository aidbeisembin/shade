// Уведомления Shade: sonner в наших токенах и теме. Сами тосты рисует общий компонент Notice
// (ui/notice.tsx, через installShadeToasts в lib/toasts.tsx), как итог записи у капсулы.
// Место одно на все уведомления: правый нижний угол колонки страницы, на высоте низа дока
// записи; если содержимое дока заходит под угол, тосты встают над ним (lib/notice-stack.ts,
// .shade-toaster в globals.css). Тосты раскрыты списком через 8 px (expand, gap), а не сложены колодой друг
// под другом: непрозрачно друг на друга не ложатся. Появление и уход размытием там же.
// ICONS и крестик sonner остаются для toast.promise, если появится.
'use client';

import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { Bell, CheckFat, Warning } from '@phosphor-icons/react';
import { Spinner } from '@/shade/components/ui/spinner';
import { getStoredTheme, onThemeChange, type ThemeMode } from '@/shade/lib/theme';
import { installShadeToasts } from '@/shade/lib/toasts';
import { STACK_GAP } from '@/shade/lib/notice-stack';

/** Сколько тост висит, если вызов не задал своё: 4 с хватает прочесть две строки и нажать
 *  «Вернуть»; под курсором и в свёрнутом окне sonner время не считает. Было 5 с. */
export const TOAST_DURATION_MS = 4000;
import { t } from '@/shade/strings';
import { useLang } from '@/shade/lib/lang';

installShadeToasts();

// Иконки уведомлений из того же набора и размера, что во всём Shade (fill, 20 px),
// ожидание тем же Spinner; встроенные иконки sonner другого начертания.
const ICONS = {
  // Без иконок со встроенной подложкой (*Circle, *Square): знак без кружка
  success: <CheckFat className="size-5" />,
  info: <Bell weight="fill" className="size-5" />,
  warning: <Warning weight="fill" className="size-5" />,
  error: <Warning weight="fill" className="size-5" />,
  loading: <Spinner />,
  // Крестик закрытия остаётся тонким из sonner: залитый X в Phosphor нарисован квадратом
};

export function ShadeToaster() {
  useLang();
  const [theme, setTheme] = useState<ThemeMode>('light');

  useEffect(() => {
    setTheme(getStoredTheme());
    return onThemeChange(setTheme);
  }, []);

  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      expand
      gap={STACK_GAP}
      closeButton
      icons={ICONS}
      duration={TOAST_DURATION_MS}
      visibleToasts={3}
      className="shade-toaster"
      toastOptions={{ closeButtonAriaLabel: t('toasterClose') }}
      containerAriaLabel={t('toasterRegion')}
    />
  );
}
