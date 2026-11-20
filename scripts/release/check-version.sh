#!/usr/bin/env bash
# Версия релиза в одном месте: tauri.conf.json и Cargo.toml совпадают, а при сборке по тегу
# v<версия> совпадают и с тегом. Иначе сборка падает: приложение показало бы одну версию,
# latest.json другую, и обновление ходило бы по кругу.
# Запуск: bash scripts/release/check-version.sh [v0.5.0-beta.1]
# Печатает версию; в GitHub Actions пишет её в $GITHUB_OUTPUT (version=...).

set -euo pipefail

root="${SHADE_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
conf="$root/frontend/src-tauri/tauri.conf.json"
cargo="$root/frontend/src-tauri/Cargo.toml"

fail() { echo "::error::$*" >&2; exit 1; }

conf_v=$(jq -r '.version // empty' "$conf")
# Первая строка version = "..." в Cargo.toml: раздел [package] идёт первым
cargo_v=$(sed -n 's/^version = "\([^"]*\)".*/\1/p' "$cargo" | head -1)

[ -n "$conf_v" ] || fail "В $conf нет version."
[ -n "$cargo_v" ] || fail "В $cargo нет version."
[ "$conf_v" = "$cargo_v" ] || fail "Версии расходятся: tauri.conf.json $conf_v, Cargo.toml $cargo_v."

if [ $# -gt 0 ] && [ -n "$1" ]; then
  tag="$1"
  case "$tag" in
    v*) ;;
    *) fail "Тег $tag не начинается с v." ;;
  esac
  [ "${tag#v}" = "$conf_v" ] || fail "Тег $tag не совпадает с версией $conf_v в tauri.conf.json и Cargo.toml."
fi

echo "$conf_v"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "version=$conf_v" >> "$GITHUB_OUTPUT"; fi
