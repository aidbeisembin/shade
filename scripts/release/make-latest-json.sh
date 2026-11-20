#!/usr/bin/env bash
# latest.json для автообновления Tauri. Приложение читает его по постоянному адресу
# https://github.com/aidbeisembin/shade/releases/latest/download/latest.json
# Запуск: bash scripts/release/make-latest-json.sh <версия> <адрес .app.tar.gz> <файл .sig> [заметки]

set -euo pipefail

fail() { echo "::error::$*" >&2; exit 1; }
[ $# -ge 3 ] || fail "Использование: make-latest-json.sh <версия> <адрес> <файл .sig> [заметки]"

version="$1" url="$2" sig_file="$3" notes="${4:-}"
[ -s "$sig_file" ] || fail "Нет подписи обновления: $sig_file"
case "$url" in https://*) ;; *) fail "Адрес обновления не https: $url" ;; esac

sig=$(tr -d '\n' < "$sig_file")
pub_date=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Две записи: Tauri сначала ищет цель с типом сборки (darwin-aarch64-app), затем без него
jq -n --arg v "$version" --arg n "$notes" --arg d "$pub_date" --arg s "$sig" --arg u "$url" '{
  version: $v,
  notes: $n,
  pub_date: $d,
  platforms: {
    "darwin-aarch64": { signature: $s, url: $u },
    "darwin-aarch64-app": { signature: $s, url: $u }
  }
}'
