# Сторонние работы

Shade распространяется по лицензии MIT (`LICENSE.md`). Ниже работы других авторов, код или механику которых Shade использует, с их лицензиями. Тот же список показывает приложение: Настройки → О программе → «Лицензии открытого ПО».

Формат для приложения: раздел начинается с `## Название`, строка `<!-- notice: id -->` связывает его с описанием на двух языках (`NOTICE_TEXT` в `frontend/src/shade/lib/notices.ts`, тексты в `strings.ts`), строка `Источник:` даёт ссылку, первый блок кода это текст лицензии без изменений.

## Meetily
<!-- notice: core -->

Источник: https://github.com/Zackriya-Solutions/meeting-minutes

Shade начинался как форк Meetily. Из него взяты ядро записи и распознавания речи (Rust и Tauri, `frontend/src-tauri`: захват микрофона и системного звука, Whisper и Parakeet, итоги, хранение встреч) и часть компонентов интерфейса в `frontend/src/components`. Код Meetily распространяется по лицензии MIT, текст ниже без изменений.

```text
MIT License

Copyright (c) 2024 Zackriya Solutions

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Kokonut UI: Morph Popover
<!-- notice: kokonut -->

Источник: https://kokonutui.com

Механика формы обратной связи (`frontend/src/shade/components/feedback/FeedbackMorph.tsx`): кнопка вырастает в форму, подпись переезжает в заголовок, после отправки плашка «Спасибо» и возврат. Код написан заново на движке пружин Shade, значения и поведение взяты из образца.

Автор: Dorian Baffier (@dorianbaffier).

```
MIT License

Copyright (c) 2025 kokonutUI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Благодарности

Раздел без текста лицензии, в приложении не показывается. Часть кода ядра Meetily заимствована из [whisper.cpp](https://github.com/ggerganov/whisper.cpp), [Screenpipe](https://github.com/mediar-ai/screenpipe) и [transcribe-rs](https://crates.io/crates/transcribe-rs), их лицензии в их репозиториях. Модель Parakeet создана NVIDIA, конвертация в ONNX: [istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx). Лицензии остальных библиотек указаны в их пакетах (`Cargo.lock`, `frontend/pnpm-lock.yaml`).
