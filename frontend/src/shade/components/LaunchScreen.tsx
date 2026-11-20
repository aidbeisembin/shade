// Заставка запуска: логотип посередине на чёрном фоне (в обеих темах), медленно и
// плавно пульсирует, пока грузится интерфейс. Она уже есть в HTML страницы
// (статическая выгрузка и сервер разработки отдают её сразу), поэтому вместо пустого
// окна и полусобранного интерфейса человек видит знак приложения. Окно на запуске
// тоже чёрное (LAUNCH_BACKGROUND, window-boot.ts). Уходит плавно, когда интерфейс
// ожил (после гидратации), но не раньше чем через MIN_MS, чтобы не мигать.
// prefers-reduced-motion: логотип без пульсации.
'use client';

import { useEffect, useState } from 'react';
import { BRAND_MARK_SRC } from './BrandMark';
import { LAUNCH_BACKGROUND } from '@/shade/lib/window-boot';
import { t } from '@/shade/strings';
import { useLang } from '@/shade/lib/lang';

const MIN_MS = 450;
const FADE_MS = 260;

export function LaunchScreen() {
  useLang();
  const [state, setState] = useState<'shown' | 'leaving' | 'gone'>('shown');
  useEffect(() => {
    const start = (window as unknown as { __shadeLaunchAt?: number }).__shadeLaunchAt ?? performance.now();
    const wait = Math.max(0, MIN_MS - (performance.now() - start));
    const t1 = setTimeout(() => setState('leaving'), wait);
    const t2 = setTimeout(() => setState('gone'), wait + FADE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  if (state === 'gone') return null;
  return (
    <div
      aria-hidden={state === 'leaving'}
      role="status"
      aria-label={t('launching')}
      data-tauri-drag-region
      style={{ backgroundColor: LAUNCH_BACKGROUND }}
      className={`shade-launch fixed inset-0 z-[200] flex items-center justify-center ${state === 'leaving' ? 'shade-launch-leave' : ''}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- статическая выгрузка без оптимизатора изображений */}
      <img src={BRAND_MARK_SRC} width={88} height={88} alt="" draggable={false} className="shade-launch-mark size-[88px] rounded-[22px]" />
    </div>
  );
}
