# #28 Переименование в Shade: интерфейс, документы, идентичность, перенос данных

- Статус: слит, 2026-11-16
- Ветка: `shade-rename` → `aid`
- Автор: katanana23
- Исходная ссылка: https://github.com/katanana23/shade/pull/28

## Описание

## Что сделано
Продукт везде называется Shade. Слой интерфейса `frontend/src/aid` → `frontend/src/shade` (импорты, `Aid*` → `Shade*`, классы и события `aid-*` → `shade-*`, журнал `[shade]`, ключи `shade.*`, знак `public/brand/shade.*`, npm-пакет `shade`, `bun test src/shade`), тексты и документы (CLAUDE.md, docs/, README с одной строкой «основан на Meetily»). Ядро отдельным коммитом `chore(fork): идентичность Shade в ядре`: `identifier` `io.github.katanana23.shade`, `productName`, бинарник и заголовок окна `Shade`, папки `Application Support/Shade` и `~/Movies/Shade`. Проверка CI теперь `shade-check.yml` (ветки `shade` и `aid`) и с отдельной задачей для скрипта переноса.

Данные на Mac перенесены `scripts/migrate-from-aid.sh` и проверены в собранном `Shade.app`: 34 встречи (29 в списке, 5 в корзине), транскрипт открывается, «Открыть папку» ведёт в `~/Movies/Shade/…`, модели «Готово», онбординг и скачивание не начинались, ошибок в журнале ядра нет. Старые папки в `_to_delete` рядом с прежним местом, ничего не удалено.

## Разбор до начала
- **Что сломается первым:** доступы macOS (микрофон, запись экрана и звука системы) привязаны к `identifier`. С новым `io.github.katanana23.shade` система спросит их заново; без них запись пойдёт без звука собеседников.
- **Что скажет владелец:** «где мои записи»: папка теперь `~/Movies/Shade`, корзина в ней `Корзина Shade`. И «почему снова спрашивает доступ» (пункт выше).
- **Что придётся переделывать через неделю:** после переименования ветки `aid` → `shade` убрать `aid` из `branches` в проверке CI; после пары недель без жалоб удалить папки из `_to_delete` и резервную копию руками.

## Таблица случаев
Новые имена: `identifier` `io.github.katanana23.aid-meetings` → `io.github.katanana23.shade`; `Application Support/Aid Meetings` → `Application Support/Shade`; `~/Movies/aid-meetings-recordings` → `~/Movies/Shade`; `Корзина ShadeNotes` → `Корзина Shade`; ключи `aid.*` и `aid-meetings.theme` → `shade.*`, `shade.theme`.

| Вход | Ожидаемое | Что при отказе (модель, ядро, файл) | Тест |
|---|---|---|---|
| Первый запуск скрипта, старые данные есть, приложение закрыто | Каждая папка копируется клоном APFS во временную `<цель>.shade-migrating`, сверяется `diff -rq`, затем в копии правятся пути: `folder_path` в базе, `from` в `trashed.json`, ключи и пути в localStorage. Проверка: число встреч то же, старых путей 0, `integrity_check` ok. Только потом `mv` во что-то с новым именем и метка `.shade-migrated` | Любая проверка красная: временная папка не становится настоящей, скрипт выходит с ошибкой, старые папки не тронуты | `scripts/test-migrate-from-aid.sh`: «первый прогон» |
| Первый запуск нового приложения после миграции | Те же встречи, записи открываются по новым путям, корзина видна, модели на месте (`onboarding-status.json` и `models/` перенесены), онбординг и скачивание не начинаются | Если встреч нет: старые данные целы, резервная копия на рабочем столе; запустить скрипт снова | Ручная проверка на Mac (ниже) |
| Повторный запуск скрипта | Каждая цель с меткой `.shade-migrated`: «уже перенесено», ничего не меняется, итоговая проверка проходит снова, выход 0 | Нет | «повторный прогон»: снимок дерева до и после совпадает |
| Старых данных нет | По каждой папке «нет, пропуск», выход 0; новое приложение начнёт с чистого листа | Нет | «нет старых данных» |
| Прерывание на середине (Ctrl+C, сбой копирования, нет места) | Настоящая цель появляется только атомарным `mv` после проверок, поэтому прерывание оставляет лишь `<цель>.shade-migrating`. Следующий прогон откладывает её в `<цель>.shade-migrating.stale-<время>` (не удаляет) и копирует заново | Старые данные не тронуты на любом шаге | «прерывание»: временная папка без метки, повторный прогон доводит до конца |
| Новое приложение запускали до миграции (цель есть без метки) | Цель откладывается в `<цель>.pre-migration-<время>`, перенос идёт дальше; ничего не удаляется | Нет | «цель уже создана приложением» |
| Старое или новое приложение запущено | Скрипт отказывается: база открыта, копия может разойтись | Выход 1, ничего не тронуто | «приложение запущено» (через подмену `pgrep`) |
| `--archive-old` после проверки | Старые папки переносятся в `_to_delete` рядом с ними, только если их цель с меткой | Без метки: отказ, ничего не тронуто | «архив старого» |

## Что решил сам и почему
- **Папка записей `~/Movies/Shade`, корзина `Корзина Shade`.** «Aid Meetings» на этом Mac была папкой настроек (`Application Support/Aid Meetings`, там `notifications.json`), а записи лежали в `~/Movies/aid-meetings-recordings`. Обе стали «Shade», каждая в своём месте.
- **Перенос скриптом, без кода совместимости в приложении.** Пользователь один; постоянный код ради разового переноса и правки Rust вне строк идентичности не нужны. Запись в `docs/case/decisions.md`.
- **`aid.micAccess.v1` не переносится.** Для macOS новый `identifier` значит новое приложение, доступ к микрофону проверится заново; старое «granted» вводило бы в заблуждение.
- **Файлы оригинала Meetily не тронуты** (`components/*`, `services/*`, исходные документы сборки, `MeetilyRecoveryDB`, `meetily.meetingDetails.*`): `main` остаётся зеркалом, слияния без конфликтов. В интерфейсе Shade слово Meetily осталось только в атрибуции «О программе» (проверено в окне и на `?mock=full`). В `mock-tauri` сменил только имена (`/mock/Shade`, `shade.mock.*`, `__SHADE_MOCK__`, `shade_mock_mac_mic`), поведение то же.
- **Сборка: прямой путь был закрыт.** Первая `tauri build` упала: кеш `target/` собран, когда репозиторий лежал в `~/Desktop/meetily`, и скрипты сборки 20 пакетов помнили старый путь. Обходы: ссылка `~/Desktop/meetily` → `shade` (мусор на рабочем столе) или `cargo clean -p` для этих пакетов. Выбрал второе; кеш пакета приложения (37 ГБ) пересобран, следующие сборки снова быстрые.
- **Резервная копия** до сборки: `~/Desktop/shade-backup-2026-11-14`, 3,2 ГБ (база и модели 3,2 ГБ, записи 37 МБ, WebKit 1,3 МБ + 540 КБ, кеши 436 + 884 КБ, `Aid Meetings` 4 КБ), сверена `diff -rq`. Клоны APFS, места почти не заняла.
- **Слабое место (перечитал как ревьюер):** перенос встречи в корзину на настоящих данных я не прогонял, чтобы не трогать встречи владельца; путь `~/Movies/Shade` ядро добавило в область доступа (`fs scope: allowed recordings folder "~/Movies/Shade"`), но живой перенос папки проверит шаг 4 ниже.

## Проверки (вывод)
CI `shade-check`: `tsc, contrast, test, build` и `migrate-from-aid` зелёные.
```
 26 pass
 0 fail
 ✓ Compiled successfully
Все проверки прошли: 29        # bash scripts/test-migrate-from-aid.sh
```
Локально: `npx tsc --noEmit` без ошибок, `pnpm check:contrast` «всё проходит», `?mock=full` главная и настройки без ошибок консоли, `pnpm tauri build --debug --bundles app -- --features coreml` → `Shade.app` (`io.github.katanana23.shade`).

Перенос на Mac (хвост):
```
  встреч 34, папки записей на месте у 34, старых путей 0 (в старой базе встреч 34, папок на месте 34)
  модели: 3.41 ГБ
  первый запуск пройден: да
  всё сходится
[data] старое -> ~/Library/Application Support/_to_delete/io.github.katanana23.aid-meetings
[recordings] старое -> ~/Movies/_to_delete/aid-meetings-recordings
Ничего не удалено.
```

## Снимки и видео
Окно собранного `Shade.app`, «О программе» (без встреч владельца): [светлая](../../../docs/screenshots/shade-meeting/rename-2026-11-14/about-light.png), [тёмная](../../../docs/screenshots/shade-meeting/rename-2026-11-14/about-dark.png).

## Проверка владельца
1. Открыть `~/Desktop/shade/target/debug/bundle/macos/Shade.app` (в Dock перетащить его вместо старого `ShadeNotes`).
2. Увидеть свои встречи (29) и вкладку «Корзина» (5).
3. Записать встречу секунд на 20; macOS спросит доступ к микрофону и записи звука системы заново: разрешить.
4. Удалить эту тестовую встречу и увидеть её в «Корзине», затем «Восстановить».
5. Через пару недель без жалоб удалить папки `_to_delete` в `~/Library/Application Support`, `~/Library/WebKit`, `~/Library/Caches`, `~/Movies` `target/debug/bundle/macos` (там старый `ShadeNotes.app`) и `~/Desktop/shade-backup-2026-11-14`.

## На потом
- После слияния переименовать ветку `aid` → `shade` на GitHub и убрать `aid` из `branches` в `.github/workflows/shade-check.yml`.
- Вольт (`00 NOW.md`) на этом Mac не нашёлся, лог шага не записан.

## Вопросы
Нет. Решено владельцем: старый `ShadeNotes.app` удаляется вместе с `_to_delete` после его проверки; пока он перенесён в `target/debug/bundle/macos/_to_delete/`, чтобы его не открыли по ошибке.

🤖 Generated with [Claude Code](https://claude.com/claude-code)


## Обсуждение

**vercel[bot], 2026-11-14T10:30**

[vc]: #XKb18n+ITCmDZCZBGOS5tUTxzq1+Yjb9gQU3eOIXJ3M=:eyJpc01vbm9yZXBvIjp0cnVlLCJ0eXBlIjoiZ2l0aHViIiwicHJvamVjdHMiOlt7Im5hbWUiOiJzaGFkZSIsInByb2plY3RJZCI6InByal95RHpOUldtUFVVRzVtMk03WTdzd3QyU2NQcEVnIiwiaW5zcGVjdG9yVXJsIjoiaHR0cHM6Ly92ZXJjZWwuY29tL2FpZHhvMjMtMzExOC9zaGFkZS9GakF2dGhOVnhTYjhwSlhLSHU2aHNRSEs5TXo0IiwicHJldmlld1VybCI6InNoYWRlLWdpdC1zaGFkZS1yZW5hbWUtYWlkeG8yMy0zMTE4LnZlcmNlbC5hcHAiLCJuZXh0Q29tbWl0U3RhdHVzIjoiREVQTE9ZRUQiLCJsaXZlRmVlZGJhY2siOnsicmVzb2x2ZWQiOjAsInVucmVzb2x2ZWQiOjAsInRvdGFsIjowLCJsaW5rIjoic2hhZGUtZ2l0LXNoYWRlLXJlbmFtZS1haWR4bzIzLTMxMTgudmVyY2VsLmFwcCJ9LCJyb290RGlyZWN0b3J5IjoiZnJvbnRlbmQifV19
The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).

| Project | Deployment | Actions | Updated |
| :--- | :----- | :------ | :------ |
| <a href="https://vercel.com/aidxo23-3118/shade"><sup><img src="https://vercel.com/api/www/avatar?projectId=prj_yDzNRWmPUUG5m2M7Y7swt2ScPpEg&teamId=team_c62k2HRzgnM0ltkkQq1HHgp8&s=32" width="16" height="16" align="middle" alt="" /></sup></a> [shade](https://vercel.com/aidxo23-3118/shade) | ![Ready](https://vercel.com/static/status/ready.svg) [Ready](https://vercel.com/aidxo23-3118/shade/FjAvthNVxSb8pJXKHu6hsQHK9Mz4) | [Preview](https://shade-git-shade-rename-aidxo23-3118.vercel.app) | <relative-time datetime="2026-11-14T10:46:15.656Z">Nov 14, 2026 10:46am UTC</relative-time> |



