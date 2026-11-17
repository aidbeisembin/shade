# #23 VoiceGlow: свечение голоса и уровень звука из ядра

- Статус: слит, 2026-11-14
- Ветка: `claude/voice-glow` → `aid`
- Автор: katanana23
- Исходная ссылка: https://github.com/katanana23/shade/pull/23

## Описание

Свечение голоса (VoiceGlow) по прототипу `docs/prototypes/voice-glow.html` и уровень звука из ядра. По явному разрешению в задаче один коммит меняет ядро (`src-tauri`), он отдельный.

## Коммиты
1. **Ядро: уровень звука записи событием `recording-level`** (`88b39bb`, только Rust). `AudioCapture::process_audio_data` уже получает буферы микрофона и звука компьютера; по тому же буферу (до ресемплинга и нормализации) считается RMS и пик копится в атомарных полях `RecordingState` (без блокировок и выделений памяти в колбэке). Лёгкая задача таймера раз в 33 мс забирает пик, переводит в 0..1 по dB от -60 до 0 и шлёт `recording-level { level, mic, system }`, только пока идёт запись и не на паузе; задача заканчивается вместе с записью. Устройство заново не открывается, второго аудиопотока нет, формат и громкость входа прежние, существующие команды и события не тронуты.
2. Прототип из `claude/prototype-voice-glow`.
3. **VoiceGlow и полосы капсулы** (`0d55794`):
   - `components/VoiceGlow.tsx`: свой WebGL, шейдер прототипа. Лежит по нижнему краю плитки транскрипта, под текстом и за капсулой записи, обрезан по скруглению плитки (`overflow: clip`, внутри `sticky`: у капсулы, даже когда плитка длиннее экрана). Зона высотой `--dock-space` (в п. 4 своя, `--glow-h`), последняя реплика над ней.
   - Режимы: запись живое (быстрая атака 45 мс, медленный спад 260 мс), пауза гаснет до тонкой линии, «Остановить» уходит за 0,4 с, генерация итогов на странице встречи «думает».
   - Расход: один `requestAnimationFrame`, кадры только пока виден (IntersectionObserver) и окно активно (фокус и видимость), DPR не больше 2 (в п. 4 холст 1×), после ухода цикл стоит.
   - `prefers-reduced-motion`, `prefers-reduced-transparency`, нет WebGL или потерян контекст: статичная мягкая полоса `.aid-glow-static`.
   - `lib/recording-level.ts`: одна подписка на событие для свечения и полос; на заглушках (`?mock=`) демонстрационный уровень.
   - Полосы в капсуле на том же уровне: 9 полос, пик за 100 мс, высоты прямо в DOM без перерисовки React.
   - Со свечением низ под капсулой только размывается, без тона 72 % (тон гасил свечение); на странице встречи на время «думает» размытие низа тоже включается.
   - CLAUDE.md: категория «Эффекты» (только ИИ-моменты, один эффект на экран, статичная замена) и поправка про полосы.
4. **Плавные волны, ореол, холст 1×** (`9310ac8`, после первого отзыва: «грубо выглядят границы»):
   - Шум из четырёх октав по длине края давал вертикальные столбы и рваную верхнюю границу. Теперь высота холмов из трёх бегущих синусоид разной длины (плавные волны), медленный шум только меняет их высоту; к ядру свечения добавлен широкий тихий ореол, граница уходит в фон. Размеры в CSS-пикселях: волны одного размера на любой ширине плитки.
   - Зона свечения своя, `--glow-h` 200 px (была `--dock-space` 136 px), у плитки транскрипта снизу такой же запас: последняя реплика над зоной.
   - В тишине при записи свечение не падает до нитки: низкие холмы остаются (`LISTEN_FLOOR` 0,15), голос их поднимает.
   - Палитра в порядке розовый, персиковый, сиреневый, барвинок: в светлой теме между цветами нет серого просвета.
   - Холст в 1× вместо DPR 2 (свечение мягкое, разницы не видно): примерно вчетверо меньше работы шейдера.

## Замер
Собранный отладочный `.app` (`tauri build --debug`, Rust без оптимизаций, `coreml`), MacBook Pro, Retina (DPR 2), окно 1100 × 700, тёмная тема. Речь в динамик (`say`), микрофон её слышит. Одна запись: 2 мин на экране записи со свечением, затем 2 мин на списке встреч (свечения нет, капсула и полосы те же). CPU: `top` каждые 2 с, среднее по 60 выборкам, % одного ядра. Кадр: временный счётчик на `requestAnimationFrame` (в обеих фазах, в коммиты не вошёл), сводка каждые 10 с.

| | со свечением | без свечения |
|---|---|---|
| WebKit GPU | 6,6 % | 1,1 % |
| WebKit WebContent | 15,2 % | 11,2 % |
| Процесс приложения (ядро, распознавание) | 46,2 % | 46,0 % |
| **Итого** | **68,0 %** | **58,3 %** |
| Кадр p50 / p95 / p99 | 17 / 18 / 18-20 мс | 17 / 18 / 19-27 мс |
| Кадров длиннее 25 мс за 10 с | 0-3 | 0-8 |
| JS на кадр свечения | 0,01-0,045 мс | |

Эффект стоит около 10 % одного ядра (GPU-процесс и WebContent), 60 кадров/с держатся, длинных кадров не больше, чем без него. Время GPU на кадр WebKit наружу не отдаёт, оно видно только как загрузка GPU-процесса. Замер сделан до п. 4: теперь холст в 1×, это примерно в 4 раза меньше работы шейдера; новый замер не делал.

## Микрофон после записи, паузы и стопа
- Во время записи в строке меню оранжевый индикатор микрофона; после «Остановить» его нет.
- После записи с паузой и стопа запись микрофона другим процессом (`ffmpeg -f avfoundation`) слышит речь: -21,5…-37,7 dB при тишине -45,5 dB (при закрытом приложении -29,5 dB). Громкость между прогонами гуляла, но тишины, как в истории с coreaudiod, не было.
- В журнале `coreaudiod` за время замеров нет «inconsistent state» и `VPAUAggregateAudioDevice`.

## Скриншоты и видео
Настоящее окно, речь синтетическая. Сняты до п. 4 (волны тогда были грубее). Файлы в ветке `claude/voice-glow-assets` (отдельно, чтобы не тащить бинарники в историю).

Тёмная, запись: ![](https://github.com/katanana23/shade/blob/claude/voice-glow-assets/voice-glow/dark-recording-window.jpg?raw=true)

Тёмная, речь: ![](https://github.com/katanana23/shade/blob/claude/voice-glow-assets/voice-glow/dark-listen.png?raw=true)

Пауза, тонкая линия: ![](https://github.com/katanana23/shade/blob/claude/voice-glow-assets/voice-glow/dark-paused.png?raw=true)

Светлая, речь: ![](https://github.com/katanana23/shade/blob/claude/voice-glow-assets/voice-glow/light-listen.png?raw=true)

«Думает» на странице встречи (заглушки): ![](https://github.com/katanana23/shade/blob/claude/voice-glow-assets/voice-glow/think-meeting-mock-dark.jpg?raw=true)

Видео 30 с (тёмная, пауза, продолжение, светлая): [voice-glow.mp4](https://github.com/katanana23/shade/blob/claude/voice-glow-assets/voice-glow/voice-glow.mp4?raw=true)

## Проверки
- `cargo check`: без ошибок, два предупреждения в `pipeline.rs` были и раньше.
- `npx tsc --noEmit`, `pnpm check:contrast`, `pnpm build`: чисто.
- Браузер на заглушках: запись (обе темы), пауза, «думает» на странице встречи, статичная полоса (подставлена вручную).
- После п. 4: `tsc`, `check:contrast`, `build` чисто; волны проверены в браузере на заглушках (обе темы, пауза) и на отдельной странице с этим же шейдером на уровнях 0,3 / 0,6 / 0,9 и «думает» (страница не в коммите).

## Что не проверено или осталось
- Скриншоты, видео и замер CPU сняты до п. 4; в настоящем окне новые волны не снимал.
- Уход за 0,4 с после «Остановить» в окне не снят: экран записи сменяется списком, как только ядро остановилось, и уход виден только пока оно останавливается.
- «Думает» в настоящем окне не проверял (нужна модель итогов), только на заглушках.
- Статичную замену проверял подстановкой разметки, а не переключением системных настроек.
- Полосы при громкой речи из динамика упираются в верх; у живого разговора тише, шкалу можно поджать (`voiceAmount` в `lib/recording-level.ts`).
- Замечено попутно, не в этой правке: в начале записи окно само вырастает с 1100 × 700 до 1306 × 743.

🤖 Generated with [Claude Code](https://claude.com/claude-code)



## Обсуждение

**vercel[bot], 2026-11-13T15:27**

[vc]: #LNSDSb3H1Hj2/nDhAhE1FNx2j3DzRVdNq8vW71CryfY=:eyJpc01vbm9yZXBvIjp0cnVlLCJ0eXBlIjoiZ2l0aHViIiwicHJvamVjdHMiOlt7Im5hbWUiOiJtZWV0aWx5IiwicHJvamVjdElkIjoicHJqX3lEek5SV21QVVVHNW0yTTdZN3N3dDJTY1BwRWciLCJpbnNwZWN0b3JVcmwiOiJodHRwczovL3ZlcmNlbC5jb20vYWlkeG8yMy0zMTE4L21lZXRpbHkvM0t0cWJQUUNvNVdjbTZ5Y1RqcGVkMmRLekhqYyIsInByZXZpZXdVcmwiOiIiLCJuZXh0Q29tbWl0U3RhdHVzIjoiRkFJTEVEIiwibGl2ZUZlZWRiYWNrIjp7InJlc29sdmVkIjowLCJ1bnJlc29sdmVkIjowLCJ0b3RhbCI6MCwibGluayI6IiJ9LCJyb290RGlyZWN0b3J5IjoiZnJvbnRlbmQifV19
The latest updates on your projects. Learn more about [Vercel for GitHub](https://vercel.link/github-learn-more).

| Project | Deployment | Actions | Updated |
| :--- | :----- | :------ | :------ |
| <a href="https://vercel.com/aidxo23-3118/meetily"><sup><img src="https://vercel.com/api/www/avatar?projectId=prj_yDzNRWmPUUG5m2M7Y7swt2ScPpEg&teamId=team_c62k2HRzgnM0ltkkQq1HHgp8&s=32" width="16" height="16" align="middle" alt="" /></sup></a> [meetily](https://vercel.com/aidxo23-3118/meetily) | ![Error](https://vercel.com/static/status/error.svg) [Error](https://vercel.com/aidxo23-3118/meetily/3KtqbPQCo5Wcm6ycTjped2dKzHjc) |  | <relative-time datetime="2026-11-13T15:41:09.700Z">Nov 13, 2026 3:41pm UTC</relative-time> |



