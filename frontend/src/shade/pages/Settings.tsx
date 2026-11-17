// Настройки Shade. Свой экран: наши токены, вкладки и тексты, без «Назад»
// (в сайдбаре уже есть навигация). Раздел «Общие» и «О программе» свои,
// на данных ConfigContext. Сложные секции оригинала (устройства, модели
// распознавания и итогов, бета) подключены как есть: их логику не дублируем,
// а цвета и тексты приводит к Shade временный мост (.shade-legacy, LegacyBridge).
//
// Как главная: вся страница одной плиткой (Page, раскладка tile), плоская шапка с
// вкладками липкая, при прокрутке стекло и мягкое затухание под ней (.shade-edge-fade).
// Разделы открытыми группами внутри плитки (без своих подложек, как строки списка на
// главной): заголовок 22/28, строки разделены отступом, переключатели и кнопки справа
// в одной колонке фиксированной ширины. Вкладки как фильтры главной (.shade-chip-on).

'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { BookOpen, Flask, FolderOpen, Microphone, Scroll, SlidersHorizontal, Sparkle, Trash, Waveform } from '@phosphor-icons/react';
import { Button } from '@/shade/components/ui/button';
import { Page } from '@/shade/components/Page';
import { BackButton } from '@/shade/components/BackButton';
import { Skeleton } from '@/shade/components/ui/skeleton';
import { Switch } from '@/shade/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shade/components/ui/tabs';
import { shadeToast } from '@/shade/lib/toasts';
import { cn } from '@/shade/lib/utils';
import { t, type StringKey } from '@/shade/strings';
import { useConfig, type NotificationSettings } from '@/contexts/ConfigContext';
import { RecordingSettings } from '@/components/RecordingSettings';
import { TranscriptSettings } from '@/components/TranscriptSettings';
import { SummaryModelSettings } from '@/components/SummaryModelSettings';
import { BetaSettings } from '@/components/BetaSettings';
import { LANGS, setLang, useLang, type Lang } from '@/shade/lib/lang';
import { LanguageHint, LanguageSelect } from '@/shade/components/LanguageSelect';
import { SpeechWords } from '@/shade/components/SpeechWords';
import { SpeechEngineNotice } from '@/shade/components/SpeechEngineNotice';
import { FeedbackMorph } from '@/shade/components/feedback/FeedbackMorph';
import { LicensesDialog } from '@/shade/components/LicensesDialog';
import { GithubButton } from '@/shade/components/feedback/FeedbackFields';
import { setAskEnabled, useAskEnabled } from '@/shade/lib/feedback/store';

const TABS = [
  { value: 'general', label: 'settingsGeneral', icon: SlidersHorizontal },
  { value: 'recording', label: 'settingsRecording', icon: Microphone },
  { value: 'transcription', label: 'settingsTranscription', icon: Waveform },
  { value: 'summary', label: 'settingsSummary', icon: Sparkle },
  { value: 'beta', label: 'settingsBeta', icon: Flask },
  { value: 'about', label: 'settingsAbout', icon: BookOpen },
] as const satisfies readonly { value: string; label: StringKey; icon: unknown }[];
type TabValue = (typeof TABS)[number]['value'];

// Разделы вкладки один под другим: 32 px между группами
const TAB = 'mt-0 flex-col gap-8 data-[state=active]:flex';

/** Раздел настроек: открытая группа внутри плитки страницы, заголовок 22/28. */
function Section({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={className} aria-label={title}>
      {title && <h2 className="text-[22px] font-bold leading-7 tracking-tight">{title}</h2>}
      <div className={cn('flex flex-col gap-1', title && 'mt-3')}>{children}</div>
    </section>
  );
}

/** Строка: подпись слева, управление справа в колонке 200 px (переключатели на одной линии). */
function Row({ title, hint, children, wide }: { title: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-base font-medium">{title}</p>
        {hint && <div className="mt-1 text-sm text-muted-foreground">{hint}</div>}
      </div>
      {/* Кнопки на всю ширину колонки, переключатель у её правого края */}
      {/* wide: длинная подпись выбора («Русский (с английскими словами)») не помещается в 200 px */}
      {children !== null && <div className={cn('flex shrink-0 justify-end [&>button:not([role=switch])]:w-full', wide ? 'w-[300px]' : 'w-[200px]')}>{children}</div>}
    </div>
  );
}

/** Переключатель показывает то же, что проверяет ядро перед уведомлением: show_recording_started и _stopped. */
function NotificationsRow() {
  useLang();
  const { notificationSettings, isLoadingPreferences, loadPreferences, updateNotificationSettings } = useConfig();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  const prefs = notificationSettings?.notification_preferences;
  const enabled = Boolean(prefs?.show_recording_started && prefs?.show_recording_stopped);

  const toggle = async (next: boolean) => {
    if (!notificationSettings) return;
    const updated: NotificationSettings = {
      ...notificationSettings,
      notification_preferences: {
        ...notificationSettings.notification_preferences,
        show_recording_started: next,
        show_recording_stopped: next,
      },
    };
    setSaving(true);
    try {
      await updateNotificationSettings(updated);
    } catch (error) {
      shadeToast.error(t('saveFailed'), { description: String(error) });
    } finally {
      setSaving(false);
    }
  };

  const noPermission = enabled && notificationSettings && !notificationSettings.system_permission_granted;

  return (
    <Row
      title={t('notificationsTitle')}
      hint={noPermission ? t('notificationsNoPermission') : t('notificationsHint')}
    >
      {isLoadingPreferences && !notificationSettings ? (
        <Skeleton className="h-6 w-11 rounded-full" />
      ) : (
        <Switch
          checked={enabled}
          onCheckedChange={(v) => void toggle(v)}
          disabled={!notificationSettings || saving}
          aria-label={t('notificationsTitle')}
        />
      )}
    </Row>
  );
}

function StorageRow() {
  useLang();
  const { storageLocations, loadPreferences } = useConfig();

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  const open = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      shadeToast.error(t('openFolderFailed'), { description: String(error) });
    }
  };

  return (
    <Row
      title={t('recordingsFolder')}
      hint={
        storageLocations?.recordings ? (
          <span className="break-all font-mono text-[13px]">{storageLocations.recordings}</span>
        ) : (
          <Skeleton className="mt-1 h-4 w-64 rounded-lg" />
        )
      }
    >
      <Button variant="outline" onClick={() => void open()}>
        <FolderOpen />
        {t('openFolder')}
      </Button>
    </Row>
  );
}

const LANG_NAME: Record<Lang, StringKey> = { ru: 'langRu', en: 'langEn' };

const LANG_SELECT =
  'h-12 w-full appearance-none rounded-full bg-muted px-5 text-[15px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Язык интерфейса: выбор запоминается и применяется сразу, без перезапуска (lib/lang.ts). */
function InterfaceLanguageRow() {
  const lang = useLang();
  return (
    <Row title={t('interfaceLanguageRow')} hint={t('interfaceLanguageHint')}>
      <select
        className={LANG_SELECT}
        aria-label={t('interfaceLanguageRow')}
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
      >
        {LANGS.map((code) => (
          <option key={code} value={code} lang={code}>
            {t(LANG_NAME[code])}
          </option>
        ))}
      </select>
    </Row>
  );
}

function GeneralTab() {
  useLang();
  return (
    // Бенто: разделы отдельными плитками, 8 px между плитками
    <div className="flex flex-col gap-8">
      <Section title={t('interfaceLanguage')}>
        <InterfaceLanguageRow />
      </Section>
      <Section title={t('settingsSectionNotifications')}>
        <NotificationsRow />
      </Section>
      <Section title={t('settingsSectionStorage')}>
        <StorageRow />
      </Section>
      <Section title={t('feedbackSection')}>
        <FeedbackRows />
      </Section>
    </div>
  );
}

/**
 * «Обратная связь»: та же форма, что у карточки «Как вам Shade?» (звёзды и текст, уходит только по
 * «Отправить»), звезда на GitHub и переключатель «Иногда спрашивать оценку» (lib/feedback).
 */
function FeedbackRows() {
  useLang();
  const ask = useAskEnabled();
  return (
    <>
      {/* wide: «Поставить звезду на GitHub» не помещается в 200 px */}
      <Row title={t('feedbackRowTitle')} hint={t('feedbackRowHint')} wide>
        <div className="flex w-full flex-col gap-2">
          <FeedbackMorph />
          <GithubButton variant="secondary" className="w-full" />
        </div>
      </Row>
      <Row title={t('feedbackAskRow')} hint={t('feedbackAskHint')}>
        <Switch checked={ask} onCheckedChange={setAskEnabled} aria-label={t('feedbackAskRow')} />
      </Row>
    </>
  );
}

/** Вкладка «Распознавание»: язык встреч и частые слова над моделями оригинала. */
function SpeechTab() {
  useLang();
  return (
    <div className="flex flex-col gap-8">
      <Section title={t('speechSectionTitle')}>
        <SpeechEngineNotice />
        <Row title={t('speechLangTitle')} hint={<LanguageHint />} wide>
          <LanguageSelect />
        </Row>
        <SpeechWords />
      </Section>
    </div>
  );
}

function AboutTab() {
  useLang();
  const [version, setVersion] = useState<string | null>(null);
  const [licensesOpen, setLicensesOpen] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  return (
    <Section title={t('settingsAbout')}>
      <Row title={t('appName')} hint={version ? `${t('version')} ${version}` : undefined}>
        {null}
      </Row>
      <Row title={t('licensesTitle')} hint={t('licensesHint')}>
        <Button variant="outline" onClick={() => setLicensesOpen(true)}>
          <Scroll />
          {t('licensesShow')}
        </Button>
      </Row>
      <LicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />
    </Section>
  );
}

/**
 * Секция оригинала в мосте: наши цвета и тексты поверх оригинальной разметки.
 * Монтируется только на клиенте: мост переводит текст после гидратации.
 */
function Legacy({ children, className }: { children: ReactNode; className?: string }) {
  // key={lang}: при смене языка секция оригинала собирается заново, иначе мост оставил бы
  // в уже переведённых узлах прежний язык (LegacyBridge подменяет только новые узлы)
  const lang = useLang();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div key={lang} className={`shade-legacy ${className ?? ''}`}>
      {mounted ? children : <Skeleton className="h-40 w-full rounded-nested" />}
    </div>
  );
}

/** Вкладка из секций оригинала: одна плитка, внутри вложенная ступень тона (.shade-nest). */
function LegacyTile({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Section title={title}>
      <div className="shade-nest">
        <Legacy className={className}>{children}</Legacy>
      </div>
    </Section>
  );
}

function SettingsContent() {
  useLang();
  const params = useSearchParams();
  const router = useRouter();
  const { transcriptModelConfig, setTranscriptModelConfig } = useConfig();
  const fromUrl = params.get('tab');
  const initial = TABS.some((tab) => tab.value === fromUrl) ? (fromUrl as TabValue) : 'general';
  const [tab, setTab] = useState<TabValue>(initial);

  useEffect(() => {
    if (TABS.some((x) => x.value === fromUrl)) setTab(fromUrl as TabValue);
  }, [fromUrl]);

  const change = (value: string) => {
    setTab(value as TabValue);
    // вкладка в адресе: ссылка «Скачать модель» ведёт сразу на нужную
    router.replace(`/settings?tab=${value}`, { scroll: false });
  };

  const hero = (
    <>
      <h1 className="text-[36px] font-bold leading-10 tracking-tight">{t('navSettings')}</h1>
      <TabsList aria-label={t('navSettings')} className="mt-5">
        {TABS.map((x) => {
          const Icon = x.icon;
          return (
            <TabsTrigger key={x.value} value={x.value}>
              <Icon aria-hidden />
              {/* Ширина по полужирному варианту: выбранная вкладка font-medium, соседи не сдвигаются */}
              <span className="grid">
                <span className="col-start-1 row-start-1">{t(x.label)}</span>
                <span aria-hidden className="invisible col-start-1 row-start-1 font-medium">
                  {t(x.label)}
                </span>
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </>
  );

  return (
    // Tabs снаружи: вкладки в неподвижной шапке, содержимое в прокручиваемой области
    <Tabs value={tab} onValueChange={change} className="flex h-full min-w-0 flex-1">
      <Page leading={<BackButton label={t('backToMeetings')} href="/" />} title={t('navSettings')} hero={hero}>
      <TabsContent value="general" className={TAB}>
        <GeneralTab />
      </TabsContent>
      <TabsContent value="recording" className={TAB}>
        <LegacyTile title={t('settingsRecording')}>
          <RecordingSettings />
        </LegacyTile>
      </TabsContent>
      <TabsContent value="transcription" className={TAB}>
        <SpeechTab />
        <LegacyTile title={t('settingsTranscription')}>
          <TranscriptSettings
            transcriptModelConfig={transcriptModelConfig}
            setTranscriptModelConfig={setTranscriptModelConfig}
          />
        </LegacyTile>
      </TabsContent>
      <TabsContent value="summary" className={TAB}>
        {/* shade-no-autosummary: переключатель «Итоги автоматически» скрыт, Shade делает итоги только по кнопке */}
        <LegacyTile title={t('settingsSummary')} className="shade-no-autosummary">
          <SummaryModelSettings />
        </LegacyTile>
      </TabsContent>
      <TabsContent value="beta" className={TAB}>
        <LegacyTile title={t('settingsBeta')}>
          <BetaSettings />
        </LegacyTile>
      </TabsContent>
      <TabsContent value="about" className={TAB}>
        <AboutTab />
      </TabsContent>
      </Page>
    </Tabs>
  );
}

export default function Settings() {
  useLang();
  return (
    <Suspense
      fallback={
        <Page title={t('navSettings')} hero={<h1 className="text-[36px] font-bold leading-10 tracking-tight">{t('navSettings')}</h1>}>
          <Skeleton className="h-40 w-full rounded-nested" />
        </Page>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}
