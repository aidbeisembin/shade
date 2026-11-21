#!/usr/bin/env bash
# Описание GitHub Release: два способа установки в порядке README, обратная связь, суммы SHA-256.
# Ссылка на чат беты берётся из frontend/src/shade/lib/beta-chat.ts; пустая строка: строки нет.
# Запуск: bash scripts/release/release-notes.sh <версия> <SHA256SUMS.txt>

set -euo pipefail

root="${SHADE_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
version="${1:?версия}" sums="${2:?SHA256SUMS.txt}"
readme="https://github.com/aidbeisembin/shade#установка"
chat=$(sed -n "s/^export const BETA_CHAT_URL = '\(.*\)';.*/\1/p" "$root/frontend/src/shade/lib/beta-chat.ts")

cat <<EOF
Shade $version, открытая бета для Mac с Apple Silicon (M1 и новее). Записи, расшифровки и итоги остаются на вашем Mac, статистику Shade не собирает.

## Установка

### 1. Скачать .dmg

1. Скачайте **Shade_aarch64.dmg** ниже, откройте его и перетащите Shade в «Программы».
2. Откройте Shade из «Программ». macOS скажет, что не может проверить приложение: нажмите «Готово».
3. Откройте Системные настройки → Конфиденциальность и безопасность, внизу у строки про Shade нажмите «Всё равно открыть» и подтвердите паролем или Touch ID.
4. В окне «Открыть Shade?» нажмите «Всё равно открыть». Дальше Shade открывается как обычно.

Кнопка «Всё равно открыть» видна около часа после первой попытки запуска. Если её нет, снова откройте Shade из «Программ» и вернитесь в настройки. Так на macOS 15, 26 и 27; снимок экрана: [README]($readme).

Почему так: бета подписана своим сертификатом, а не Apple Developer ID, поэтому macOS спрашивает один раз. Подпись постоянная: разрешения на микрофон и системный звук переживают обновления.

### 2. Быстрый способ через Терминал

\`\`\`bash
curl -fsSL https://aidbeisembin.com/shade/install.sh | bash
\`\`\`

Скрипт скачивает этот .dmg, сверяет SHA-256, ставит Shade в «Программы» и запускает; встречи и настройки не трогает. Исходник: [scripts/install.sh](https://github.com/aidbeisembin/shade/blob/shade/scripts/install.sh), он же приложен ниже.

## Обновления

Shade проверяет обновления при запуске и раз в сутки, без данных о вас в запросе. Новую версию показывает карточкой «Доступна версия …», ставит только по кнопке «Обновить» и никогда во время записи.

## Обратная связь

- Оценка и отзыв в самом Shade: карточка «Как вам Shade?» после записи.
EOF
if [ -n "$chat" ]; then echo "- Обсудить в чате беты в Telegram: $chat"; fi
cat <<EOF
- Ошибки и предложения: [Issues](https://github.com/aidbeisembin/shade/issues).

## SHA-256

\`\`\`
$(cat "$sums")
\`\`\`
EOF
