# #20 Распознавание на Mac: язык системы, Whisper по умолчанию, оптимизация зависимостей в dev

- Статус: слит, 2026-11-07
- Ветка: `claude/trusting-bohr-b52k7i` → `aid`
- Автор: katanana23
- Исходная ссылка: https://github.com/katanana23/shade/pull/20

## Описание

## Description

Разбор проблем распознавания на Mac в режиме разработки и правки по решениям из чата. Ядро (`frontend/src-tauri`), `RecordDock`, онбординг, `Recording.tsx` и `Settings.tsx` не менялись. Не сливать.

### Сделано в ветке (4 коммита)

1. **Язык по умолчанию из системы** (`src/aid/lib/system-language.ts`, вызов в `app/layout.tsx`). Плюс готовый выбор языка `src/aid/components/LanguageSelect.tsx` для настроек.
2. **`[profile.dev.package."*"] opt-level = 3` в корневом `Cargo.toml`** (отдельный коммит). `[profile.dev] opt-level = 1` не добавлял.
3. **Модель по умолчанию Whisper `large-v3-turbo-q5_0`** (`src/aid/lib/speech-model.ts`): хук загрузки и сохранение выбора через существующие команды. Подключение в первый запуск ниже готовым патчем: онбординг сейчас у сессии PR katanana23/meetily#19.
4. **`docs/case/decisions.md`**: правки ядра записаны как отложенные до сборки .app.

### Вставить после слияния

**Первый запуск** (`src/aid/components/onboarding/AidOnboarding.tsx`, после katanana23/meetily#19; сам #19 этот файл не трогает, менял только `useAccessChecks.ts`). Патч ниже проверен на заглушках `?mock=onboarding`: Parakeet не качается, на «Почти готово» «219 из 547 МБ, 40 %», порядок вызовов `whisper_download_model {large-v3-turbo-q5_0}` → `complete_onboarding` → `api_save_transcript_config {localWhisper, large-v3-turbo-q5_0}`, язык `ru`. `tsc` с патчем проходит. В ветку патч не входит.

Почему сохранение после `complete_onboarding`: команда ядра всегда пишет Parakeet (`onboarding.rs:195`), поэтому Whisper записываем следом. Новые установки получают Whisper, текущие не меняются. Parakeet остаётся выбором в настройках.

<details>
<summary>Патч AidOnboarding.tsx (+14, −78)</summary>

```diff
@@ -12,27 +12,23 @@
 'use client';
 
 import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
-import { listen } from '@tauri-apps/api/event';
 import { toast } from 'sonner';
 import { useOnboarding } from '@/contexts/OnboardingContext';
-import type { ParakeetDownloadProgressEvent } from '@/lib/parakeet';
 import { AidIcons } from '@/aid/components/AidIcons';
 import { WindowBar } from '@/aid/components/WindowBar';
 import { Button } from '@/aid/components/ui/button';
 import { cn } from '@/aid/lib/utils';
-import { SLOW_MS, SlowError, detectMac, obLog, withTimeout } from '@/aid/lib/onboarding';
+import { SlowError, detectMac, obLog, withTimeout } from '@/aid/lib/onboarding';
 import { t } from '@/aid/strings';
 import { HelloStep } from './HelloStep';
 import { AccessStep } from './AccessStep';
-import { ReadyStep, type SpeechModelState } from './ReadyStep';
+import { ReadyStep } from './ReadyStep';
+import { saveDefaultSpeechModel, useDefaultSpeechModel } from '@/aid/lib/speech-model';
 
-const PARAKEET_MODEL = 'parakeet-tdt-0.6b-v3-int8';
 /** Уход шага (размытие и сдвиг) перед появлением следующего, мс; как .aid-ob-out в globals.css. */
 const STEP_OUT_MS = 200;
 /** Уход всего экрана в приложение, мс; как .aid-ob-exit. */
 const EXIT_MS = 260;
-/** Загрузка не начинается: ни одного события прогресса за это время. */
-const STALL_MS = SLOW_MS * 2;
 /**
  * Загрузка стартует, когда OnboardingContext прочитал состояние моделей с диска (иначе уже
  * скачанная модель пошла бы качаться заново). Признак: ядро назвало модель для итогов.
@@ -47,7 +43,9 @@ const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.
 
 export function AidOnboarding({ onComplete }: { onComplete: () => void }) {
   const ob = useOnboarding();
-  const { parakeetDownloaded, parakeetProgressInfo, selectedSummaryModel, summaryModelDownloaded, startBackgroundDownloads } = ob;
+  const { selectedSummaryModel, summaryModelDownloaded, startBackgroundDownloads } = ob;
+  // Модель распознавания по умолчанию: Whisper large-v3-turbo-q5_0 (lib/speech-model.ts), Parakeet остаётся выбором в настройках
+  const model = useDefaultSpeechModel();
 
   const [isMac, setIsMac] = useState<boolean | null>(null);
   useEffect(() => {
@@ -61,22 +59,13 @@ export function AidOnboarding({ onComplete }: { onComplete: () => void }) {
   const downloadsStarted = useRef(false);
   const summaryStarted = useRef(false);
   const [downloadsOn, setDownloadsOn] = useState(false);
-  const [speechError, setSpeechError] = useState(false);
-  const [stalled, setStalled] = useState(false);
-  const [retrying, setRetrying] = useState(false);
-  const lastProgressAt = useRef(0);
 
   const startDownloads = useCallback(() => {
     if (downloadsStarted.current) return;
     downloadsStarted.current = true;
-    lastProgressAt.current = Date.now();
     setDownloadsOn(true);
-    obLog(parakeetDownloaded ? 'модель распознавания уже скачана' : 'загрузка модели распознавания: старт');
-    startBackgroundDownloads({ includeParakeet: true, includeSummary: false }).catch((error) => {
-      obLog('загрузка модели распознавания не началась', error);
-      setSpeechError(true);
-    });
-  }, [parakeetDownloaded, startBackgroundDownloads]);
+    void model.start();
+  }, [model.start]);
 
   // Старт на первом экране: как только контекст прочитал модели с диска, или по запасному таймеру
   useEffect(() => {
@@ -99,62 +88,8 @@ export function AidOnboarding({ onComplete }: { onComplete: () => void }) {
     );
   }, [downloadsOn, selectedSummaryModel, summaryModelDownloaded, startBackgroundDownloads]);
 
-  // Ошибка и отмена загрузки: OnboardingContext только пишет их в консоль
-  useEffect(() => {
-    const offError = listen<{ modelName: string; error: string }>('parakeet-model-download-error', (event) => {
-      if (event.payload.modelName !== PARAKEET_MODEL) return;
-      obLog('загрузка модели распознавания: ошибка', event.payload.error);
-      setSpeechError(true);
-    });
-    const offProgress = listen<ParakeetDownloadProgressEvent>('parakeet-model-download-progress', (event) => {
-      if (event.payload.modelName !== PARAKEET_MODEL) return;
-      lastProgressAt.current = Date.now();
-      setStalled(false);
-      setSpeechError(event.payload.status === 'cancelled');
-    });
-    return () => {
-      void offError.then((off) => off());
-      void offProgress.then((off) => off());
-    };
-  }, []);
-
-  // Загрузка не начинается: через STALL_MS без событий предложить «Повторить»
-  useEffect(() => {
-    if (!downloadsOn || parakeetDownloaded) return;
-    const timer = window.setInterval(() => {
-      if (Date.now() - lastProgressAt.current > STALL_MS && parakeetProgressInfo.percent === 0) {
-        setStalled((was) => {
-          if (!was) obLog(`загрузка модели распознавания: нет событий ${STALL_MS} мс`);
-          return true;
-        });
-      }
-    }, 1000);
-    return () => window.clearInterval(timer);
-  }, [downloadsOn, parakeetDownloaded, parakeetProgressInfo.percent]);
-
-  const retry = useCallback(() => {
-    setRetrying(true);
-    lastProgressAt.current = Date.now();
-    withTimeout('parakeet_retry_download', () => ob.retryParakeetDownload())
-      .then(() => setSpeechError(false))
-      .catch((error) => {
-        // Команда может ждать конца загрузки: долгий ответ значит, что загрузка идёт
-        if (error instanceof SlowError) setSpeechError(false);
-      })
-      .finally(() => {
-        setStalled(false);
-        setRetrying(false);
-      });
-  }, [ob]);
-
-  const speech: SpeechModelState = {
-    ready: parakeetDownloaded,
-    percent: parakeetDownloaded ? 100 : parakeetProgressInfo.percent,
-    downloadedMb: parakeetProgressInfo.downloadedMb,
-    totalMb: parakeetProgressInfo.totalMb,
-    failed: !parakeetDownloaded && (speechError || stalled),
-    retrying,
-  };
+  const speech = model.state;
+  const retry = model.retry;
 
   // ─── Завершение без перезагрузки ───
   const [finish, setFinish] = useState<FinishState>('idle');
@@ -188,7 +123,8 @@ export function AidOnboarding({ onComplete }: { onComplete: () => void }) {
     setFinish('saving');
     withTimeout(
       'completeOnboarding',
-      () => ob.completeOnboarding(),
+      // complete_onboarding пишет Parakeet: модель по умолчанию сохраняем после него
+      () => ob.completeOnboarding().then(saveDefaultSpeechModel),
       () => {
         // Поздний ответ: настройки сохранились, человек ещё ждёт на экране
         obLog('complete_onboarding ответил поздно, настройки сохранены');
@@ -213,9 +149,9 @@ export function AidOnboarding({ onComplete }: { onComplete: () => void }) {
     const list: StepId[] = ['hello'];
     if (isMac) list.push('access');
     // «Почти готово» не нужен, если модель распознавания уже есть (но не убираем экран из-под человека)
-    if (!parakeetDownloaded || step === 'ready') list.push('ready');
+    if (!speech.ready || step === 'ready') list.push('ready');
     return list;
-  }, [isMac, parakeetDownloaded, step]);
+  }, [isMac, speech.ready, step]);
 
   const next = useCallback(() => {
     const following = steps[steps.indexOf(step) + 1];
```

</details>

**Настройки** (`src/aid/pages/Settings.tsx`, после katanana23/meetily#18): во вкладку «Распознавание» над `TranscriptSettings`:

```tsx
import { LanguageSelect, LanguageHint } from '@/aid/components/LanguageSelect';
// ...
<TabsContent value="transcription" className={TAB}>
  <Section title={t('settingsLanguageTitle')}>
    <Row title={t('recognitionLanguage')} hint={<LanguageHint />}>
      <LanguageSelect />
    </Row>
  </Section>
  <LegacyTile title={t('settingsTranscription')}>…</LegacyTile>
</TabsContent>
```

Пока этой строки нет, выбора языка в настройках aid нет вообще (его не было и до PR: `TranscriptSettings` его не содержит, оригинальный `LanguageSelection` жил только в старом `SettingsModal`).

### Причины симптомов

**1. Транскрипт прыгает между английским и португальским**

- Движок по умолчанию был Parakeet: его ставят первый запуск (`AidOnboarding.tsx:29`), база при создании (`database/commands.rs:209`) и `complete_onboarding` (`onboarding.rs:195`). Parakeet v3 многоязычный (25 европейских языков, в том числе русский, английский, португальский), языка на вход не принимает: ветка Parakeet в `audio/transcription/worker.rs:480` язык не читает вообще. Каждый кусок речи модель решает заново, на каком он языке.
- Whisper с языком «авто»: `whisper_engine.rs:570` передаёт `None`, и whisper.cpp определяет язык на каждом куске заново: каждый кусок распознаётся в новом состоянии (`ctx.create_state()`), без контекста прошлых. **Гипотеза подтверждена.**
- В распознавание идёт смесь микрофона и звука компьютера (`pipeline.rs:851` → `vad_processor`). Детектор речи Silero VAD (нейросеть, которая отделяет речь от тишины) принимает вокал и часть музыки за речь, и песня уходит в распознавание. Английские и португальские фразы, скорее всего, слова песни или выдумки модели на музыке.

**2. Музыка заикается при старте записи со звуком компьютера** (по вероятности, проверить чек-листом)

- а) Если музыка играет в Bluetooth-наушниках (AirPods) и микрофон выбран с них же, macOS переключает наушники в режим гарнитуры (HFP): звук становится моно, с провалом при переключении. Это не ошибка приложения, лечится выбором встроенного микрофона.
- б) **Обработка микрофона идёт на потоке реального времени.** Фильтр низких частот, нормализатор громкости EBU R128 с true-peak и ресемплер `rubato` (пересчёт частоты дискретизации) выполняются прямо в колбэке cpal (`stream.rs:250` → `pipeline.rs:399`), под `std::sync::Mutex`. До этой ветки в dev эти крейты были без оптимизаций: при микрофоне 16 или 24 кГц около 30 % колбэков дольше бюджета 10 мс, худший 22,7 мс (замер ниже).
- в) **Колбэк захвата звука компьютера** (`capture/core_audio.rs:168`) на каждом цикле спрашивает у Core Audio частоту устройства (`nominal_sample_rate()`, межпроцессный вызов к `coreaudiod` на потоке реального времени) и берёт `std::sync::Mutex`. Плюс при старте создаются process tap (перехват вывода системы) и приватное агрегатное устройство на выходе: короткий щелчок в этот момент ожидаем, постоянное заикание уже признак перегрузки цикла (в журнале `coreaudiod` строки про overload).
- г) **Нагрузка Parakeet.** Три сессии ONNX Runtime (ORT, движок нейросетей), каждая с потоками по числу ядер и параллельным исполнением (`parakeet_engine/model.rs:119–128`), плюс Silero VAD на том же ORT. На каждом куске речи ORT занимает все ядра. От профиля сборки не зависит; с Whisper по умолчанию основная работа уходит на GPU через Metal.

**3. Фразы обрезаны («And nothing has a»)**

- Детектор речи закрывает кусок после 500 мс тишины (`pipeline.rs:27`), кусок распознаётся отдельно, без контекста. Любая пауза на вдох режет фразу (задача 756 в репозитории оригинала).
- Окно микширования 600 мс: когда один поток отстал, его остаток добивается нулями (`pipeline.rs:105–150`). В речь вставляются куски тишины, от 500 мс детектор речи режет фразу.
- Пропуски колбэков микрофона в dev (п. 2б) рвут речь.
- Сама нагрузка куски не выбрасывает: рабочий распознавания один, очередь без ограничения (`worker.rs:74`), текст просто запаздывает.
- Английская фраза при русской речи, скорее всего, кусок песни, разрезанный детектором речи.

Пункты 2б, 2в, 2г и 3 в ядре записаны в `docs/case/decisions.md` как отложенные до сборки .app.

### Проверка гипотез

| Гипотеза | Итог |
|---|---|
| Автоопределение языка на каждом куске заново | Подтверждена для Whisper. У Parakeet языка нет вовсе |
| В dev ядро и whisper.cpp без оптимизаций, отсюда нагрузка | **Частично.** `opt-level` для dev не было. Но whisper.cpp оптимизирован и так: `whisper-rs-sys` 0.11.1 ставит CMake `profile("Release")`, а в debug `RelWithDebInfo` (`build.rs:158`, `build.rs:231`). ONNX Runtime приходит готовой оптимизированной библиотекой. Без оптимизаций был Rust: обработка микрофона, ресемплер, микширование, обёртки VAD, цикл декодера Parakeet |
| Заикание даёт сам захват звука компьютера | Возможно, частично (п. 2в). Различить можно только на Mac, шаги в чек-листе |

### Замер

Загрузку процессора на Mac во время записи замерить не получилось: сессия облачная (Linux, без Mac и звуковых устройств), а Hugging Face и сервер моделей Meetily из неё закрыты (403). Замерил то, что меняет профиль сборки: копию цепочки микрофона из ядра на тех же версиях крейтов (`ebur128` 0.1.10, `rubato` 0.15.0). Колбэки по 10 мс, минута звука, Intel Xeon 2,1 ГГц; ядро Apple M быстрее примерно в 1,5–2 раза, порядок тот же.

| Микрофон | dev до ветки | зависимости `opt-level = 3` (эта ветка) | всё `opt-level = 3` |
|---|---|---|---|
| 48 кГц (без ресемплинга) | 7,5–8,1 % ядра; колбэк макс. 4,2 мс | 0,6 %; макс. 0,5 мс | 0,2 %; макс. 0,2 мс |
| 44,1 кГц | 18,5 % | 1,2 % | 0,6 % |
| 24 кГц (гарнитура) | 48,8 %; p99 13,1 мс, макс. 22,7 мс, **1732 из 6000 колбэков дольше 10 мс** | 2,6 %; макс. 0,9 мс, 0 | 1,6 %; макс. 0,6 мс, 0 |
| 16 кГц (гарнитура) | 46,4 %; p99 17,3 мс, макс. 22,8 мс, **1874 из 6000** | 2,6 %; макс. 1,7 мс, 0 | не мерил |

### Детали правок

**Язык.** Если ключа `primaryLanguage` в `localStorage` нет (человек язык не выбирал), до монтирования `ConfigProvider` в него пишется язык системы из `navigator.languages`, если Whisper его знает (`nb`/`nn` → `no`, `iw` → `he`); иначе остаётся «авто». `ConfigContext` оригинала читает ключ в начальном состоянии и сам отправляет язык в ядро командой `set_language_preference`, один вызов без гонки. Сохранённый выбор, в том числе «авто», не трогается; ключ и формат прежние.

**Модель.** `useDefaultSpeechModel()` возвращает то же состояние, что ждёт `ReadyStep` (готовность, проценты, мегабайты, ошибка, повтор). Если модель уже скачана или качается, повторно не качает; без событий 20 с на 0 % предлагает «Повторить». Только существующие команды: `whisper_init`, `whisper_get_available_models`, `whisper_download_model`, `api_save_transcript_config`. Почему `large-v3-turbo-q5_0`: turbo это кодировщик large-v3 с декодером из 4 слоёв вместо 32, качество близко к large-v3, работает быстрее medium; q5_0 (веса сжаты до 5 бит) втрое меньше (547 МБ). На Mac считает на GPU через Metal. На Windows и Linux без GPU будет считать на процессоре заметно медленнее Parakeet; если это важно, можно выбирать модель по платформе.

**Cargo.toml.** Профили в `frontend/src-tauri/Cargo.toml` Cargo игнорирует (член рабочей области), поэтому правка в корневом. Зависимости собираются с оптимизацией, само приложение без неё: пересборка после правок прежняя. **Первый `tauri dev` после этой ветки дольше**: один раз пересоберутся все зависимости, включая whisper.cpp через CMake. Скорость whisper.cpp и ONNX Runtime правка не меняет (они оптимизированы и так).

## Related Issue

Нет: задача из чата, симптомы на Mac в режиме разработки.

## Type of Change
- [x] Bug fix
- [x] New feature
- [x] Documentation update
- [x] Performance improvement
- [ ] Code refactoring
- [ ] Other (please describe)

## Testing
- [ ] Unit tests added/updated
- [x] Manual testing performed
- [x] All tests pass

- `npx tsc --noEmit`: без ошибок (и с патчем онбординга).
- `pnpm build`: собирается, 11 страниц.
- `cargo metadata` по корневому `Cargo.toml` проходит. Сборку Rust не запускал (правила проекта).
- Язык в браузере на заглушках (`?mock=full`, Playwright с разной локалью):

| Локаль, сохранённый выбор | `primaryLanguage` | В ядро |
|---|---|---|
| `ru-RU`, выбора нет | `ru` | `ru`, один вызов |
| `ru-RU`, выбрано `auto` | `auto` | `auto` |
| `ru-RU`, выбрано `en` | `en` | `en` |
| `kk-KZ` (Whisper не знает), выбора нет | нет | `auto` |
| `nb-NO`, выбора нет | `no` | `no` |

- Первый запуск с патчем (`?mock=onboarding`, локально, не в ветке): вызовы и экран выше.
- Не делал: `pnpm tauri:dev`, проверку на Mac.

## Documentation
- [x] Documentation updated (`docs/case/decisions.md`)
- [ ] No documentation needed

## Checklist
- [x] Code follows project style
- [x] Self-reviewed the code
- [x] Added comments for complex code
- [ ] Updated README if needed
- [x] Branch is up to date with devtest (ветка от `aid`)
- [x] No merge conflicts (возможен конфликт в `docs/case/decisions.md` с katanana23/meetily#19: обе ветки добавляют запись сверху, решается оставлением обеих)

## Screenshots (if applicable)

Интерфейс в ветке не меняется: `LanguageSelect` и хук модели пока никуда не вставлены. Кадры первого запуска с патчем сняты локально: «219 из 547 МБ, 40 %» и «Скачана, можно записывать».

## Additional Notes

### Чек-лист проверки на Mac

**Сборка**
1. Подтянуть ветку и запустить лаунчером. Первая сборка дольше обычного (пересборка зависимостей), дальше как раньше.

**Язык**

2. В консоли разработчика (⌘⌥I) строка `[aid] Язык распознавания по умолчанию из системы: ru`, в терминале ядра `Setting language preference to: ru`.
3. Если строки нет: `localStorage.getItem('primaryLanguage')`. Если там `"auto"`, он сохранён раньше и правка его не трогает. Сбросить: `localStorage.removeItem('primaryLanguage')`, перезапустить.

**Модель** (текущая установка не меняется: первый запуск уже пройден)

4. Настройки → Распознавание: выбрать Local Whisper и `large-v3-turbo-q5_0`, дождаться загрузки. В терминале при старте записи `🎤 Initializing Whisper`.
5. Звук компьютера включён, музыка играет, говорить по-русски 2 минуты. Ожидание: текст по-русски; слова песни могут попадать в текст, раз она тоже идёт в распознавание.
6. То же без звука компьютера. Сравнить.
7. Отметить, успевает ли текст за речью (запаздывание реплик в секундах).

**Заикание**

8. Куда играет звук и какой микрофон: если Bluetooth-наушники и микрофон с них, выбрать встроенный микрофон в Настройки → Запись и повторить. Частота микрофона: строка `Persistent resampler initialized for '…' (24000Hz → 48000Hz…)` в терминале или «Настройка Audio-MIDI».
9. Загрузка процессора во время записи, в отдельном окне терминала (пишет в файл раз в 2 секунды):

```bash
top -l 0 -s 2 -stats pid,command,cpu,th -pid "$(pgrep -x ShadeNotes | head -1)" | tee ~/shadenotes-cpu.log
```

10. Перегрузка звукового цикла, в ещё одном окне:

```bash
log stream --style compact --predicate 'process == "coreaudiod"' | grep -i -E "overload|skipping"
```

11. Переполнение микшера в терминале ядра: `SYSTEM AUDIO BUFFER OVERFLOW` или `Microphone buffer overflow`.
12. Три записи по 1 минуте с музыкой: только микрофон; микрофон и звук компьютера; то же в релизной сборке .app (`pnpm tauri:build`). Для каждой отметить: заикание (нет, щелчок при старте, постоянно), % CPU из п. 9 (средний и пик), есть ли строки из п. 10 и 11. По этим цифрам решаем отложенные правки ядра (`docs/case/decisions.md`).

**После вставки патча онбординга** (после слияния #19): проверить в браузере `?mock=onboarding` (вызовы в консоли строками `[aid] модель распознавания`). На Mac первый запуск проходит только новая установка, текущие данные он не трогает.

### Код замера

<details>
<summary>dspbench: копия цепочки микрофона, запуск в трёх профилях</summary>

`Cargo.toml`: зависимости `ebur128 = "=0.1.10"`, `rubato = "=0.15.0"`; профили `opt` (наследует `dev`, `[profile.opt.package."*"] opt-level = 3`) и `optall` (то же плюс `opt-level = 3` для самого крейта). Запуск: `./target/<профиль>/dspbench <минут> <частота микрофона>`.

```rust
// Копия горячего пути микрофона из frontend/src-tauri/src/audio (pipeline.rs, audio_processing.rs, vad.rs):
// HPF -> EBU R128 (I + TRUE_PEAK, loudness_global каждые 512 сэмплов) -> limiter; ресемплер rubato SincFixedIn;
// понижение до 16 кГц как в vad.rs. Замер: сколько мс процессора уходит на 1 с звука, по минутам записи.
use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
use std::time::Instant;

struct Hpf { alpha: f32, pi: f32, po: f32 }
impl Hpf {
    fn new(sr: u32, c: f32) -> Self { let rc = 1.0/(2.0*std::f32::consts::PI*c); let dt = 1.0/sr as f32; Self{alpha: rc/(rc+dt), pi:0.0, po:0.0} }
    fn process(&mut self, s: &[f32]) -> Vec<f32> { let mut o = Vec::with_capacity(s.len()); for &x in s { let y = self.alpha*(self.po + x - self.pi); self.pi = x; self.po = y; o.push(y);} o }
}
struct Lim { la: usize, buf: Vec<f32>, gr: Vec<f32>, pos: usize }
impl Lim {
    fn new(sr: u32) -> Self { let la = (sr as usize*10/1000).max(1); Self{la, buf: vec[0.0;la], gr: vec[1.0;la], pos:0} }
    fn process(&mut self, s: f32, lim: f32) -> f32 { self.buf[self.pos]=s; let a=s.abs(); self.gr[self.pos]= if a>lim {lim/a} else {1.0}; let op=(self.pos+1)%self.la; let o=self.buf[op]*self.gr[op]; self.pos=op; o }
}
struct Norm { e: ebur128::EbuR128, lim: Lim, g: f32, b: Vec<f32>, tp: f32 }
impl Norm {
    fn new(sr: u32) -> Self { Self{ e: ebur128::EbuR128::new(1, sr, ebur128::Mode::I | ebur128::Mode::TRUE_PEAK).unwrap(), lim: Lim::new(sr), g:1.0, b: Vec::with_capacity(512), tp: 10f32.powf(-1.0/20.0)} }
    fn process(&mut self, s: &[f32]) -> Vec<f32> {
        let mut o = Vec::with_capacity(s.len());
        for &x in s { self.b.push(x); if self.b.len() >= 512 { if self.e.add_frames_f32(&self.b).is_ok() { if let Ok(l) = self.e.loudness_global() { if l.is_finite() && l < 0.0 { self.g = 10f32.powf((-23.0 - l) as f32/20.0); } } } self.b.clear(); }
            o.push(self.lim.process(x*self.g, self.tp)); }
        o
    }
}
fn vad_resample(sr: u32, s: &[f32]) -> Vec<f32> {
    let ratio = sr as f64/16000.0; let n = (s.len() as f64/ratio) as usize; let fs = 2usize; // как в vad.rs: min(filter,5) => 2 при cutoff 0.4
    let mut f = Vec::with_capacity(s.len());
    for i in 0..s.len() { let st = i.saturating_sub(fs); let en = (i+fs+1).min(s.len()); let sum: f32 = s[st..en].iter().sum(); f.push(sum/(en-st) as f32); }
    let mut r = Vec::with_capacity(n);
    for i in 0..n { let p = i as f64*ratio; let k = p as usize; let fr = p - k as f64; if k+1 < f.len() { r.push(f[k] + (f[k+1]-f[k])*fr as f32); } else if k < f.len() { r.push(f[k]); } }
    r
}

fn main() {
    let minutes: usize = std::env::args().nth(1).map(|s| s.parse().unwrap()).unwrap_or(5);
    let mic_sr: u32 = std::env::args().nth(2).map(|s| s.parse().unwrap()).unwrap_or(48000);
    let target = 48000u32;
    let mut hpf = Hpf::new(target, 80.0);
    let mut norm = Norm::new(target);
    let mut rs = if mic_sr != target {
        let ratio = target as f64 / mic_sr as f64;
        let (sl, it, ov) = if ratio >= 2.0 {(512, SincInterpolationType::Cubic, 512)} else if ratio >= 1.5 {(384, SincInterpolationType::Cubic, 384)} else if ratio > 1.0 {(256, SincInterpolationType::Linear, 256)} else {(384, SincInterpolationType::Linear, 384)};
        Some(SincFixedIn::<f32>::new(ratio, 2.0, SincInterpolationParameters{ sinc_len: sl, f_cutoff: 0.95, interpolation: it, oversampling_factor: ov, window: WindowFunction::BlackmanHarris2 }, 512, 1).unwrap())
    } else { None };
    let cb = (mic_sr / 100) as usize; // колбэк 10 мс
    let mut phase = 0f32; let mut rs_buf: Vec<f32> = Vec::new();
    let mut mix_buf: Vec<f32> = Vec::new();
    for m in 0..minutes {
        let t = Instant::now(); let mut lat: Vec<f64> = Vec::with_capacity(6000);
        for _ in 0..(60*100) {
            let tc = Instant::now();
            let mut chunk = Vec::with_capacity(cb);
            for _ in 0..cb { phase += 0.031; chunk.push((phase.sin()*0.2) + ((phase*7.3).sin()*0.05)); }
            let data = if let Some(r) = rs.as_mut() {
                rs_buf.extend_from_slice(&chunk); let mut out = Vec::new();
                while rs_buf.len() >= 512 { let inp: Vec<f32> = rs_buf.drain(..512).collect(); let o = r.process(&[inp], None).unwrap(); out.extend_from_slice(&o[0]); }
                out
            } else { chunk };
            let d = hpf.process(&data);
            let d = norm.process(&d);
            mix_buf.extend_from_slice(&d);
            lat.push(tc.elapsed().as_secs_f64()*1000.0);
            while mix_buf.len() >= 28800 { let w: Vec<f32> = mix_buf.drain(..28800).collect(); let v = vad_resample(48000, &w); std::hint::black_box(v); }
        }
        lat.sort_by(|a,b| a.partial_cmp(b).unwrap()); let over = lat.iter().filter(|&&x| x > 10.0).count();
        println!("   колбэк 10 мс: p50 {:.2} мс, p99 {:.2} мс, макс {:.2} мс, дольше 10 мс: {}", lat[lat.len()/2], lat[lat.len()*99/100], lat[lat.len()-1], over);
        let ms = t.elapsed().as_secs_f64()*1000.0;
        println!("минута {:>2}: {:>8.1} мс процессора на 60 с звука = {:.2} % одного ядра", m+1, ms, ms/600.0);
    }
}
```

</details>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01JzvomxK3yuhX7JLu3gB67K

## Обсуждение

**vercel[bot], 2026-11-07T07:26**

[vc]: #ZgO2NTmNw0IU8ps+noAdEF/TzxvjyltnSFifuBygoj8=:eyJpc01vbm9yZXBvIjp0cnVlLCJ0eXBlIjoiZ2l0aHViIiwicHJvamVjdHMiOlt7Im5hbWUiOiJtZWV0aWx5IiwicHJvamVjdElkIjoicHJqX3lEek5SV21QVVVHNW0yTTdZN3N3dDJTY1BwRWciLCJsaXZlRmVlZGJhY2siOnsicmVzb2x2ZWQiOjAsInVucmVzb2x2ZWQiOjAsInRvdGFsIjowLCJsaW5rIjoibWVldGlseS1naXQtY2xhdWRlLXRydXN0aW5nLWJvaHItYjUyazdpLWFpZHhvMjMtMzExOC52ZXJjZWwuYXBwIn0sImluc3BlY3RvclVybCI6Imh0dHBzOi8vdmVyY2VsLmNvbS9haWR4bzIzLTMxMTgvbWVldGlseS82dHJBdGc1cWlzWERxNktBSmNCYmZ6VkQ2TUJ0IiwicHJldmlld1VybCI6Im1lZXRpbHktZ2l0LWNsYXVkZS10cnVzdGluZy1ib2hyLWI1Mms3aS1haWR4bzIzLTMxMTgudmVyY2VsLmFwcCIsIm5leHRDb21taXRTdGF0dXMiOiJERVBMT1lFRCIsInJvb3REaXJlY3RvcnkiOiJmcm9udGVuZCJ9XX0=
The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).

| Project | Deployment | Actions | Updated |
| :--- | :----- | :------ | :------ |
| <a href="https://vercel.com/aidxo23-3118/meetily"><sup><img src="https://vercel.com/api/www/avatar?projectId=prj_yDzNRWmPUUG5m2M7Y7swt2ScPpEg&teamId=team_c62k2HRzgnM0ltkkQq1HHgp8&s=32" width="16" height="16" align="middle" alt="" /></sup></a> [meetily](https://vercel.com/aidxo23-3118/meetily) | ![Ready](https://vercel.com/static/status/ready.svg) [Ready](https://vercel.com/aidxo23-3118/meetily/6trAtg5qisXDq6KAJcBbfzVD6MBt) | [Preview](https://meetily-git-claude-trusting-bohr-b52k7i-aidxo23-3118.vercel.app) | <relative-time datetime="2026-11-07T11:51:54.763Z">Nov 7, 2026 11:51am UTC</relative-time> |



