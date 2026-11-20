#!/usr/bin/env bash
# Подпись Shade.app постоянная: macOS узнаёт приложение по требованию (designated requirement),
# и оно не привязано к хешу сборки (cdhash). Тогда разрешения на микрофон и системный звук
# переживают обновление. С двумя приложениями требования обязаны совпасть.
# Запуск: bash scripts/release/check-signature.sh A.app [B.app]
# SHADE_SIGNING_IDENTITY (необязательно): ожидаемое имя сертификата в первой строке Authority.

set -euo pipefail

fail() { echo "::error::$*" >&2; exit 1; }
[ $# -ge 1 ] || fail "Использование: check-signature.sh A.app [B.app]"

requirement() {
  local app="$1" info req authority
  [ -d "$app" ] || fail "Нет приложения: $app"
  info=$(codesign -dvvv "$app" 2>&1) || fail "$app не подписан."
  if grep -q '^Signature=adhoc' <<<"$info"; then fail "$app подписан ad-hoc: разрешения сбросятся после обновления."; fi
  authority=$(sed -n 's/^Authority=//p' <<<"$info" | head -1)
  [ -n "$authority" ] || fail "$app без сертификата подписи."
  if [ -n "${SHADE_SIGNING_IDENTITY:-}" ] && [ "$authority" != "$SHADE_SIGNING_IDENTITY" ]; then
    fail "$app подписан «$authority», ожидался «$SHADE_SIGNING_IDENTITY»."
  fi
  codesign --verify --deep --strict "$app" 2>/dev/null || fail "$app: подпись не проходит codesign --verify --deep --strict."
  req=$(codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p')
  [ -n "$req" ] || fail "$app без требования (designated requirement)."
  case "$req" in *cdhash*) fail "$app: требование привязано к cdhash: $req" ;; esac
  echo "$req"
}

cdhash() { codesign -dvvv "$1" 2>&1 | sed -n 's/^CDHash=//p' | head -1; }

req_a=$(requirement "$1")
echo "A: $1"
echo "   требование: $req_a"
echo "   CDHash:     $(cdhash "$1")"

if [ $# -ge 2 ]; then
  req_b=$(requirement "$2")
  echo "B: $2"
  echo "   требование: $req_b"
  echo "   CDHash:     $(cdhash "$2")"
  [ "$req_a" = "$req_b" ] || fail "Требования расходятся: macOS сочтёт B другим приложением и сбросит разрешения."
  echo "Требования совпадают, cdhash в них нет."
fi
