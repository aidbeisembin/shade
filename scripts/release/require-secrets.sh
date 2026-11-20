#!/usr/bin/env bash
# Секреты релиза на месте, иначе сборка падает сразу, до часа компиляции.
# Без постоянной подписи macOS узнаёт приложение по хешу сборки (cdhash) и после каждого
# обновления сбрасывает разрешения на микрофон и системный звук. Поэтому ad-hoc подпись
# («-») здесь никогда не подставляется молча. Что за секреты и как их задать: docs/release.md.

set -euo pipefail

required=(
  MACOS_CERTIFICATE            # .p12 в base64: «Shade Beta Signing», позже Developer ID
  MACOS_CERTIFICATE_PASSWORD   # пароль .p12
  MACOS_SIGNING_IDENTITY       # имя сертификата в связке ключей
  TAURI_SIGNING_PRIVATE_KEY    # ключ подписи обновлений (pnpm tauri signer generate)
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD
)

missing=()
for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then missing+=("$name"); fi
done

if [ ${#missing[@]} -gt 0 ]; then
  for name in "${missing[@]}"; do
    echo "::error title=Нет секрета $name::Секрет $name не задан в Settings → Secrets and variables → Actions. Сборка остановлена: без постоянной подписи macOS сбросит разрешения у всех после обновления, ad-hoc подпись не подставляется. Шаги: docs/release.md." >&2
  done
  exit 1
fi

if [ "$MACOS_SIGNING_IDENTITY" = "-" ]; then
  echo "::error title=Ad-hoc подпись::MACOS_SIGNING_IDENTITY равен «-» (ad-hoc). Нужно имя постоянного сертификата, например «Shade Beta Signing». Шаги: docs/release.md." >&2
  exit 1
fi

echo "Секреты релиза на месте: ${required[*]}"
