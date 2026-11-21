#!/bin/bash
# Shade: установка последней беты на Mac с Apple Silicon.
# Скачивает Shade_aarch64.dmg из последнего релиза на GitHub, сверяет SHA-256 с SHA256SUMS.txt
# того же релиза и подпись приложения (codesign, сертификат «Shade Beta Signing»), ставит в
# /Applications/Shade.app и запускает. Встречи, записи и настройки
# лежат вне приложения и не трогаются. Запущенный Shade не закрывает: просит закрыть.
# Исходник: https://github.com/aidbeisembin/shade/blob/shade/scripts/install.sh

set -euo pipefail

BASE="${SHADE_RELEASE_URL:-https://github.com/aidbeisembin/shade/releases/latest/download}"
APPS="${SHADE_APPS_DIR:-/Applications}"
APP="$APPS/Shade.app"
DMG="Shade_aarch64.dmg"
# Сертификат, которым подписан Shade. Релиз (release.yml) ставит собранный .dmg этим скриптом и
# падает, если подпись в секретах другая: при переходе на Developer ID менять здесь
SIGNER="${SHADE_SIGNER:-Shade Beta Signing}"

if [[ "${LANG:-}" == ru* ]]; then RU=1; else RU=0; fi
say() { if [ "$RU" = 1 ]; then echo "$1"; else echo "$2"; fi; }
die() { say "Shade: $1" "Shade: $2" >&2; exit 1; }
running() { pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1; }
quit_first() { die "Shade запущен. Закройте его (⌘Q) и запустите команду снова." "Shade is running. Quit it (⌘Q) and run the command again."; }

[ "$(uname -s)" = Darwin ] || die "нужна macOS." "macOS is required."
[ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ] \
  || die "нужен Mac с Apple Silicon (M1 и новее), для Intel сборки нет." "a Mac with Apple Silicon (M1 or later) is required, there is no Intel build."
running && quit_first

tmp=$(mktemp -d)
mnt="$tmp/mnt"
trap 'hdiutil detach "$mnt" -quiet >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT

say "Скачиваю Shade…" "Downloading Shade…"
curl -fsSL --retry 2 -o "$tmp/$DMG" "$BASE/$DMG" && curl -fsSL --retry 2 -o "$tmp/SHA256SUMS.txt" "$BASE/SHA256SUMS.txt" \
  || die "не получилось скачать. Проверьте интернет и попробуйте снова." "download failed. Check your connection and try again."

expected=$(awk -v f="$DMG" '$2 == f {print $1}' "$tmp/SHA256SUMS.txt")
actual=$(shasum -a 256 "$tmp/$DMG" | awk '{print $1}')
[ -n "$expected" ] && [ "$expected" = "$actual" ] \
  || die "контрольная сумма не совпала, ничего не установлено." "checksum mismatch, nothing was installed."

hdiutil attach -nobrowse -readonly -quiet -mountpoint "$mnt" "$tmp/$DMG"
ditto "$mnt/Shade.app" "$tmp/Shade.app"
hdiutil detach "$mnt" -quiet

# Подпись: целая (все файлы на месте и не изменены) и того же сертификата. Первая строка Authority
# у codesign -dvv: имя сертификата; у ad-hoc и неподписанного её нет
authority=$(codesign -dvv "$tmp/Shade.app" 2>&1 | sed -n 's/^Authority=//p' | head -1 || true)
codesign --verify --deep --strict "$tmp/Shade.app" >/dev/null 2>&1 && [ "$authority" = "$SIGNER" ] \
  || die "подпись не совпала, ничего не установлено." "signature mismatch, nothing was installed."

running && quit_first
[ -w "$APPS" ] || die "нет прав на запись в $APPS." "no write access to $APPS."
if [ -d "$APP" ]; then
  say "Заменяю Shade.app, данные остаются на месте." "Replacing Shade.app, your data stays."
  mv "$APP" "$tmp/Shade.old.app"
fi
if ! mv "$tmp/Shade.app" "$APP"; then
  [ -d "$tmp/Shade.old.app" ] && mv "$tmp/Shade.old.app" "$APP"
  die "не получилось поставить в $APPS, прежняя версия на месте." "could not install to $APPS, the previous version is kept."
fi

say "Готово: $APP. Запускаю Shade." "Done: $APP. Launching Shade."
open "$APP"
