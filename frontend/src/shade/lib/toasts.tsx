// Тосты в интерфейсе Shade уходят в правый нижний угол (lib/corner.ts, CornerStack), одним
// устройством карточки (ui/notice.tsx). Оригинальные хуки зовут toast из sonner с английским
// текстом; здесь методы toast один раз при загрузке Shade заменяются: текст переводится, лишние
// действия убираются, а тосты, которые Shade показывает по-своему, не всплывают. sonner сам
// ничего не рисует (его Toaster в Shade не смонтирован). Файлы оригинала не меняются.
// Сохранены правила sonner, на которые опирается оригинал: тот же id заменяет карточку на
// месте, duration: Infinity - без таймера, toast.dismiss(id) и toast.dismiss() - закрыть.
'use client';

import * as React from 'react';
import { toast, type ExternalToast } from 'sonner';
import { corner, type CornerView, type NoticeIconKind } from './corner';
import { t as shadeT } from '@/shade/strings';
import { translate } from './legacy-i18n';

type Message = Parameters<typeof toast>[0];
type Kind = 'success' | 'error' | 'info' | 'warning' | 'message' | 'loading';
type Method = Kind | 'custom' | 'dismiss';
type ToastFn = (m: Message, d?: ExternalToast) => string | number;

/**
 * Тосты, которые в Shade не нужны:
 * - «Recording saved successfully!»: итог записи показывает док («Встреча сохранена»);
 * - «🔴 Recording Started»: напоминание предупредить участников показывается
 *   на экране записи (RecordingView), а не поверх него.
 */
const SUPPRESSED = new Set(['Recording saved successfully!', '🔴 Recording Started']);

/** Действия, которые повторяют уже сделанный переход. */
const REDUNDANT_ACTIONS = new Set(['View Meeting']);

/** Значок по смыслу (ui/notice.tsx, NoticeGlyph). */
const ICON: Record<Kind, NoticeIconKind> = {
  success: 'done',
  info: 'info',
  message: 'info',
  warning: 'problem',
  error: 'problem',
  loading: 'progress',
};

function tr(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return translate(value) ?? value;
}

function render(value: unknown): React.ReactNode {
  return typeof value === 'function' ? (value as () => React.ReactNode)() : (value as React.ReactNode);
}

type ActionObject = { label: React.ReactNode; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void };

function isActionObject(value: unknown): value is ActionObject {
  return typeof value === 'object' && value !== null && 'label' in value && 'onClick' in value;
}

/** Вид карточки угла по вызову toast.*: чистая функция (toasts.test.ts). */
export function toastView(kind: Kind, message: Message, data?: ExternalToast): CornerView {
  const title = render(tr(message));
  const description = render(tr(data?.description));
  const raw = data?.action;
  const action =
    isActionObject(raw) && !(typeof raw.label === 'string' && REDUNDANT_ACTIONS.has(raw.label))
      ? {
          label: (typeof raw.label === 'string' ? tr(raw.label) : raw.label) as string,
          onClick: () => raw.onClick({ preventDefault() {}, defaultPrevented: false } as unknown as React.MouseEvent<HTMLButtonElement>),
        }
      : undefined;
  return {
    icon: ICON[kind],
    tone: kind === 'error' ? 'error' : 'neutral',
    role: kind === 'error' ? 'alert' : 'status',
    title,
    hint: description || undefined,
    hintTitle: typeof description === 'string' ? description : undefined,
    action,
    closable: kind !== 'loading',
  };
}

/** Показать в углу. duration: Infinity - без таймера (как в sonner). */
function show(kind: Kind, message: Message, data?: ExternalToast): string {
  return corner.show({
    id: data?.id === undefined ? undefined : String(data.id),
    view: toastView(kind, message, data),
    timeout: data?.duration,
    onDismiss: data?.onDismiss ? () => data.onDismiss?.({ id: data.id ?? '' } as never) : undefined,
  });
}

/** toast.custom: своя разметка вызывающего кода в том же стеке (прогресс загрузки моделей). */
function showCustom(message: Message, data?: ExternalToast): string {
  const id = data?.id === undefined ? `custom-${Date.now()}` : String(data.id);
  return corner.show({
    id,
    view: { title: '', render: () => (typeof message === 'function' ? (message as (id: string) => React.ReactNode)(id) : (message as React.ReactNode)) },
    timeout: data?.duration ?? null,
  });
}

type ShadeToast = ((message: Message, data?: ExternalToast) => string) & Record<Kind, (message: Message, data?: ExternalToast) => string> & {
  custom: (message: Message, data?: ExternalToast) => string;
  dismiss: (id?: string | number) => void;
};

/** Тосты самого Shade: в угол, те же правила (lib/corner.ts). */
export const shadeToast: ShadeToast = Object.assign((message: Message, data?: ExternalToast) => show('message', message, data), {
  success: (m: Message, d?: ExternalToast) => show('success', m, d),
  error: (m: Message, d?: ExternalToast) => show('error', m, d),
  info: (m: Message, d?: ExternalToast) => show('info', m, d),
  warning: (m: Message, d?: ExternalToast) => show('warning', m, d),
  message: (m: Message, d?: ExternalToast) => show('message', m, d),
  loading: (m: Message, d?: ExternalToast) => show('loading', m, d),
  custom: showCustom,
  dismiss: (id?: string | number) => corner.dismiss(id),
});

let installed = false;

export function installShadeToasts() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const sonner = toast as unknown as Record<Method, unknown>;
  (['success', 'error', 'info', 'warning', 'message', 'loading'] as Kind[]).forEach((kind) => {
    sonner[kind] = ((message: Message, data?: ExternalToast) => {
      if (typeof message === 'string' && SUPPRESSED.has(message)) return '';
      return show(kind, message, data);
    }) as ToastFn;
  });
  sonner.custom = showCustom as ToastFn;
  sonner.dismiss = (id?: string | number) => corner.dismiss(id);

  // useRecordingStart при старте из трея показывает нативный alert на английском.
  // Только эту строку переводим в наш тост, остальные alert не трогаем.
  const nativeAlert = window.alert.bind(window);
  window.alert = (message?: unknown) => {
    const text = String(message ?? '');
    const prefix = 'Failed to start recording.';
    if (text.startsWith(prefix)) {
      shadeToast.error(shadeT('startFailed'), { description: text.slice(prefix.length).trim() || undefined });
      return;
    }
    nativeAlert(message);
  };
}
