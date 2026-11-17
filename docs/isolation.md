# Реестр правок ядра Shade

Ядро это всё, что не интерфейс: `frontend/src-tauri/**`, сборочные скрипты, `.github/workflows` (правило правок: [`FORK.md`](FORK.md), раздел 3). Здесь записана каждая правка ядра с файлом, строкой и причиной. Новая правка добавляется новым разделом в конец, номера существующих разделов не меняются: на них ссылаются другие документы.

Основа: код исходного проекта версии v0.4.1 (коммит `a2cb62e`, разведка 2026-10-06 в [`recon.md`](recon.md)) плюс патч идентичности. Номера строк указаны на момент правки и со временем могут сдвинуться.

Имена данных Shade и перенос со старых: [`FORK.md`](FORK.md), раздел 2.

---

## 1. Где приложение хранит данные

Почти все пути в Tauri 2 строятся от `identifier` из `tauri.conf.json`: на macOS `app_data_dir()` равен `~/Library/Application Support/<identifier>/`. Ядро исходного проекта местами собирало путь по зашитому имени, без учёта `identifier`; эти места патч идентичности перевёл на константы из `config.rs` (раздел 4).

| Ресурс | От чего зависит путь | Файл и строка | Состояние |
|---|---|---|---|
| **База SQLite** `meeting_minutes.sqlite` (+ `-wal`, `-shm`) и старая `meeting_minutes.db` | `app_data_dir()` → `identifier` | `frontend/src-tauri/src/database/manager.rs:46-67` (пути), `:35` (миграции), `:122-127`; `database/commands.rs:88-93`, `:228-250` | Свой `identifier`. Встречи, транскрипты, итоги и API-ключи провайдеров лежат в базе |
| **plugin-store**: `preferences.json`, `analytics.json`, `store.json`, `recording_preferences.json`, `onboarding-status.json` | Относительные имена в `app_data_dir()` → `identifier` | Интерфейс: `src/components/RecordingSettings.tsx:65,120`, `src/lib/recordingNotification.tsx:16,42`, `src/components/AnalyticsProvider.tsx:34,77`, `src/lib/analytics.ts:172`. Ядро: `src-tauri/src/audio/recording_preferences.rs:100,148`, `src-tauri/src/api/api.rs:209`, `src-tauri/src/onboarding.rs:50,88,116,141` | Имена файлов не трогать |
| **Папка записей** (звук, `transcripts.json`, метаданные встречи) | `~/Movies/<RECORDINGS_DIR_NAME>`, от `identifier` не зависит. Если пользователь выбрал свою папку, путь берётся из `recording_preferences.json` | `src-tauri/src/audio/recording_preferences.rs:43-77`; имя в `src-tauri/src/config.rs` | `RECORDINGS_DIR_NAME = "Shade"` |
| **Временный WAV при остановке из трея** | `app_data_dir()` → `identifier` | `src-tauri/src/tray.rs:66,162` | Следует за `identifier` |
| **Папка своих шаблонов** | `dirs::data_dir()/<APP_DATA_DIR_NAME>/templates`, от `identifier` не зависит | `src-tauri/src/summary/templates/loader.rs:25-30`; имя в `src-tauri/src/config.rs` | `APP_DATA_DIR_NAME = "Shade"` |
| **Настройки уведомлений** `notifications.json` | `dirs::config_dir()/<APP_DATA_DIR_NAME>`, от `identifier` не зависит. На macOS `config_dir` и `data_dir` совпадают | `src-tauri/src/notifications/settings.rs:114-127` | `APP_DATA_DIR_NAME = "Shade"` |
| **Модели Whisper, Parakeet, встроенная LLM** | `app_data_dir()/models` → `identifier` (`models/parakeet`, `models/summary`); запасной путь см. раздел 2 | `src-tauri/src/whisper_engine/commands.rs:15-32`, `parakeet_engine/commands.rs:15-19`, `summary/summary_engine/commands.rs:53`, `:363` | Код путей не менялся |
| **Логи** | Только stderr через `env_logger`, файла логов нет | `src-tauri/src/main.rs:10-11`; `src-tauri/src/console_utils/console_utils.rs` (`log stream --process Shade`) | Ничего |
| **Кэш WebView** | `~/Library/Caches/<identifier>/`, `~/Library/WebKit/<identifier>/` | Задаётся Tauri и WebKit | Свой `identifier` |
| **localStorage, sessionStorage, IndexedDB** окна | Хранилище WebKit по `identifier`; origin `tauri://localhost` | Например `src/components/MeetingDetails/MeetingDetailsSplitView.tsx:6`, `src/lib/analytics.ts:188-191`, `src/services/indexedDBService.ts:34` | Свой `identifier`. **Ключи и имя базы IndexedDB не переименовывать** (раздел 4, «Что сознательно не менялось») |
| **Трей и системные уведомления** | Центр уведомлений macOS регистрирует отправителя по bundle id; заголовки задаёт ядро | `src-tauri/src/tray.rs:23-27`; `src-tauri/src/notifications/types.rs:122-192`, `notifications/commands.rs:335,385` | Подсказка и заголовки через `APP_DISPLAY_NAME` / `APP_ERROR_TITLE` |
| **Единственный экземпляр** | Плагин `single-instance`, сокет `/tmp/<identifier с _ вместо . и ->_si.sock` | `src-tauri/src/lib.rs:452-463` | Свой `identifier` |
| **Схемы адресов (deep-link), автозапуск** | Не используются: плагинов `deep-link` и `autostart` нет | `src-tauri/Cargo.toml` (список плагинов) | Если понадобятся, давать свои имена |
| **Разрешения macOS** (микрофон, запись экрана, системный звук) | TCC хранит разрешения по bundle id и подписи; подпись ad-hoc (`signingIdentity: "-"`) | `src-tauri/Info.plist`, `src-tauri/entitlements.plist`, `tauri.conf.json` | Свой `identifier`. Ad-hoc подпись меняется при каждой сборке, macOS может спрашивать повторно |
| **Автообновление** | `plugins.updater` в `tauri.conf.json` | `src-tauri/tauri.conf.json` (`plugins.updater`, `bundle.createUpdaterArtifacts`); `src-tauri/src/lib.rs:469`; `src/hooks/useUpdateCheck.ts:20-46` | Адрес и ключ исходного проекта убраны (`endpoints: []`, `pubkey: ""`, `createUpdaterArtifacts: false`) |
| **Аналитика** | Удалена 17.11.2026 (раздел 10). Старый `analytics.json` (plugin-store) у пользователей остаётся, его никто не читает | Нет | Нечего изолировать |

## 2. Модели: путь и запасной путь

Модели (Whisper, Parakeet, встроенная LLM) лежат в `~/Library/Application Support/com.aidbeisembin.shade/models/`, путь берётся из `app_data_dir()`, то есть от `identifier`. Код путей моделей не менялся.

В коде остался запасной путь: `dirs::data_dir()` плюс папка с именем исходного проекта плюс `models` (`whisper_engine/whisper_engine.rs:154`, `parakeet_engine/parakeet_engine.rs:294`, `summary/summary_engine/model_manager.rs:148`). Он срабатывает, только когда ядро не передало папку; в обычной работе не используется. Это путь данных, его не переименовывать.

Parakeet скачивается с Hugging Face (`istupakov/parakeet-tdt-0.6b-v*-onnx`, закреплённый коммит), у каждого файла в коде размер и SHA-256 (`parakeet_engine.rs`, `PARAKEET_V3_ARTIFACTS`, `PARAKEET_V2_ARTIFACTS`). Раздел 10.

## 3. Сосуществование с исходным приложением

Раньше Shade проверяли на работу рядом с исходным приложением на одном Mac: какие ресурсы стали бы общими при общем `identifier` и чем это грозило. Сжатое описание: [`FORK.md`](FORK.md), «История». Для Shade отсюда одно правило: `identifier` и имена папок данных менять только вместе со скриптом переноса (`FORK.md`, раздел 2).

---

## 4. Перечень правок патча идентичности

Коммит «chore(fork): isolate app identity». Номера строк указаны после патча.

| Файл | Строка | Было | Стало |
|---|---|---|---|
| `frontend/src-tauri/tauri.conf.json` | 3 | имя исходного проекта | `"productName": "Shade"` |
| `frontend/src-tauri/tauri.conf.json` | 5 | `identifier` исходного проекта | `"identifier": "com.aidbeisembin.shade"` (с 17.11.2026, раздел 11; до этого `io.github.katanana23.shade`) |
| `frontend/src-tauri/tauri.conf.json` | 15 | имя исходного проекта | `"title": "Shade"` |
| `frontend/src-tauri/tauri.conf.json` | 91 | `"createUpdaterArtifacts": true` | `"createUpdaterArtifacts": false` |
| `frontend/src-tauri/tauri.conf.json` | 115 | ключ исходного проекта | `"pubkey": ""` |
| `frontend/src-tauri/tauri.conf.json` | 116 | адрес `latest.json` в релизах исходного проекта на GitHub | `"endpoints": []` |
| `frontend/src-tauri/src/config.rs` | 38-61 (новый блок в конце файла) | блока не было | макрос `fork_app_name!()` = `"Shade"`; константы `APP_DISPLAY_NAME`, `APP_ERROR_TITLE`, `APP_DATA_DIR_NAME`, `RECORDINGS_DIR_NAME = "Shade"` |
| `frontend/src-tauri/src/tray.rs` | 26 | подсказка с именем исходного проекта | `.tooltip(crate::config::APP_DISPLAY_NAME)` |
| `frontend/src-tauri/src/notifications/types.rs` | 122, 129, 139, 149, 163, 174, 192 | заголовок с именем исходного проекта | `crate::config::APP_DISPLAY_NAME` |
| `frontend/src-tauri/src/notifications/types.rs` | 182 | заголовок ошибки с именем исходного проекта | `crate::config::APP_ERROR_TITLE` |
| `frontend/src-tauri/src/notifications/commands.rs` | 335, 385 | `let title =` имя исходного проекта | `let title = crate::config::APP_DISPLAY_NAME;` |
| `frontend/src-tauri/src/notifications/settings.rs` | 118 | `path.push(…)` с именем исходного проекта | `path.push(crate::config::APP_DATA_DIR_NAME);` |
| `frontend/src-tauri/src/summary/templates/loader.rs` | 27 | `path.push(…)` с именем исходного проекта | `path.push(crate::config::APP_DATA_DIR_NAME);` |
| `frontend/src-tauri/src/summary/templates/loader.rs` | 22-24 | комментарий с именем исходного проекта | комментарий с `<APP_DATA_DIR_NAME>` (заодно исправлен путь Linux: `dirs::data_dir()` это `~/.local/share`) |
| `frontend/src-tauri/src/summary/templates/mod.rs` | 34-36 | комментарий с именем исходного проекта | комментарий с `<APP_DATA_DIR_NAME>` |
| `frontend/src-tauri/src/audio/recording_preferences.rs` | 48, 53, 61, 66, 75 | `.join(…)` с папкой записей исходного проекта | `.join(crate::config::RECORDINGS_DIR_NAME)` |
| `frontend/src-tauri/src/audio/recording_preferences.rs` | 46, 59, 72 | комментарии с папкой записей исходного проекта | комментарии с `<RECORDINGS_DIR_NAME>` |

Логика не менялась: заменены только строковые литералы на константы и значения в конфиге.

17.11.2026 оставшиеся тексты и служебные имена с именем исходного проекта в ядре заменены на Shade (имя пакета в `Cargo.toml`, User-Agent при скачивании моделей, имя аудиотапа, префикс временных файлов, переменная окружения `SHADE_LLAMA_HELPER`, текст ошибки, `log stream`). На пути данных это не влияет.

### Где менять название

Одним коммитом в двух местах (в Rust нельзя прочитать `tauri.conf.json` на этапе компиляции без новой логики):

1. `frontend/src-tauri/src/config.rs`: литерал в `fork_app_name!` и, если нужно, `RECORDINGS_DIR_NAME`.
2. `frontend/src-tauri/tauri.conf.json`: `productName` (строка 3) и `app.windows[0].title` (строка 15).

`identifier`, `APP_DATA_DIR_NAME` и `RECORDINGS_DIR_NAME` без скрипта переноса не менять: пользователь потеряет доступ к своим данным, шаблонам и папке записей (старые файлы останутся на диске).

### Что сознательно не менялось

- **Технические ключи хранилищ окна** с именем исходного проекта: ключ ширины панели транскрипта (`src/components/MeetingDetails/MeetingDetailsSplitView.tsx:6`), имя базы IndexedDB с резервной копией транскрипта (`src/services/indexedDBService.ts:34`). Переименование потеряло бы данные.
- **Пути старой базы Homebrew** с именем исходного проекта (`src/components/DatabaseImport/HomebrewDatabaseDetector.tsx:15-16`, `src/contexts/OnboardingContext.tsx:180`): это адреса, где лежит база прежней установки, их нельзя менять.
- **Запасной путь моделей**: раздел 2.
- Права в `capabilities` (`updater:default`, `process:default`). Проверка обновлений падает с ошибкой «нет адресов», ошибка тихо глотается в `useUpdateCheck.ts:41-43`.

### Как проверить, что данные на своих местах

1. `ls ~/Library/Application\ Support/` → есть `com.aidbeisembin.shade/` и, после первого сохранения шаблона или настроек уведомлений, `Shade/`.
2. Сделать запись → файлы в `~/Movies/Shade/`.

## 5. Правки ядра сверх патча идентичности (запись, восстановление, сохранение)

Разрешение владельца: только в части записи, восстановления и сохранения; форматы существующих данных не менялись (`metadata.json`, `transcripts.json`, имена `audio_chunk_NNN.mp4`, `audio.mp4`, схема базы). Коммит `fix(core): восстановление встречи после сбоя`.

| Файл | Что | Зачем |
|---|---|---|
| `frontend/src-tauri/src/crash_recovery/` (новый модуль) | Восстановление прерванных записей при запуске: команда `recover_interrupted_meetings`, разбор обрезанного `transcripts.json`, проверка и склейка кусков (`media.rs`), надёжная запись файла (`fsio.rs`), тесты | Встреча 16.11 не попала в список, потому что строка в базе создаётся только при «Остановить» |
| `frontend/src-tauri/src/lib.rs` | `pub mod crash_recovery;` (стр. 43), команда в `generate_handler!` (стр. 713) | Подключение модуля |
| `frontend/src-tauri/src/audio/recording_saver.rs` | `write_metadata` и `write_transcripts_json` пишут через `fsio::write_atomic` (временный файл, fsync, rename, fsync папки; те же имена `.metadata.json.tmp`, `.transcripts.json.tmp`) | Без fsync после жёсткого выключения мог остаться пустой или обрезанный файл под настоящим именем |
| `frontend/src-tauri/src/audio/incremental_saver.rs` | Кусок звука 30 с → `CHECKPOINT_SECONDS = 10`; кусок кодируется в `audio_chunk_NNN.mp4.part`, fsync, затем rename | Потеря при сбое до 10 с вместо 30 с; кусок под настоящим именем всегда целый |

Не менялось: `finalize` (склейка при обычной остановке), `recover_audio_from_checkpoints` и остальные команды оригинала; старое окно «восстановить?» оригинала (IndexedDB) осталось в коде и в Shade не подключено.

## 6. Правки ядра: распознавание речи и его настройки

Разрешение владельца 2026-11-16: только в части распознавания и его настроек. Форматы данных не менялись (схема базы, `transcripts.json`, `metadata.json`, имена и аргументы существующих команд и событий). Добавлена одна команда, `set_vocabulary_hint`, и один необязательный код ошибки.

| Файл | Что | Зачем |
|---|---|---|
| `src-tauri/src/audio/transcript_quality.rs` (новый) | Чистые функции: убрать служебные метки `<unk>`, оценить язык реплики, решить «в текст встречи или нет», пометить подозрительные, написание слов словаря, подсказка Whisper, список «галлюцинаций». Тесты по таблице случаев | Parakeet писал польские и английские обрывки и `<unk>` внутри слов |
| `src-tauri/src/audio/quality_bench.rs` (новый, только тесты, `#[ignore]`) | Замер схем на настоящей встрече; на экран только цифры | Выбор схемы по цифрам |
| `src-tauri/src/whisper_engine/whisper_engine.rs` | `transcribe_audio_with_prompt`: то же, что `transcribe_audio_with_confidence`, плюс необязательная подсказка (`initial_prompt`); прежняя функция вызывает новую без подсказки | Whisper получает «Частые слова» |
| `src-tauri/src/audio/transcription/worker.rs`, `whisper_provider.rs` | Живая запись: язык и подсказка из настроек, чистка текста каждого куска перед событием `transcript-update` (`finalize_live`) | Чужие языки и `<unk>` не попадают в текст встречи |
| `src-tauri/src/audio/retranscription.rs` | (интерфейс с 2026-11-17 не зовёт, «Распознать заново» убрано, ядро не менялось) Язык и подсказка из настроек, чистка, не заменять текст пустым результатом, замена текста вынесена в `replace_transcripts` (та же транзакция), код ошибки `model-missing:<имя>`, копия прежнего текста `transcripts.previous.json` рядом с записью (новый необязательный файл), тесты | «Распознать заново» |
| `src-tauri/src/audio/import.rs` | Чистка текста импортированной записи (`finalize_batch`) | `<unk>` не должен попадать ни одним путём |
| `src-tauri/src/lib.rs` | Команда `set_vocabulary_hint`; язык и слова лежат в `RECOGNITION_PREFS` (чистая логика `RecognitionPrefs` в `transcript_quality.rs`, с тестом): изменённые во время записи откладываются до следующей (`apply_pending_recognition_prefs`); `get_language_setting_now`, `get_vocabulary_setting_now` | Смена языка во время записи применяется со следующей встречи |
| `src-tauri/src/audio/recording_commands.rs` | `is_recording_sync`; `finalize_recording_start` применяет отложенные язык и слова | То же |


## 7. Правки ядра: иконка в строке меню macOS

Разрешение владельца 2026-11-16: только иконка трея. Команды и события Tauri, форматы данных не менялись. Коммит `fix(core): иконка трея macOS однотонная`.

| Файл | Что | Зачем |
|---|---|---|
| `src-tauri/src/tray.rs` | На macOS иконка трея: `Image::new` из `icons/tray-template.rgba` и `icon_as_template(true)`. На других ОС прежняя иконка приложения | Лаймовый квадрат выбивался среди однотонных иконок строки меню. Template image система красит сама под светлую и тёмную строку меню |
| `src-tauri/icons/tray-template.rgba` (новый) | 64x64, сырые байты RGBA: чёрный силуэт логотипа, глаза и искра прозрачные, фона нет. Сырой формат, потому что `Image::from_bytes` требует feature `image-png`, а `Cargo.toml` не менялся | Источник иконки трея |
| `src-tauri/icons/tray-template.png` (новый) | То же для просмотра, в сборку не входит | Посмотреть, что получилось |
| `scripts/make-tray-icon.swift` (новый) | Пересборка обоих файлов из `frontend/public/brand/shade.svg`: `swift scripts/make-tray-icon.swift` | Смена логотипа не требует ручной работы |

## 8. Правки ядра: название встречи по сути разговора

Разрешение владельца 2026-11-16: только в части генерации названия. Схема базы, форматы данных, имена и аргументы существующих команд и событий не менялись; название пишется в существующее поле `meetings.title`. Добавлены четыре команды и необязательный файл `title.json` в папке встречи. Коммит `fix(core): название встречи по сути разговора…`.

| Файл | Что | Зачем |
|---|---|---|
| `src-tauri/src/summary/title.rs` (новый) | `api_generate_title_text`: один короткий запрос к провайдеру итогов (облако только с `allow_cloud`, иначе отказ `cloud-not-allowed` до сети; таймаут 90 с); `api_set_auto_title(ожидаемое, новое, override_manual)` (`override_manual` с 2026-11-17 интерфейс не передаёт: «Придумать заново» убрано, параметр оставлен, ядро не менялось): запись с проверкой (пометка `manual`, название изменилось за время запроса); `api_mark_title_manual`, `api_get_title_origin`; файл `title.json` `{origin: manual или auto, at}` атомарной записью рядом с `recovered.json`. Тесты: `cargo test -p shade --lib summary::title` | Ручное название главнее; облако только по нажатию |
| `src-tauri/src/summary/mod.rs`, `lib.rs` | Подключение модуля, регистрация четырёх команд | |
| `src-tauri/src/summary/service.rs` | Убрано переименование встречи по заголовку `# …` из текста итогов после «Подвести итоги» | Оно писало поверх названия, заданного человеком; название теперь придумывает отдельный запрос |

## 9. Правки ядра: домен отзывов в CSP

Разрешение владельца 2026-11-16 (задача «обратная связь»): только один домен в правах окна на сеть. Команды, события, плагины, `Cargo.toml` и capabilities не менялись. Коммит `chore(fork): домен отзывов в CSP connect-src`.

| Файл | Что | Зачем |
|---|---|---|
| `src-tauri/tauri.conf.json` | В `app.security.csp.connect-src` добавлен `https://meetily-tau.vercel.app` | Окно отправляет отзыв обычным `fetch` в функцию `api/feedback` проекта Vercel «shade» (продакшен-домен проекта). Плагина `http` в ядре нет, поэтому запрос идёт из окна, и без строки CSP его блокирует WebView. Если домен проекта сменится, менять здесь и `FEEDBACK_URLS` в `src/shade/lib/feedback/send.ts` (`docs/ui/feedback.md`). С 17.11.2026 доменов два, раздел 10 |

## 10. Правки ядра: без инфраструктуры исходного проекта

Разрешение владельца 2026-11-17: источники загрузки, удаление аналитики, сборка. Форматы и пути пользовательских данных не менялись; удалены только команды аналитики. Решение и причины: `docs/case/decisions.md`, 2026-11-17. Коммиты `fix(core): …` этой ветки.

| Файл | Что | Зачем |
|---|---|---|
| `src-tauri/src/parakeet_engine/parakeet_engine.rs` | Источник v3 на Hugging Face (закреплённый коммит); `ArtifactSpec.sha256` у каждого файла v2 и v3; сумма считается после скачивания и у файла нужного размера, найденного во время загрузки; неверная: файл удаляется и качается заново один раз, затем ошибка. Обзор моделей по-прежнему по размерам. Тесты: `cargo test -p shade --lib parakeet_engine` | Сервер исходного проекта может пропасть; файл с неверной суммой не должен стать моделью |
| `src-tauri/build/ffmpeg.rs` | Адрес, SHA-256 архива и бинарника для каждой платформы (сборки Мартина Ридля, Windows: Gyan); кэш берётся только при совпадении суммы; поддержка `.tar.xz` убрана (все архивы `.zip`) | Релизы чужого репозитория могут пропасть или поменяться |
| `src-tauri/Cargo.toml` | Удалён `posthog-rs`; `sha2` в зависимостях приложения (уже был в сборочных); из сборочных удалены `tar`, `xz2` | Аналитики нет; суммы моделей |
| `src-tauri/src/analytics/` (удалён), `src-tauri/src/lib.rs` | Модуль и 25 команд `init_analytics`, `track_*`, `is_analytics_enabled` и др. сняты с регистрации | Shade не собирает статистику |
| `src-tauri/src/audio/recording_commands.rs` | Убран блок «Step 3.5»: сбор длительностей и устройств и `track_meeting_ended` при остановке | То же |
| `src-tauri/src/lib_old_complex.rs` (удалён) | Мёртвый файл, не подключался ни одним `mod`; в нём был адрес PostHog | Чистота |
| `src-tauri/tauri.conf.json` | `connect-src`: `https://aidbeisembin.com` (основной адрес отзывов) рядом с прежним доменом Vercel | Основной адрес на домене владельца, прежний запасной |

## 11. Правки ядра: идентификатор `com.aidbeisembin.shade`

Разрешение владельца 2026-11-17: только `identifier` в `tauri.conf.json`, поле `repository` в `Cargo.toml` и комментарии с путями. Команды, события, форматы данных, миграции базы и ключи хранилищ не менялись. Коммит `fix(core): идентификатор com.aidbeisembin.shade`.

| Файл | Что | Зачем |
|---|---|---|
| `src-tauri/tauri.conf.json` | `identifier`: `io.github.katanana23.shade` → `com.aidbeisembin.shade` | Перевёрнутый домен владельца `aidbeisembin.com`. Прежний ник GitHub освобождён и может достаться кому угодно |
| `src-tauri/src/config.rs` | Комментарий у констант папок данных: ссылка на `scripts/migrate-identifier.sh` | Смена `identifier` отрывает данные; перенос внешним скриптом |
| `src-tauri/src/audio/quality_bench.rs` | Путь к моделям в комментарии с примером запуска | Папка данных теперь по новому `identifier` |
| `src-tauri/Cargo.toml` | `repository` → `https://github.com/aidbeisembin/shade` | Новый ник GitHub (коммит со ссылками) |

Вместе с `identifier` переезжают папки `~/Library/Application Support/<identifier>`, `Caches/<identifier>`, `WebKit/<identifier>` (localStorage окна), а также, если есть, `Logs`, `HTTPStorages`, `Saved Application State`, `Preferences/<identifier>.plist`. Перенос: `scripts/migrate-identifier.sh` (`docs/FORK.md`, раздел 2). Совместимости со старым `identifier` в коде нет. Разрешения macOS (микрофон, звук системы) привязаны к bundle id: их нужно дать заново.

Проверка CI: в задании `migrate-from-aid` добавлен шаг `bash scripts/test-migrate-identifier.sh` (`.github/workflows/shade-check.yml`).
