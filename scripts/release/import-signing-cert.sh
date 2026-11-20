#!/usr/bin/env bash
# Временная связка ключей на раннере с сертификатом подписи из секретов.
# Встроенный импорт Tauri (APPLE_CERTIFICATE) ищет сертификаты Apple, поэтому импорт здесь,
# а Tauri получает только имя (APPLE_SIGNING_IDENTITY) и подписывает через codesign.
# Самоподписанному сертификату доверие не нужно: codesign подписывает им и без него.
# Переход на Developer ID: заменить секреты MACOS_*, этот скрипт не меняется.
# Нужны MACOS_CERTIFICATE (base64 .p12), MACOS_CERTIFICATE_PASSWORD, MACOS_SIGNING_IDENTITY, RUNNER_TEMP.

set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP не задан}"
kc="$RUNNER_TEMP/shade-signing.keychain-db"
p12="$RUNNER_TEMP/shade-signing.p12"
kpw=$(openssl rand -hex 24)

fail() { rm -f "$p12"; echo "::error::$*" >&2; exit 1; }

printf '%s' "$MACOS_CERTIFICATE" | base64 --decode > "$p12" 2>/dev/null \
  || fail "MACOS_CERTIFICATE не читается как base64. Задайте его командой из docs/release.md."

security create-keychain -p "$kpw" "$kc"
security set-keychain-settings -lut 21600 "$kc"
security unlock-keychain -p "$kpw" "$kc"
security import "$p12" -k "$kc" -f pkcs12 -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null \
  || fail "Не удалось импортировать .p12: неверный пароль MACOS_CERTIFICATE_PASSWORD или повреждённый файл."
rm -f "$p12"
# codesign берёт ключ без окна с вопросом
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$kpw" "$kc" >/dev/null
# Связка в списке поиска: codesign, который зовёт Tauri, находит имя без --keychain
existing=$(security list-keychains -d user | tr -d '"' | xargs)
# shellcheck disable=SC2086
security list-keychains -d user -s "$kc" $existing

security find-identity -p codesigning "$kc" | grep -qF "\"$MACOS_SIGNING_IDENTITY\"" \
  || fail "В .p12 нет сертификата «$MACOS_SIGNING_IDENTITY». Проверьте MACOS_SIGNING_IDENTITY."

echo "Сертификат «$MACOS_SIGNING_IDENTITY» во временной связке ключей"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "keychain=$kc" >> "$GITHUB_OUTPUT"; fi
