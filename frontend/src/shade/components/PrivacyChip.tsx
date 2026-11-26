// Индикатор приватности: локально, облако или неизвестно.
// Смысл передают текст и иконка, цвет только поддерживает.
'use client';

import { Cloud, ShieldCheck, ShieldWarning, Sparkle } from '@phosphor-icons/react';
import { Badge } from '@/shade/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shade/components/ui/tooltip';
import { providerLabel, type PrivacyInfo, type PrivacyLevel, type ProviderPrivacy } from '@/shade/lib/privacy';
import { t, type StringKey } from '@/shade/strings';
import { cn } from '@/shade/lib/utils';
import { useLang } from '@/shade/lib/lang';
import { Waveform } from '@/shade/components/icons';

const LEVEL = {
  local: { icon: ShieldCheck, label: 'privacyLocal', hint: 'privacyHintLocal', variant: 'accent' as const },
  cloud: { icon: Cloud, label: 'privacyCloud', hint: 'privacyHintCloud', variant: 'outline' as const },
  unknown: { icon: ShieldWarning, label: 'privacyUnknown', hint: 'privacyHintUnknown', variant: 'secondary' as const },
} satisfies Record<PrivacyLevel, { icon: unknown; label: StringKey; hint: StringKey; variant: string }>;

const WHERE: Record<PrivacyLevel, StringKey> = {
  local: 'privacyWhereLocal',
  cloud: 'privacyWhereCloud',
  unknown: 'privacyWhereUnknown',
};

function line(title: string, p: ProviderPrivacy) {
  return `${title}: ${providerLabel(p)}, ${t(WHERE[p.level])}`;
}

/** compact: круглая кнопка 48 px только с иконкой (узкий сайдбар), подпись в подсказке. */
export function PrivacyChip({ privacy, className, compact }: { privacy: PrivacyInfo; className?: string; compact?: boolean }) {
  useLang();
  const level = LEVEL[privacy.level];
  const { icon: Icon, variant } = level;
  const label = t(level.label);
  const hint = t(level.hint);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {compact ? (
          <span
            tabIndex={0}
            className={cn(
              'flex size-12 cursor-default items-center justify-center shade-icon-btn-ghost rounded-full text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
            aria-label={`${t('privacy')}: ${label}. ${hint}`}
          >
            <Icon className="size-5" aria-hidden />
          </span>
        ) : (
        <Badge
          variant={variant}
          tabIndex={0}
          className={cn('h-8 cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
          aria-label={`${t('privacy')}: ${label}. ${hint}`}
        >
          <Icon aria-hidden />
          {label}
        </Badge>
        )}
      </TooltipTrigger>
      {/* Сетка: колонка иконок и колонка текста, строки начинаются с одной линии */}
      <TooltipContent side={compact ? 'right' : 'bottom'} align={compact ? 'end' : 'start'} className="w-max max-w-[min(460px,calc(100vw-2rem))] p-3">
        <div className="grid grid-cols-[20px_1fr] items-start gap-x-2.5 gap-y-2 text-[13px]">
          <Icon className="mt-px size-5 text-primary-ink" aria-hidden />
          <p className="whitespace-nowrap font-medium">{hint}</p>
          <Waveform className="mt-px size-4 justify-self-center text-muted-foreground" aria-hidden />
          <p className="whitespace-nowrap text-muted-foreground">{line(t('privacyTranscriptLine'), privacy.transcript)}</p>
          <Sparkle className="mt-px size-4 justify-self-center text-muted-foreground" aria-hidden />
          <p className="whitespace-nowrap text-muted-foreground">{line(t('summary'), privacy.summary)}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
