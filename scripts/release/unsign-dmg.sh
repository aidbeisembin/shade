#!/usr/bin/env bash
# Образ .dmg без подписи; Shade.app внутри остаётся подписанным.
# Tauri подписывает и сам образ. Подписанный, но не нотаризованный образ с карантином браузера
# macOS 27 молча убирает в Корзину: ни окна, ни кнопки «Всё равно открыть» (проверено 21.11.2026
# на .dmg из прогона workflow_dispatch). Неподписанный образ монтируется, Gatekeeper проверяет
# только приложение, и путь из README работает. С Developer ID схема та же: нотаризуется
# приложение, образ без подписи, поэтому шаг не зависит от секретов.
# hdiutil convert пишет новый образ без подписи; файлы и оформление те же.
# Запуск: bash scripts/release/unsign-dmg.sh <путь к .dmg> (только macOS).

set -euo pipefail

dmg="${1:?нужен путь к .dmg}"
[ -f "$dmg" ] || { echo "::error::Нет файла ${dmg}" >&2; exit 1; }
tmp="$(dirname "$dmg")/.unsigned-$$.dmg"
trap 'rm -f "$tmp"' EXIT

hdiutil convert -quiet "$dmg" -format UDZO -imagekey zlib-level=9 -o "$tmp"
mv -f "$tmp" "$dmg"
if codesign -dv "$dmg" >/dev/null 2>&1; then
  echo "::error::Образ ${dmg} всё ещё подписан: macOS 27 убрала бы его в Корзину без вопроса" >&2
  exit 1
fi
echo "Образ без подписи: ${dmg}"
