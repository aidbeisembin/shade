# #27 Проверки на PR в aid и короткий CLAUDE.md

- Статус: слит, 2026-11-14
- Ветка: `claude/aid-check` → `aid`
- Автор: katanana23
- Исходная ссылка: https://github.com/katanana23/shade/pull/27

## Описание

## Что сделано
На каждый PR в `aid` теперь запускаются четыре проверки, CLAUDE.md сокращён с 47 КБ до 4 КБ (4095 байт), а всё содержание «Стека интерфейса» перенесено в `docs/ui/` без потерь. Поведение приложения не менялось, `src-tauri` не тронут.

- `.github/workflows/aid-check.yml`: на `pull_request` в `aid` выполняет `pnpm install --frozen-lockfile`, `npx tsc --noEmit`, `pnpm check:contrast`, `pnpm test`, `pnpm build` в `frontend`. Используются pnpm 9.15.9 (как в чужих workflow), Node 22 и bun 1.3.14 (`pnpm test` это `bun test src/aid`). Чужие workflow не тронуты.
- `CLAUDE.md`: проект, границы, «Принцип работы» (дословно), «Готово значит», «Логика» (три правила), данные, как работать, «Что читать», стиль, вольт.
- `docs/ui/`: `foundations.md` (стек, иконки, токены, эффекты, цвет, контраст, типографика, крестик, геометрия, логотип), `frame.md` (окно, сайдбар, шапка, прокрутка, переходы), `recording.md` (док, уведомления, микрофон), `recording-outcome.md` (три слоя, проверка моделью, корзина, после «Остановить», заглушки), `meetings-list.md`, `meeting.md`, `settings.md`, `onboarding.md`.
- `docs/dev.md`: полные тексты разделов «Проект», «Границы», «Данные», «Стиль», «Как работать», «Вольт». В 4 КБ они не помещались, поэтому в CLAUDE.md только сжатые версии.
- Числа из кода заменены ссылками на константу или токен и файл: `EMPTY_MAX_WORDS` и др. в `lib/discard-policy.ts`, `FOLLOW_SLACK_PX`, `SAVED_CARD_MS`, `EMPTY_NOTICE_MS`, `MIN_SUMMARY_WORDS`, `SHORT_EMPTY_SECONDS`, `STACK_GAP`, `LEVEL_BARS`, `LISTEN_FLOOR`, `FADE_OUT_MS`, `ROOT_HERO_SHIFT`, `ROOT_COLLAPSE_PX`, `SLOW_MS`, `CYCLE_MS`, `MEASURE`, токены `--tile-*`, `--dock-space`, `--glow-h`, цвета через `--primary`, `--indigo`, `--giants`, `--record` (hex убраны), пороги контраста через `PAIRS` в `check-contrast.mjs`.
- `.github/pull_request_template.md`: заменил шаблон оригинала на русский с нужными разделами. «Разбор до начала» и «Таблица случаев» помечены «для задач с логикой, данными или правилами».
- `.gitignore`: `frontend/src-tauri/binaries/` и `.claude/launch.json`, сами файлы на месте.
- Ссылки на старые разделы CLAUDE.md в комментариях (`check-contrast.mjs`, `MeetingRow.tsx`, `BackButton.tsx`, `close-button.tsx`, `globals.css`, `MeetingDetails.tsx`) и в `DESIGN.md` перенаправлены на `docs/ui/foundations.md`. Правились только комментарии.

## Разбор до начала
Слабое место: оглавление CLAUDE.md сжато до одной строки на область, и агент может не открыть нужный файл в `docs/ui/`. Это первое, что сломается: правило из `foundations.md` (например, «иконки только fill») нарушат, потому что его больше нет перед глазами.
- **Что скажет владелец:** 4 КБ в байтах UTF-8 это около 2000 кириллических знаков, и половину занимает «Принцип работы». Остальные разделы сжаты до одной-двух строк, подробности ушли в `docs/dev.md`. Если имелись в виду 4 тысячи знаков, разделы можно вернуть почти целиком.
- **Что придётся переделывать через неделю:** `docs/ui/*.md` расходятся с кодом, если правило поменяли, а документ нет. Ссылки на константы вместо чисел снижают этот риск, но не убирают его.

## Что решил сам и почему
- **Байты, а не знаки.** 4 КБ считал строго (`wc -c CLAUDE.md` = 4095). Чтобы ничего не потерять, полные тексты переехали в `docs/dev.md`.
- **Восемь файлов вместо пяти.** Кроме названных областей в «Стеке» были общие правила, каркас и первый запуск. Распихивать их по пяти экранам значило бы дублировать, поэтому добавил `foundations.md`, `frame.md`, `onboarding.md`.
- **Какие числа считать «из кода».** Заменял те, у которых в коде есть имя: константа, токен или класс. Размеры, которые живут только в Tailwind-классах (`size-[88px]`, 36/40) и задают дизайн, оставил: это спецификация, и ссылаться там не на что.
- **Node 22 в CI**, как локально. В чужих workflow Node 20, но там сборка Tauri.

## Проверки (вывод)
Локально на ветке (macOS, Node 22.23.1, pnpm 9.15.9, bun 1.3.14), все зелёные:
```
npx tsc --noEmit            → exit 0
pnpm check:contrast         → Контраст текста на заливках: всё проходит
pnpm test                   → Ran 26 tests across 2 files. 52 expect() calls, 0 fail
pnpm build                  → ○ (Static) prerendered as static content; exit 0
```
CI `aid-check` на этом PR: success за 1 мин 15 с ([прогон 43580330421](https://github.com/katanana23/shade/actions/runs/43580330421)), хвост:
```
Contrast (pnpm check:contrast)  Контраст текста на заливках: всё проходит
Tests (pnpm test)               26 pass, 0 fail. Ran 26 tests across 2 files.
Build (pnpm build)              ✓ Compiled successfully
                                ○ (Static) prerendered as static content
```

## Снимки и видео
Не нужны: вид не менялся.

## Проверка владельца
1. Открыть вкладку Checks у этого PR: задача «Aid check / tsc, contrast, test, build» зелёная.
2. Открыть `CLAUDE.md` и пробежать глазами: хватает ли сжатых разделов.
3. Открыть `docs/ui/recording-outcome.md` и сверить пару правил, которые помните (корзина, «Пустая запись»).

## На потом
- `DESIGN.md` держит значения цветов в hex «для переносимости» и тоже дублирует числа из кода. Его не трогал: это отдельный документ дизайн-системы.
- `docs/FORK.md` всё ещё называет репозиторий `katanana23/meetily`, а remote уже `katanana23/shade`. В `docs/dev.md` указано новое имя.
- Шаблон PR оригинала заменён. При слиянии обновлений из upstream в `aid` в этом файле возможен конфликт, оставлять нужно нашу версию.

## Вопросы
4 КБ считать в байтах (как сейчас) или в знаках? По умолчанию оставляю байты.

🤖 Generated with [Claude Code](https://claude.com/claude-code)


## Обсуждение

**vercel[bot], 2026-11-14T09:23**

[vc]: #qE8fWcrZG2BVhFHznSsDuDKKLhc9epGUfPR04NGfuDw=:eyJpc01vbm9yZXBvIjp0cnVlLCJ0eXBlIjoiZ2l0aHViIiwicHJvamVjdHMiOlt7Im5hbWUiOiJzaGFkZSIsInByb2plY3RJZCI6InByal95RHpOUldtUFVVRzVtMk03WTdzd3QyU2NQcEVnIiwiaW5zcGVjdG9yVXJsIjoiaHR0cHM6Ly92ZXJjZWwuY29tL2FpZHhvMjMtMzExOC9zaGFkZS9FWXZQckYza3NzOFFmbVNpTWh3aWtNeWt0aTdNIiwicHJldmlld1VybCI6InNoYWRlLWdpdC1jbGF1ZGUtYWlkLWNoZWNrLWFpZHhvMjMtMzExOC52ZXJjZWwuYXBwIiwibmV4dENvbW1pdFN0YXR1cyI6IkRFUExPWUVEIiwibGl2ZUZlZWRiYWNrIjp7InJlc29sdmVkIjowLCJ1bnJlc29sdmVkIjowLCJ0b3RhbCI6MCwibGluayI6InNoYWRlLWdpdC1jbGF1ZGUtYWlkLWNoZWNrLWFpZHhvMjMtMzExOC52ZXJjZWwuYXBwIn0sInJvb3REaXJlY3RvcnkiOiJmcm9udGVuZCJ9XX0=
The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).

| Project | Deployment | Actions | Updated |
| :--- | :----- | :------ | :------ |
| <a href="https://vercel.com/aidxo23-3118/shade"><sup><img src="https://vercel.com/api/www/avatar?projectId=prj_yDzNRWmPUUG5m2M7Y7swt2ScPpEg&teamId=team_c62k2HRzgnM0ltkkQq1HHgp8&s=32" width="16" height="16" align="middle" alt="" /></sup></a> [shade](https://vercel.com/aidxo23-3118/shade) | ![Ready](https://vercel.com/static/status/ready.svg) [Ready](https://vercel.com/aidxo23-3118/shade/EYvPrF3kss8QfmSiMhwikMykti7M) | [Preview](https://shade-git-claude-aid-check-aidxo23-3118.vercel.app) | <relative-time datetime="2026-11-14T09:24:44.719Z">Nov 14, 2026 9:24am UTC</relative-time> |



