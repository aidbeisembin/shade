// Переименование прямо на месте (строка списка и заголовок встречи).
// Поле получает полное название без многоточия. Enter сохраняет, Esc отменяет,
// клик вне поля сохраняет. Если текст не меняли или стёрли, хранимое название
// не трогается. Кнопки круглые, в высоту поля (buttonClassName задаёт размер под
// inputClassName, по умолчанию 48 px как поле), иконки 20 px: «Сохранить» в акценте,
// «Отмена» на серой подложке (cancelClassName, если поле лежит на той же подложке);
// Check и X в начертании bold: залитые в Phosphor нарисованы квадратом.
'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, X } from '@phosphor-icons/react';
import { Button } from '@/shade/components/ui/button';
import { Input } from '@/shade/components/ui/input';
import { Spinner } from '@/shade/components/ui/spinner';
import { cn } from '@/shade/lib/utils';
import { t } from '@/shade/strings';
import { useLang } from '@/shade/lib/lang';

interface InlineRenameProps {
  /** Полный текст для поля (editableTitle). */
  initial: string;
  onSave: (next: string) => Promise<void>;
  onClose: () => void;
  inputClassName?: string;
  /** Размер кнопок, равный высоте поля (например size-14 при h-14). */
  buttonClassName?: string;
  /** Подложка «Отмены», если серая по умолчанию сливается с фоном вокруг: тон задаётся через --muted (фон .shade-icon-btn берётся из него). */
  cancelClassName?: string;
  className?: string;
}

export function InlineRename({ initial, onSave, onClose, inputClassName, buttonClassName = 'size-12', cancelClassName, className }: InlineRenameProps) {
  useLang();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const save = async () => {
    if (done.current || saving) return;
    const next = value.trim();
    if (!next || next === initial.trim()) {
      done.current = true;
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      done.current = true;
      onClose();
    } catch {
      /* тост уже показан, поле остаётся открытым */
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    done.current = true;
    onClose();
  };

  // Нажатие на кнопки формы не должно сначала уводить фокус и сохранять по blur
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <form
      className={cn('flex min-w-0 items-center gap-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
          }
        }}
        onBlur={(e) => {
          if (e.currentTarget.form?.contains(e.relatedTarget as Node)) return;
          void save();
        }}
        aria-label={t('meetingTitle')}
        className={cn('min-w-0 flex-1', inputClassName)}
        maxLength={200}
        disabled={saving}
      />
      <Button type="submit" size="icon" className={cn('shrink-0 [&_svg]:size-5', buttonClassName)} aria-label={t('save')} disabled={saving} onMouseDown={keepFocus}>
        {saving ? <Spinner tone="inherit" /> : <Check weight="bold" />}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon"
        className={cn('shrink-0 [&_svg]:size-5', buttonClassName, cancelClassName)}
        aria-label={t('cancel')}
        onMouseDown={keepFocus}
        onClick={cancel}
      >
        <X weight="bold" />
      </Button>
    </form>
  );
}
