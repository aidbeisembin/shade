<p align="center">
  <img src="docs/assets/shade-icon.png" width="88" height="88" alt="">
</p>

<h1 align="center">Shade</h1>

<p align="center">
  <b>Приватные заметки встреч для Mac.</b><br>
  Запись, расшифровка и итоги прямо на компьютере: без бота в созвоне и без облака.
</p>

<p align="center">
  <a href="https://github.com/aidbeisembin/shade/releases/latest"><img src="https://img.shields.io/github/v/release/aidbeisembin/shade?include_prereleases&label=%D0%B1%D0%B5%D1%82%D0%B0&color=E4FB77&labelColor=111" alt="Последний релиз"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-111?logo=apple&logoColor=white" alt="macOS, Apple Silicon">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-111" alt="Лицензия MIT"></a>
</p>

<p align="center">
  <a href="https://aidbeisembin.com/shade">Сайт</a> · <a href="#установка">Установка</a> · <a href="https://t.me/shadebeta">Чат беты</a> · <a href="README.md">English</a>
</p>

<p align="center">
  <img src="docs/assets/shade-demo.gif" width="800" alt="Shade записывает встречу: пульс разговора и живая расшифровка">
</p>


## Что умеет

- Записывает микрофон и системный звук одновременно: Zoom, Meet, Teams и любые другие созвоны.
- Расшифровывает речь на устройстве моделями Whisper или Parakeet, ускорение Metal на Apple Silicon.
- По кнопке подводит итоги встроенной локальной моделью или выбранным вами провайдером.
- Ищет по тексту встреч, удалённое держит в корзине, импортирует аудиофайлы.

## Приватность

Записи, расшифровки и итоги хранятся только на вашем Mac и никуда не отправляются. Наружу что-то уходит, только когда вы сами это выбрали: облачный провайдер итогов или отзыв по кнопке «Отправить». Ещё Shade отправляет анонимную статистику: запуск, начало записи и готовые итоги, без звука, текста и названий встреч; выключается в Настройках. Подробно: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

- Данные приложения: `~/Library/Application Support/com.aidbeisembin.shade/`.
- Записи: `~/Movies/Shade`, корзина внутри, в папке `Корзина Shade`.

## Установка

Открытая бета для Mac с Apple Silicon (M1 и новее). Бета подписана своим сертификатом, а не Apple Developer ID, поэтому после установки из .dmg macOS один раз спросит, открывать ли Shade; через Терминал вопроса нет. Подпись постоянная: разрешения на микрофон и системный звук переживают обновления.

### Способ 1. Одна строка в Терминале

```bash
curl -fsSL https://aidbeisembin.com/shade/install.sh | bash
```

Скрипт скачивает .dmg последнего релиза, сверяет SHA-256 и подпись «Shade Beta Signing», ставит Shade в «Программы» и запускает; встречи и настройки не трогает. Если сумма или подпись не совпали, ничего не ставит. Вопроса «Всё равно открыть» здесь нет. Исходник короткий: [scripts/install.sh](scripts/install.sh).

### Способ 2. Скачать .dmg

<!-- install-steps -->
1. Скачайте [Shade_aarch64.dmg](https://github.com/aidbeisembin/shade/releases/latest/download/Shade_aarch64.dmg) из [последнего релиза](https://github.com/aidbeisembin/shade/releases/latest), откройте его и перетащите Shade в «Программы».
2. Откройте Shade из «Программ». macOS скажет, что не может проверить приложение: нажмите «Готово».
3. Откройте Системные настройки → Конфиденциальность и безопасность. Внизу, у строки про Shade, нажмите «Всё равно открыть» и подтвердите паролем или Touch ID.
4. В окне «Открыть Shade?» нажмите «Всё равно открыть». Дальше Shade открывается как обычно.
<!-- /install-steps -->

![Системные настройки → Конфиденциальность и безопасность: «Shade» заблокировано, кнопка «Всё равно открыть»](docs/screenshots/shade-open-beta/gatekeeper-open-anyway-macos27.png)

Кнопка «Всё равно открыть» видна около часа после первой попытки запуска. Если её нет, снова откройте Shade из «Программ» и вернитесь в настройки. Путь одинаковый на macOS 15, 26 и 27, снимок с macOS 27 на английском. Те же шаги нарисованы в окне .dmg.

Кнопки нет и после этого: выполните в Терминале `xattr -cr /Applications/Shade.app` (снимает с Shade отметку «скачано из интернета») и откройте Shade снова.

### Обновления

Shade проверяет обновления при запуске и раз в сутки, без данных о вас в запросе. Новую версию скачивает в фоне и проверяет подпись, а ставит только по кнопке «Обновить» в карточке «Доступна версия …», и никогда во время записи. Как выпускается релиз: [docs/release.md](docs/release.md).

## Обратная связь

- Оценка и отзыв в самом Shade: карточка «Как вам Shade?» после записи.
<!-- beta-chat -->
- Обсудить в чате беты в Telegram: [t.me/shadebeta](https://t.me/shadebeta).
<!-- /beta-chat -->
- Ошибки и предложения: [Issues](https://github.com/aidbeisembin/shade/issues).

## Сборка из исходников

Нужны macOS на Apple Silicon, Xcode Command Line Tools, Rust, Node.js 22 и pnpm.

```bash
git clone https://github.com/aidbeisembin/shade
cd shade/frontend
pnpm install --frozen-lockfile
pnpm tauri:build
```

Разработка интерфейса в браузере на заглушках: `pnpm dev`, затем `http://localhost:3118/?mock=full`. Подробно: [docs/dev.md](docs/dev.md), участие: [CONTRIBUTING.md](CONTRIBUTING.md).

Built on open-source components, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
