// shadcn/ui Dialog на Radix: модальное окно с радиусом 24 px, крестик справа.
// При открытии фокус на самом окне, а не на первой кнопке: иначе у неё кольцо фокуса, и
// кнопки футера выглядят разной высоты. С клавиатуры Tab ведёт к первой кнопке.
'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CLOSE_BUTTON, CLOSE_CORNER, CloseGlyph } from '@/shade/components/ui/close-button';
import { cn } from '@/shade/lib/utils';
import { t } from '@/shade/strings';
import { useLang } from '@/shade/lib/lang';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onOpenAutoFocus, ...props }, ref) => {
  useLang();
  const local = React.useRef<HTMLDivElement | null>(null);
  const setRef = (node: HTMLDivElement | null) => {
    local.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
  return (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="shade-dialog-overlay fixed inset-0 z-50" />
    <DialogPrimitive.Content
      ref={setRef}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        local.current?.focus({ preventScroll: true });
      }}
      // data-shade: окно Shade, мост для оригинальных компонентов его не трогает
      data-shade=""
      className={cn(
        // По центру через inset и m-auto, а не translate: появление анимирует transform
        'shade-glass shade-glass-pop fixed inset-0 z-50 m-auto h-fit max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-tile p-6 text-card-foreground focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      {children}
      {/* Общий круглый крестик (ui/close-button.tsx): в правом верхнем углу, 4 px сверху и справа */}
      <DialogPrimitive.Close className={cn(CLOSE_BUTTON, CLOSE_CORNER)}>
        <CloseGlyph />
        <span className="sr-only">{t('close')}</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('pr-12 text-lg font-semibold leading-tight', className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('mt-2 text-sm leading-relaxed text-muted-foreground', className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex flex-wrap justify-end gap-3', className)} {...props} />;
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogTitle, DialogDescription, DialogFooter };
