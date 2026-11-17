# Shade

Приватные заметки встреч для Mac: запись, расшифровка и итоги прямо на компьютере.

## Что умеет

- Записывает микрофон и системный звук одновременно: Zoom, Meet, Teams и любые другие созвоны.
- Расшифровывает речь на устройстве моделями Whisper или Parakeet, ускорение Metal на Apple Silicon.
- По кнопке подводит итоги встроенной локальной моделью или выбранным вами провайдером.
- Ищет по тексту встреч, удалённое держит в корзине, импортирует аудиофайлы.

## Приватность

Записи, расшифровки и итоги хранятся только на вашем Mac и никуда не отправляются. Наружу что-то уходит, только когда вы сами это выбрали: облачный провайдер итогов или отзыв по кнопке «Отправить». Статистику использования Shade не собирает. Подробно: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

- Данные приложения: `~/Library/Application Support/io.github.katanana23.shade/`.
- Записи: `~/Movies/Shade`, корзина внутри, в папке `Корзина Shade`.

## Установка

Скоро. Готовой сборки пока нет, Shade можно собрать из исходников.

## Сборка из исходников

Нужны macOS на Apple Silicon, Xcode Command Line Tools, Rust, Node.js 22 и pnpm.

```bash
git clone https://github.com/katanana23/shade
cd shade/frontend
pnpm install --frozen-lockfile
pnpm tauri:build
```

Разработка интерфейса в браузере на заглушках: `pnpm dev`, затем `http://localhost:3118/?mock=full`. Подробно: [docs/dev.md](docs/dev.md), участие: [CONTRIBUTING.md](CONTRIBUTING.md).

Built on open-source components, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
