# Shade: ветки, имена данных, правки ядра

Продукт **Shade**, репозиторий `aidbeisembin/shade` (до 17.11.2026 ник владельца на GitHub был другим, старые адреса пока перенаправляются). С 17.11.2026 репозиторий самостоятельный: синхронизации с исходным проектом нет, его обновления сюда не приходят. Откуда проект и как было раньше: раздел «История» в конце.

## 1. Ветки

| Ветка | Назначение |
|---|---|
| `shade` | Основная и рабочая ветка. Отсюда собирается `Shade.app` |
| `feature/*`, `fix/*`, `claude/*` | Короткие ветки от `shade`, вливаются в `shade` через pull request (PR, запрос на слияние) |

- Все PR направляются в `shade`.
- Историю `shade` не переписывать (`rebase`, `push --force`): она опубликована.

## 2. Имена данных и перенос со старых

`identifier` это идентификатор приложения в `frontend/src-tauri/tauri.conf.json`. От него зависят папка данных, база, модели, хранилище WebView (встроенного окна браузера) и разрешения macOS.

| Что | Сейчас | Прежнее (до 17.11.2026) | Прежнее (до 14.11.2026) |
|---|---|---|---|
| `identifier` | `com.aidbeisembin.shade` | `io.github.katanana23.shade` | `io.github.katanana23.aid-meetings` |
| Папка данных (база, модели, настройки) | `~/Library/Application Support/com.aidbeisembin.shade/` | `~/Library/Application Support/io.github.katanana23.shade/` | `~/Library/Application Support/io.github.katanana23.aid-meetings/` |
| Хранилище окна (`localStorage`) и кеш | `~/Library/WebKit/<identifier>`, `~/Library/Caches/<identifier>` | так же, по прежнему `identifier` | так же, по прежнему `identifier` |
| Свои шаблоны и `notifications.json` (`APP_DATA_DIR_NAME`) | `~/Library/Application Support/Shade/` | не менялось | `~/Library/Application Support/Aid Meetings/` |
| Папка записей (`RECORDINGS_DIR_NAME`) | `~/Movies/Shade` | не менялось | `~/Movies/aid-meetings-recordings` |
| Корзина записей (внутри папки записей) | `Корзина Shade` | не менялось | `Корзина ShadeNotes` |
| Ключи хранилищ интерфейса | `shade.*`, тема `shade.theme` | не менялось | `aid.*`, `aid-meetings.theme` |
| `productName`, заголовок окна, сборка | `Shade`, `Shade.app` | не менялось | `ShadeNotes.app` |

Константы `APP_DATA_DIR_NAME` и `RECORDINGS_DIR_NAME` лежат в `frontend/src-tauri/src/config.rs`. Имена команд и событий Tauri не менялись.

**Перенос со старых имён**: по скрипту на каждую смену, запускать по порядку, общий движок `scripts/migrate-lib.sh`.

1. `scripts/migrate-from-aid.sh` (14.11.2026): копирует данные, правит пути в базе, метках корзины и `localStorage`.
2. `scripts/migrate-identifier.sh` (17.11.2026): копирует папки по `identifier` (Application Support, WebKit, Caches и, если есть, Logs, HTTPStorages, Saved Application State, Preferences) байт в байт. Папки `~/Movies/Shade` и `~/Library/Application Support/Shade` от `identifier` не зависят и остаются на месте; старого `identifier` в базе, настройках и `localStorage` нет, скрипт это проверяет. Разрешения macOS (микрофон, звук системы) привязаны к `identifier`: их дают заново.

Оба скрипта проверяют результат, старое не удаляют, при запущенном Shade отказываются работать; с `--archive-old` переносят старые папки в `_to_delete`. Совместимости со старыми именами в коде нет: без переноса Shade их не видит. Тесты: `scripts/test-migrate-from-aid.sh`, `scripts/test-migrate-identifier.sh`.

Любая смена этих имён отрывает данные пользователя от приложения. Делать её только вместе со скриптом переноса.

Несколько технических имён с названием исходного проекта оставлены намеренно: ключи хранилищ и запасной путь моделей. Переименование потеряло бы данные. Перечень: [`docs/isolation.md`](isolation.md), разделы 2 и 4.

## 3. Правило для правок ядра

Ядро это всё, что не интерфейс: `frontend/src-tauri/**` (Rust, `tauri.conf.json`, `Cargo.toml`, миграции), сборочные скрипты, `.github/workflows`.

- Правки ядра делаются **только по необходимости**: то, что нельзя сделать в интерфейсе, конфиге или документации.
- Каждая правка ядра это **отдельный коммит** с префиксом `fix(core):` (раньше также `chore(fork):`) и описанием «зачем». В одном коммите не смешивать ядро и интерфейс.
- Каждая правка ядра заносится в реестр правок ядра [`docs/isolation.md`](isolation.md) новым разделом: файл, строка, что и зачем.
- Чем меньше правок ядра, тем меньше риск для данных пользователя и тем проще проверка.

## История

### Откуда проект

Shade основан на Meetily ([`Zackriya-Solutions/meeting-minutes`](https://github.com/Zackriya-Solutions/meeting-minutes)), лицензия MIT. Форк сделан 2026-10-06 на версии v0.4.1 (коммит `a2cb62e`). Текст лицензии и копирайт Meetily: `THIRD_PARTY_NOTICES.md`.

Прежние рабочие названия: «Aid Meetings» до 2026-11-03, «ShadeNotes» до 2026-11-14. 14.11.2026 продукт переименован в Shade вместе с идентичностью (раздел 2).

### Ветки до 17.11.2026

- `main` была зеркалом `main` Meetily без своих коммитов и обновлялась только быстрой перемоткой (`--ff-only`) из `upstream/main`.
- `shade` была рабочей веткой форка. Обновления Meetily вливались в неё слиянием (`merge`) через ветки `sync/upstream-ГГГГММДД`, лучше по релизным тегам, после чего проверялся патч идентичности (правки, отделяющие данные Shade от данных Meetily, `docs/isolation.md`, раздел 4).
- Обсуждался merge-драйвер «ours» для `frontend/src/**` (при слиянии оставлять версию форка). Его не включали: он молча отбрасывал бы исправления Meetily.
- Правила для правок ядра требовали держать их минимальными, чтобы слияния Meetily оставались дешёвыми.

### Сосуществование с Meetily на одном Mac

Патч идентичности (коммит «chore(fork): isolate app identity», 2026-10-06) позволял ставить Shade рядом с Meetily: свой `identifier` вместо `com.meetily.ai`, константы вместо зашитых папок `Meetily` и `meetily-recordings`, убраны адрес и ключ автообновления Meetily (иначе форк обновился бы до сборки Meetily и потерял свои правки).

При общем `com.meetily.ai` общими были бы база SQLite, plugin-store, хранилище WebView и IndexedDB восстановления, сокет единственного экземпляра и разрешения macOS. Главные риски: своя миграция форка ломала бы запуск Meetily, восстановление базы удаляло бы чужие WAL и SHM, удаление встречи в одной программе стирало бы её в другой, второй экземпляр не запускался бы. Модели с самого начала лежали в папке по `identifier`; общую папку моделей предлагалось делать символической ссылкой `ln -s "$HOME/Library/Application Support/com.meetily.ai/models" "$HOME/Library/Application Support/io.github.katanana23.shade/models"`. Изоляцию проверяли так: при работе Shade даты файлов в `~/Library/Application Support/com.meetily.ai/` не менялись.

### Отвязка 17.11.2026

Репозиторий отвязан от сети форков Meetily на GitHub. Основной веткой стала `shade`, ветка `main` и теги Meetily удалены, синхронизация прекращена. Имя Meetily убрано из кода и документов, кроме `THIRD_PARTY_NOTICES.md`, этого раздела и технических имён, от которых зависят данные (раздел 2).
