#!/usr/bin/env bash
# Подпись обновления (.sig от tauri signer) сверяется с публичным ключом из tauri.conf.json.
# Оба в формате Tauri: base64 от файлов minisign. Если ключ в конфиге и ключ в секрете
# разошлись, установленные приложения молча пропускали бы все обновления; ловим это до релиза.
# Запуск: bash scripts/release/verify-updater-signature.sh <файл> <файл.sig> [tauri.conf.json]

set -euo pipefail

fail() { echo "::error::$*" >&2; exit 1; }
[ $# -ge 2 ] || fail "Использование: verify-updater-signature.sh <файл> <файл.sig> [tauri.conf.json]"

root="$(cd "$(dirname "$0")/../.." && pwd)"
file="$1" sig="$2" conf="${3:-$root/frontend/src-tauri/tauri.conf.json}"

if ! command -v minisign >/dev/null; then
  if command -v brew >/dev/null; then brew install minisign >/dev/null; else fail "Нужен minisign."; fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

pub=$(jq -r '.plugins.updater.pubkey // empty' "$conf")
[ -n "$pub" ] || fail "В $conf пустой plugins.updater.pubkey."
printf '%s' "$pub" | base64 --decode > "$tmp/key.pub" 2>/dev/null || fail "pubkey в $conf не base64."
base64 --decode < "$sig" > "$tmp/file.minisig" 2>/dev/null || fail "$sig не base64."

minisign -V -q -p "$tmp/key.pub" -m "$file" -x "$tmp/file.minisig" \
  || fail "Подпись $sig не сходится с pubkey в tauri.conf.json: у пользователей обновление не поставится."
echo "Подпись обновления сходится с pubkey в tauri.conf.json"
