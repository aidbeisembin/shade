'use client';

// «Лицензии открытого ПО» (Настройки → О программе): работы других авторов в Shade.
// Текст берётся из THIRD_PARTY_NOTICES.md в корне репозитория (webpack кладёт файл в бандл
// строкой, next.config.js), разбор в lib/notices.ts. Описания на двух языках из strings.ts,
// тексты лицензий как есть, на английском: юридический текст не переводим.
// Файл не разобрался: окно говорит, где лежит список, и не падает.

import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import noticesMarkdown from '../../../../THIRD_PARTY_NOTICES.md';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shade/components/ui/dialog';
import { NOTICE_TEXT, parseNotices, sourceHost } from '@/shade/lib/notices';
import { useLang } from '@/shade/lib/lang';
import { shadeToast } from '@/shade/lib/toasts';
import { t } from '@/shade/strings';
import { ArrowUpRight } from '@/shade/components/icons';

export function LicensesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  useLang();
  const notices = useMemo(() => parseNotices(noticesMarkdown), []);

  const openSource = (url: string) =>
    invoke('open_external_url', { url }).catch((error) => shadeToast.error(t('openLinkFailed'), { description: String(error) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{t('licensesTitle')}</DialogTitle>
        <DialogDescription>{notices.length ? t('licensesIntro') : t('licensesEmpty')}</DialogDescription>
        <div className="mt-6 flex flex-col gap-8">
          {notices.map((notice) => {
            const key = NOTICE_TEXT[notice.id];
            return (
              <section key={notice.id} aria-label={notice.name}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-base font-semibold">{notice.name}</h3>
                  {notice.source && (
                    <button
                      type="button"
                      onClick={() => void openSource(notice.source!)}
                      className="inline-flex items-center gap-1 rounded-full text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {sourceHost(notice.source)}
                      <ArrowUpRight className="size-3.5" aria-hidden />
                    </button>
                  )}
                </div>
                {key && <p className="mt-1 text-sm text-muted-foreground">{t(key)}</p>}
                <pre className="mt-3 whitespace-pre-wrap break-words rounded-nested bg-muted p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {notice.license}
                </pre>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
