# #30 Shade на двух языках (RU, EN) и английский демо-режим

- Статус: слит, 2026-11-16
- Ветка: `shade-i18n` → `shade`
- Автор: katanana23
- Исходная ссылка: https://github.com/katanana23/shade/pull/30

## Описание

## Слабое место (первым)
Английский проверен в Chromium на заглушках в окне 1100 × 700, а не в окне Tauri (WebKit): это ровно то, что просит `docs/dev.md` для визуальных задач, и на Mac ещё не пройдено (шаги ниже). Остальное слабое: секции оригинала на вкладках «Запись», «Распознавание», «Итоги», «Бета» в английском режиме показывают свой английский оригинал (заглавные слова Title Case, как у Meetily), а не наш тон; системные уведомления и трей рисует Rust, их язык не переключается (`src-tauri` не трогал); тексты ошибок, уже попавшие в состояние (например «Не удалось загрузить итоги»), остаются на языке момента ошибки.

## Что сделано
Shade на двух языках. Тексты: `strings.ts` (ru главный, тип `en` выводится из него, пропущенный ключ это ошибка `tsc`; значение либо строка, либо формы числа для `Intl.PluralRules`). Язык: `lib/lang.ts`, русский по умолчанию, переключатель «Язык / Language» в «Настройки → Общие» (`localStorage` `shade.lang`), смена на лету без перемонтирования, `?lang=en|ru` на время вкладки. Числа, даты, размеры, склонения через `Intl` по локали языка. Сценарий заглушек `demo-en`: 8 вымышленных встреч продуктовой команды, английский интерфейс. Страж `pnpm check:i18n` в CI. Поведение, команды Tauri, форматы данных и ключи хранилищ не менялись (новые ключи: `shade.lang`, `shade.lang.tab`, `shade.lang.demo`), `src-tauri` не тронут.

## Разбор до начала
- Что сломается первым: переключение «на лету» (тексты, посчитанные один раз при загрузке модуля: таблицы статусов, подписи приватности) и оригинальные секции настроек (мост подменял текст в уже построенных узлах).
- Что скажет владелец: «Почему английские снимки не как русские?»: поэтому русские остаются на `?mock=full`, английские на `?mock=demo-en`, рядом ниже.
- Что придётся переделывать через неделю: новые тексты, которые снова напишут русским в компоненте; страж закрывает это.

## Таблица случаев
| Вход | Ожидаемое | Что при отказе | Тест |
|---|---|---|---|
| Переключатель в настройках | язык меняется сразу, выбор сохранён, `html lang`, подписчики уведомлены, состояние компонентов цело | хранилище недоступно: язык меняется в памяти, ошибок нет | `lib/lang.test.ts` (setLang), `lang-render.test.tsx` (счётчик 1, смонтирован один раз) |
| `?lang=en` при сохранённом `ru` | вкладка английская, сохранённое не тронуто, держится после перехода без query; явный выбор в настройках снимает язык вкладки | `?lang=fr` игнорируется | `lib/lang.test.ts` (initLang) |
| `?mock=demo-en` | английский без записи в сохранённое; `?lang=ru` поверх | сценарий снят: снова сохранённый | `lib/lang.test.ts` |
| Пропущенный ключ | в en нет ключа: показан русский, в dev предупреждение; нет нигде: показан сам ключ; в `tsc` это ошибка | нет формы числа в en: берётся `other` | `strings.test.ts` (пропущенный ключ) |
| Множественное число 1 / 2 / 5 / 21 | ru: 1 слово, 2 слова, 5 слов, 21 слово (и 11, 22, 25, 101); en: 1 word, 2 words, 5 words, 21 words | дробное идёт в `other` | `strings.test.ts` (склонения) |
| Длинная строка | короткие подписи en не длиннее ru больше чем в 1,6 раза; на экранах нет горизонтального переполнения и обрезки без многоточия | длинные тексты переносятся по словам | `strings.test.ts` + проверка раскладки на 12 кадрах EN: переполнений 0 |
| Оформление EN | кавычки “…”, тире –, апостроф ’, `…`, точка как в русском, `{подстановки}` те же, формы числа полные | | `strings.test.ts` |
| Кириллица вне словаря, `t()` на верхнем уровне, `ru-RU` вне `lang.ts`, `.tsx` без `useLang()` | `pnpm check:i18n` падает | исключения только явным списком с причиной | `lib/i18n-guard.test.ts` (в том числе «репозиторий чист») |
| Формат дат, чисел, размеров, длительности | ru и en через `Intl` | пустое и битое: `null` | `lib/format.test.ts` |

Русский не сломан: тексты экранов «главная», «встреча», «корзина» в `?mock=full` до и после правки совпадают построчно; «настройки» отличаются только новым разделом языка, «итог записи» только временем.

## Что решил сам и почему
- В `pnpm check` не было такого скрипта: добавил `check` (`tsc`, контраст, `check:i18n`, тесты) и `check:i18n`, шаг в CI «Shade check» добавлен, имя задачи не менял (чтобы не сломать обязательные проверки ветки).
- Страж проверяет по разбору кода, а не по тексту: комментарии и журнал (`console`, `obLog`, поля `reason`, `detail`) не считаются, иначе пришлось бы переводить весь код с русскими комментариями. Страж проверяет и `.ts` в `lib/`, не только `.tsx`: там лежали сообщения об ошибках и подписи. Список исключений и причины в `docs/case/decisions.md`.
- Один файл словаря `strings.ts` (ru и en в нём), как заготовлено; отдельных файлов по областям нет.
- «Точка в конце как в русском» понял так: в английском точка стоит там же, где в русском (в русских подсказках из двух предложений она есть); сверяет тест.
- Короткое тире – в английском вместо русского « - ».
- Термины EN: итоги это «Summary», реплики «Segments» (как в ядре), корзина «Trash».
- Оригинальные секции настроек в английском режиме показывают английский оригинал, мост только убирает имя Meetily; при смене языка эти секции собираются заново (`key`), иначе остались бы переведённые узлы.
- В `?mock=demo-en` язык берётся из `sessionStorage` (`shade.lang.demo`), чтобы не трогать сохранённый выбор владельца.
- По просьбе владельца крестик у карточек (итог записи, уведомления, тосты, карточки про микрофон) теперь справа по центру высоты, на одной линии с кнопкой «Open», а не в углу (`CLOSE_CENTER`); у диалога остался в углу. Правило в `docs/ui/foundations.md` и `recording.md` обновлено, 
- По просьбе владельца выбранная карточка модели (Whisper, Parakeet, встроенные модели итогов, источник звука) стала чистой: поверхность плитки и ровная рамка 2 px цвета выбора вместо лаймовой тонировки по серому («грязное выделение»). Правило в `docs/ui/foundations.md`, стиль в конце `legacy.css`. Это два изменения вида вне языка.
- Для снимков использовал Chrome через DevTools Protocol, 1100 × 700 при масштабе 2: скрипт лежит вне репозитория; плашка сценария убрана из кадра. Корзину для кадра наполнил через `localStorage` (`shade.meetingTrash.v1`), поэтому у встреч подпись «The recording file stayed in its folder».
- В сценарии `demo-en` 5 реплик во время записи (больше реплик: заголовок переезжает под шапку при прокрутке, как и в русском).

## Проверки (вывод)
```
$ npx tsc --noEmit
$ pnpm check:contrast

Контраст текста на заливках: всё проходит
$ pnpm check:i18n

check:i18n ok: кириллица только в словаре, локали только в lib/lang.ts (маркеров i18n-ignore: 13)
$ pnpm test
bun test v1.3.14 (0d9b296a)

src/shade/strings.test.ts:

 107 pass
 0 fail
 4882 expect() calls
Ran 107 tests across 7 files. [450.00ms]
$ pnpm build
├   ├ /notes/team-sync-dec-26
├   ├ /notes/product-review
├   ├ /notes/project-ideas
├   └ /notes/action-items
└ ○ /settings                            2.69 kB         276 kB
+ First Load JS shared by all            87.7 kB
  ├ chunks/222-28c9ccca5a054ff7.js       32 kB
  ├ chunks/dbae917e-ea9838987a142e01.js  53.6 kB
  └ other shared chunks (total)          2.04 kB


○  (Static)  prerendered as static content
●  (SSG)     prerendered as static HTML (uses getStaticProps)
```

## Снимки и видео
Размер 1100 × 700, масштаб 2, рядом русский и английский.

**Тема светлая**

| Экран | RU (`?mock=full`) | EN (`?mock=demo-en`) |
|---|---|---|
| Главная | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-home-light.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-home-light.png" width="330"> |
| Запись | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-recording-light.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-recording-light.png" width="330"> |
| Итог записи | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-outcome-light.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-outcome-light.png" width="330"> |
| Встреча | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-meeting-light.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-meeting-light.png" width="330"> |
| Настройки | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-settings-light.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-settings-light.png" width="330"> |
| Корзина | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-trash-light.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-trash-light.png" width="330"> |

**Тема тёмная**

| Экран | RU (`?mock=full`) | EN (`?mock=demo-en`) |
|---|---|---|
| Главная | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-home-dark.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-home-dark.png" width="330"> |
| Запись | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-recording-dark.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-recording-dark.png" width="330"> |
| Итог записи | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-outcome-dark.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-outcome-dark.png" width="330"> |
| Встреча | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-meeting-dark.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-meeting-dark.png" width="330"> |
| Настройки | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-settings-dark.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-settings-dark.png" width="330"> |
| Корзина | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/ru-trash-dark.png" width="330"> | <img src="../../../docs/screenshots/shade-meeting/i18n-2026-11-16/en-trash-dark.png" width="330"> |

## Проверка владельца
1. `cd frontend && pnpm dev`, открыть `localhost:3118/?mock=demo-en`: главная на английском, восемь встреч.
2. «Settings → General»: переключить «Язык / Language» на «Русский» и обратно: текст меняется сразу, без перезагрузки; открыть вкладку «Запись»/«Recording»: секция оригинала тоже на нужном языке.
3. Открыть `localhost:3118/?mock=full&lang=en`: интерфейс английский поверх русских данных; обновить без `?lang`: держится на вкладке; в новой вкладке снова русский.
4. На Mac в `tauri dev` (WebKit): «Settings», переключить язык, пройти главную, запись и встречу, посмотреть переносы длинных строк.
5. Прочитать английские кадры выше: нет ли слов, которые вы бы сказали иначе («Summary», «Segments»).

## На потом
- Системные уведомления и трей: язык задаёт Rust (`src-tauri`), без правки ядра не переключить.
- Если нужен кейс с «живыми» длинными встречами: в `demo-en` по 150–250 слов на встречу при длительности 9–58 минут; можно дописать реплики.

## Вопросы
Название «Segments» для реплик оставить или заменить на «Lines» (по умолчанию «Segments»)?

🤖 Generated with [Claude Code](https://claude.com/claude-code)


## Обсуждение

**vercel[bot], 2026-11-16T08:38**

[vc]: #hjnMBxjdJ1qtC4wVb/xii5X0BUmgCh7/k/KKZPrpOyQ=:eyJpc01vbm9yZXBvIjp0cnVlLCJ0eXBlIjoiZ2l0aHViIiwicHJvamVjdHMiOlt7Im5hbWUiOiJzaGFkZSIsInByb2plY3RJZCI6InByal95RHpOUldtUFVVRzVtMk03WTdzd3QyU2NQcEVnIiwiaW5zcGVjdG9yVXJsIjoiaHR0cHM6Ly92ZXJjZWwuY29tL2FpZHhvMjMtMzExOC9zaGFkZS9GN1E4cnM5OHUyQ2NRclRWWnVZd01jN1gxazRyIiwicHJldmlld1VybCI6InNoYWRlLWdpdC1zaGFkZS1pMThuLWFpZHhvMjMtMzExOC52ZXJjZWwuYXBwIiwibmV4dENvbW1pdFN0YXR1cyI6IkRFUExPWUVEIiwibGl2ZUZlZWRiYWNrIjp7InJlc29sdmVkIjowLCJ1bnJlc29sdmVkIjowLCJ0b3RhbCI6MCwibGluayI6InNoYWRlLWdpdC1zaGFkZS1pMThuLWFpZHhvMjMtMzExOC52ZXJjZWwuYXBwIn0sInJvb3REaXJlY3RvcnkiOiJmcm9udGVuZCJ9XX0=
The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).

| Project | Deployment | Actions | Updated |
| :--- | :----- | :------ | :------ |
| <a href="https://vercel.com/aidxo23-3118/shade"><sup><img src="https://vercel.com/api/www/avatar?projectId=prj_yDzNRWmPUUG5m2M7Y7swt2ScPpEg&teamId=team_c62k2HRzgnM0ltkkQq1HHgp8&s=32" width="16" height="16" align="middle" alt="" /></sup></a> [shade](https://vercel.com/aidxo23-3118/shade) | ![Ready](https://vercel.com/static/status/ready.svg) [Ready](https://vercel.com/aidxo23-3118/shade/F7Q8rs98u2CcQrTVZuYwMc7X1k4r) | [Preview](https://shade-git-shade-i18n-aidxo23-3118.vercel.app) | <relative-time datetime="2026-11-16T09:32:00.175Z">Nov 16, 2026 9:32am UTC</relative-time> |



