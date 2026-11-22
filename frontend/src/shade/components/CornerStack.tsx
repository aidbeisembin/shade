// Правый нижний угол колонки страницы: всё, что не про текущую запись (docs/ui/notifications.md).
// Карточки из хранилища lib/corner.ts, рисует одно устройство Notice (ui/notice.tsx) или своя
// разметка (отзыв, загрузка моделей оригинала).
//  - Стек снизу вверх, новая снизу, промежуток 8 px (STACK_GAP). Видно не больше трёх (MAX_VISIBLE);
//    старшие свёрнуты в стопку «+N» над верхней карточкой. Наведение или фокус раскрывают все.
//  - Пока указатель или фокус на стеке и пока окно свёрнуто, время у всех карточек стоит.
//  - Ширина общая (--shade-toast-w, до 500 px и не больше места справа от кнопки записи), место
//    и подъём над доком считает lib/notice-stack.ts; уже 500 px действие под текстом (globals.css).
//  - Появление из размытия со сдвигом снизу (240 мс), уход на месте без размытия (160 мс), уходящая
//    стоит на своём месте (usePresence, lib/corner-presence.ts), соседи съезжают плавно
//    (высота через grid-template-rows); prefers-reduced-motion: только прозрачность (globals.css).
//  - Фокус не перехватывается: карточка появляется, но фокус остаётся, где был.
'use client';

import * as React from 'react';
import { useSyncExternalStore } from 'react';
import { corner, stackView, type CornerEntry } from '@/shade/lib/corner';
import { previewCorner } from '@/shade/lib/corner-preview';
import { Notice, NoticeButton } from '@/shade/components/ui/notice';
import { STACK_GAP } from '@/shade/lib/notice-stack';
import { cn } from '@/shade/lib/utils';
import { placeLeaving, type Presence } from '@/shade/lib/corner-presence';
import { useLang } from '@/shade/lib/lang';
import { t, tp } from '@/shade/strings';

/**
 * Сколько держится уходящая карточка (.shade-corner-item[data-leaving] в globals.css): гаснет
 * 160 мс, место закрывается с 60 мс за 240 мс.
 */
export const CORNER_LEAVE_MS = 300;

const EMPTY: CornerEntry[] = [];

/** Карточка угла: Notice по виду записи или своя разметка. */
export function CornerCard({ entry, onDismiss }: { entry: CornerEntry; onDismiss: () => void }) {
  useLang();
  const v = entry.view;
  if (v.render) return <>{v.render({ dismiss: onDismiss })}</>;
  const error = v.role === 'alert' || v.tone === 'error';
  return (
    <Notice
      role={error ? 'alert' : 'status'}
      className="w-full"
      icon={v.icon}
      tone={v.tone ?? (error ? 'error' : 'neutral')}
      title={v.title}
      hint={v.hint}
      hintTitle={v.hintTitle}
      data-corner-id={entry.id}
      actions={
        v.action && (
          <NoticeButton
            action={{
              ...v.action,
              onClick: () => {
                v.action?.onClick();
                onDismiss();
              },
            }}
          />
        )
      }
      onClose={v.closable === false ? undefined : onDismiss}
      closeLabel={t('toasterClose')}
    />
  );
}

/**
 * Уходящие карточки держатся ещё CORNER_LEAVE_MS с последним видом и на своём месте
 * (placeLeaving). Уходящие считаются прямо в рендере по прошлой отрисовке: если узнавать их
 * в эффекте, на один рендер карточка пропадает, React собирает узел заново и анимация
 * появления запускается снова (закрытая карточка «мигала», до 22.11.2026).
 */
function usePresence(entries: CornerEntry[]): Array<Presence<CornerEntry>> {
  const last = React.useRef<Array<Presence<CornerEntry>>>(entries.map((entry) => ({ entry, leaving: false })));
  // Ушли до конца (свой объект записи: тот же id может прийти снова новой карточкой)
  const expired = React.useRef(new Set<CornerEntry>());
  const timers = React.useRef(new Map<CornerEntry, number>());
  const [, bump] = React.useReducer((n: number) => n + 1, 0);

  const liveIds = new Set(entries.map((e) => e.id));
  const gone = last.current.filter((p) => !liveIds.has(p.entry.id) && !expired.current.has(p.entry)).map((p) => p.entry);
  const items = placeLeaving(
    last.current.map((p) => p.entry.id),
    entries,
    gone,
  );

  React.useLayoutEffect(() => {
    last.current = items;
    expired.current.clear();
    const leaving = new Set(items.filter((p) => p.leaving).map((p) => p.entry));
    for (const entry of leaving) {
      if (timers.current.has(entry)) continue;
      const id = window.setTimeout(() => {
        timers.current.delete(entry);
        expired.current.add(entry);
        bump();
      }, CORNER_LEAVE_MS);
      timers.current.set(entry, id);
    }
  });

  React.useEffect(() => {
    const all = timers.current;
    return () => all.forEach((id) => window.clearTimeout(id));
  }, []);

  return items;
}

export function CornerStack() {
  useLang();
  const entries = useSyncExternalStore(corner.subscribe, corner.getSnapshot, () => EMPTY);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const expanded = hovered || focused;

  // Разработка: ?corner=three|four|trash2 (corner-preview.ts)
  React.useEffect(() => previewCorner(new URLSearchParams(window.location.search)), []);
  React.useEffect(() => corner.hold('hover', hovered), [hovered]);
  React.useEffect(() => corner.hold('focus', focused), [focused]);
  // Свёрнутое окно: время стоит (человек не видит угол)
  React.useEffect(() => {
    const sync = () => corner.hold('hidden', document.visibilityState === 'hidden');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  // Стек опустел: раскрытие и пауза снимаются, даже если указатель ушёл вместе с карточкой
  React.useEffect(() => {
    if (entries.length > 0) return;
    setHovered(false);
    setFocused(false);
  }, [entries.length]);

  const items = usePresence(entries);
  const { hidden } = stackView(entries.length, expanded);
  // Свёрнутые: самые старшие живые (сверху), пока стек не раскрыт
  const folded = new Set(entries.slice(0, hidden).map((e) => e.id));

  return (
    <section
      aria-label={t('toasterRegion')}
      className="shade-corner pointer-events-none fixed z-50"
      data-expanded={expanded || undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocused(false)}
    >
      <div className="shade-corner-list flex flex-col justify-end" style={{ rowGap: 0 }}>
        {hidden > 0 && (
          <div className="shade-corner-item pointer-events-auto" data-corner-pile="">
            <div className="flex min-h-0 justify-end">
              <button
                type="button"
                className="shade-glass shade-glass-dense mb-2 flex h-8 items-center rounded-full px-3 text-sm font-semibold tabular-nums"
                aria-label={tp('cornerMore', hidden)}
                onClick={() => setFocused(true)}
              >
                +{hidden}
              </button>
            </div>
          </div>
        )}
        {items.map(({ entry, leaving }) => {
          const isFolded = folded.has(entry.id);
          return (
            <div
              key={entry.id}
              className={cn('shade-corner-item', !isFolded && !leaving && 'pointer-events-auto')}
              data-leaving={leaving || undefined}
              data-folded={isFolded || undefined}
              data-corner-custom={entry.view.render ? '' : undefined}
              aria-hidden={leaving || isFolded || undefined}
            >
              <div className="min-h-0" style={{ paddingBottom: STACK_GAP }}>
                <CornerCard entry={entry} onDismiss={() => corner.dismiss(entry.id)} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
