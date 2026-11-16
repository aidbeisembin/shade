'use client';

// «Язык встреч» (Настройки → Распознавание): три пункта вместо списка из сотни языков.
// Русский с английскими словами, English, Определять сам. Пишет через setSelectedLanguage
// оригинала (localStorage `primaryLanguage` и команда ядра `set_language_preference`),
// формат и команды те же. Выбор, сделанный раньше и не входящий в три пункта (немецкий,
// «определять и переводить»), показывается четвёртым пунктом и не теряется.
// Во время записи выбор сохраняется, но начнёт работать со следующей встречи (ядро
// откладывает его до старта новой записи), под полем об этом подпись.

import { useConfig } from '@/contexts/ConfigContext';
import { LANGUAGES } from '@/constants/languages';
import { t } from '@/shade/strings';
import { useLang } from '@/shade/lib/lang';
import { useRecordingControls } from '@/shade/lib/recording-controls';
import { choiceOf, LANG_CHOICES, type LangChoice } from '@/shade/lib/speech-settings';

const SELECT =
  'h-12 w-full appearance-none rounded-full bg-muted px-5 text-[15px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

const CHOICE_LABEL = { ru: 'speechLangRu', en: 'speechLangEn', auto: 'speechLangAuto' } as const satisfies Record<LangChoice, string>;

function otherName(code: string): string {
  if (code === 'auto-translate') return t('languageAutoTranslate');
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

export function LanguageSelect() {
  useLang();
  const { selectedLanguage, setSelectedLanguage } = useConfig();
  const current = selectedLanguage || 'auto';
  const known = choiceOf(current);
  return (
    <select className={SELECT} aria-label={t('speechLangTitle')} value={current} onChange={(e) => setSelectedLanguage(e.target.value)}>
      {LANG_CHOICES.map((code) => (
        <option key={code} value={code}>
          {t(CHOICE_LABEL[code])}
        </option>
      ))}
      {!known && <option value={current}>{otherName(current)}</option>}
    </select>
  );
}

/** Подсказка строки; во время записи добавляет, что новый язык начнёт работать со следующей встречи. */
export function LanguageHint() {
  useLang();
  const { isRecording } = useRecordingControls();
  return (
    <>
      {t('speechLangHint')}
      {isRecording && <span className="mt-1 block font-medium text-foreground">{t('speechNextMeeting')}</span>}
    </>
  );
}
