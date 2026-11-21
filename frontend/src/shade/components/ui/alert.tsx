// shadcn/ui Alert. Знак слева в круге 44 px на подложке тона крестика (как у уведомлений, ui/notice.tsx),
// иконка 20 px; рядом через 12 px заголовок и текст. Раньше знак был голым и висел абсолютно (2026-11-21).
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shade/lib/utils';

const alertVariants = cva(
  'relative flex w-full items-start gap-3 rounded-nested p-4 text-sm [&>svg]:box-content [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:rounded-full [&>svg]:bg-[hsl(var(--foreground)/var(--glass-btn))] [&>svg]:p-3 [&>svg+div]:min-w-0 [&>svg+div]:flex-1 [&>svg+div]:pt-0.5',
  {
    variants: {
      variant: {
        default: 'bg-muted text-foreground [&>svg]:text-foreground',
        destructive: 'bg-muted text-foreground [&>svg]:text-destructive-ink',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  ),
);
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn('mb-1 text-base font-semibold leading-tight', className)} {...props} />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm leading-relaxed text-muted-foreground [&_p]:leading-relaxed', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';

/** Вторичная кнопка на панели: bg-muted (variant outline) равен подложке панели и пропадает, поэтому тон крестика. */
export const ALERT_SECONDARY = 'bg-[hsl(var(--foreground)/var(--glass-btn))] hover:bg-[hsl(var(--foreground)/var(--glass-btn-hover))]';

export { Alert, AlertTitle, AlertDescription };
