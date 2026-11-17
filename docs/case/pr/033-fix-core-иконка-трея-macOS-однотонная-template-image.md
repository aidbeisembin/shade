# #33 fix(core): иконка трея macOS однотонная (template image)

- Статус: слит, 2026-11-16
- Ветка: `shade-tray-icon` → `shade`
- Автор: katanana23
- Исходная ссылка: https://github.com/katanana23/shade/pull/33

## Описание

## Что сделано
Иконка Shade в строке меню macOS теперь однотонный силуэт логотипа без фона (template image, то есть картинка, которую система сама красит под светлую и тёмную строку меню, как соседние иконки). Раньше стоял лаймовый квадрат с фоном. На Windows и Linux иконка прежняя.

Код: `tray.rs` на macOS берёт `icons/tray-template.rgba` (64x64, сырые RGBA, чёрный силуэт, глаза и искра прозрачные) и вызывает `icon_as_template(true)`. Иконка собрана из `frontend/public/brand/shade.svg` скриптом `scripts/make-tray-icon.swift` (фон-квадрат убран, светлое становится дырой). Сырой формат выбран, чтобы не менять `Cargo.toml`: `Image::from_bytes` требует feature `image-png`. Правка ядра по явной просьбе владельца, отдельным коммитом `fix(core):`, строка в `docs/isolation.md` (раздел 7). Команды и события Tauri, форматы данных не тронуты.

## Что решил сам и почему
- Прямой путь «запустить `pnpm tauri:dev`» был закрыт: уже работал чужой экземпляр Shade, а single-instance (второй экземпляр не стартует) привязан к `identifier`. Обход: сборка в клоне кеша `target/` с `TAURI_CONFIG` с другим `identifier` и `HOME` во временной папке. Данные владельца не затронуты, клон и временные папки удалены.
- Светлую тему системы сам не переключал: это системная настройка, мне нельзя. Светлую проверяет владелец (шаг 2 ниже).
- Иконка на не-macOS не менялась: чёрный силуэт на тёмной панели Windows и Linux был бы невидим.

## Проверки (вывод)
```
cargo check -p meetily --lib      -> Finished `dev` profile (8 предупреждений прежние)
cargo build -p meetily --features coreml -> Finished `dev` profile; приложение запущено, иконка в строке меню появилась
```
Фронтенд не менялся, `shade-check` не затронут.

## Снимки и видео
Тёмная строка меню, настоящее окно: `docs/screenshots/shade-tray-icon/menubar-dark-real.jpg`. Слева новая белая иконка, рядом старая лаймовая (чужой запущенный экземпляр) для сравнения. Светлая тема: не снята, см. шаг 2.

## Проверка владельца
1. Собрать и запустить: `pnpm --dir frontend tauri:dev` (закрыв старый Shade). В строке меню иконка без фона, цвет как у соседних.
2. Системные настройки → Оформление: переключить на «Светлое», иконка должна стать чёрной, как соседние. Вернуть как было.
3. Нажать на иконку: меню трея открывается как раньше.

## На потом
Если нужна запись-индикатор в трее (красная точка), это отдельная иконка не template.

## Вопросы
Нужен ли отдельный вариант иконки для записи? По умолчанию нет.

🤖 Generated with [Claude Code](https://claude.com/claude-code)


## Обсуждение

**vercel[bot], 2026-11-16T13:34**

[vc]: #wNUC9lThmmhLAnOqKAQPujuQgBovr25h7g7C5W8pCIg=:eyJpc01vbm9yZXBvIjp0cnVlLCJ0eXBlIjoiZ2l0aHViIiwicHJvamVjdHMiOlt7Im5hbWUiOiJzaGFkZSIsInByb2plY3RJZCI6InByal95RHpOUldtUFVVRzVtMk03WTdzd3QyU2NQcEVnIiwiaW5zcGVjdG9yVXJsIjoiaHR0cHM6Ly92ZXJjZWwuY29tL2FpZHhvMjMtMzExOC9zaGFkZS9Da2Y0OE5GdVFGN3JXaEp2cEx2TlY3ZDRtd0tFIiwicHJldmlld1VybCI6InNoYWRlLWdpdC1zaGFkZS10cmF5LWljb24tYWlkeG8yMy0zMTE4LnZlcmNlbC5hcHAiLCJuZXh0Q29tbWl0U3RhdHVzIjoiREVQTE9ZRUQiLCJsaXZlRmVlZGJhY2siOnsicmVzb2x2ZWQiOjAsInVucmVzb2x2ZWQiOjAsInRvdGFsIjowLCJsaW5rIjoic2hhZGUtZ2l0LXNoYWRlLXRyYXktaWNvbi1haWR4bzIzLTMxMTgudmVyY2VsLmFwcCJ9LCJyb290RGlyZWN0b3J5IjoiZnJvbnRlbmQifV19
The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).

| Project | Deployment | Actions | Updated |
| :--- | :----- | :------ | :------ |
| <a href="https://vercel.com/aidxo23-3118/shade"><sup><img src="https://vercel.com/api/www/avatar?projectId=prj_yDzNRWmPUUG5m2M7Y7swt2ScPpEg&teamId=team_c62k2HRzgnM0ltkkQq1HHgp8&s=32" width="16" height="16" align="middle" alt="" /></sup></a> [shade](https://vercel.com/aidxo23-3118/shade) | ![Ready](https://vercel.com/static/status/ready.svg) [Ready](https://vercel.com/aidxo23-3118/shade/Ckf48NFuQF7rWhJvpLvNV7d4mwKE) | [Preview](https://shade-git-shade-tray-icon-aidxo23-3118.vercel.app) | <relative-time datetime="2026-11-16T13:36:00.688Z">Nov 16, 2026 1:36pm UTC</relative-time> |



