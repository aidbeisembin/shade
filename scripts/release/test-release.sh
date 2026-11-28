#!/usr/bin/env bash
# Тест скриптов релиза (scripts/release) без сборки. Случаи из таблицы PR:
#  - версия: тег совпал; тег другой; тег без v; tauri.conf.json и Cargo.toml разошлись;
#  - секреты: все на месте; секрета сертификата нет (понятная ошибка); подпись «-» (ad-hoc) не принимается;
#  - latest.json: обе записи darwin-aarch64, адрес не https, нет подписи;
#  - подпись обновления: сходится с pubkey; файл подменён (битая подпись); чужой ключ;
#  - описание релиза и README: сначала Терминал, потом .dmg; запасная команда xattr; ссылка на чат
#    только когда задана.
# Нужны jq; для подписи обновления minisign (без него эти случаи пропускаются с пометкой).
# Запуск: bash scripts/release/test-release.sh (macOS и Linux).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0 fail=0 skip=0
run() {
  set +e
  OUT=$("$@" 2>&1)
  CODE=$?
  set -e
}
check() {
  local name="$1"; shift
  if "$@"; then pass=$((pass + 1)); echo "ok   $name"; else fail=$((fail + 1)); echo "FAIL $name"; echo "$OUT" | sed 's/^/     /'; fi
}
has() { grep -qF -- "$1" <<<"$OUT"; }
# Строка $1 есть в $OUT и стоит раньше строки $2
first_then() {
  local a b
  a=$(grep -nF -- "$1" <<<"$OUT" | head -1 | cut -d: -f1); b=$(grep -nF -- "$2" <<<"$OUT" | head -1 | cut -d: -f1)
  [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]
}

# Копия корня с нужными файлами: версии и константа чата меняются без правки репозитория
fake_root() {
  rm -rf "$WORK/root"
  mkdir -p "$WORK/root/frontend/src-tauri" "$WORK/root/frontend/src/shade/lib"
  cp "$ROOT/frontend/src-tauri/tauri.conf.json" "$ROOT/frontend/src-tauri/Cargo.toml" "$WORK/root/frontend/src-tauri/"
  cp "$ROOT/frontend/src/shade/lib/beta-chat.ts" "$WORK/root/frontend/src/shade/lib/"
}
V=$(jq -r .version "$ROOT/frontend/src-tauri/tauri.conf.json")

# --- Переменная вплотную к не-ASCII (кавычка-ёлочка или многоточие сразу после имени): bash без UTF-8
# локали (раннер, curl | bash) читает байты как часть имени и падает на set -u. Писать ${x} ---
OUT=$(LC_ALL=C perl -ne 'print "$ARGV:$.: $_" if /\$[A-Za-z_][A-Za-z0-9_]*[\x80-\xff]/; close ARGV if eof' "$HERE"/*.sh "$HERE/../install.sh")
check "скрипты: нет \$имя вплотную к не-ASCII" test -z "$OUT"

# --- версия ---
fake_root
run env SHADE_ROOT="$WORK/root" bash "$HERE/check-version.sh" "v$V"
check "версия: тег v$V совпал" test "$CODE" = 0 -a "$OUT" = "$V"
run env SHADE_ROOT="$WORK/root" bash "$HERE/check-version.sh" "v9.9.9"
check "версия: другой тег падает" test "$CODE" != 0
check "версия: сказано, что не совпадает" has "не совпадает"
run env SHADE_ROOT="$WORK/root" bash "$HERE/check-version.sh" "$V"
check "версия: тег без v падает" test "$CODE" != 0
c="$WORK/root/frontend/src-tauri/Cargo.toml"
awk '!done && /^version = / { print "version = \"0.0.1\""; done = 1; next } { print }' "$c" > "$c.new" && mv "$c.new" "$c"
run env SHADE_ROOT="$WORK/root" bash "$HERE/check-version.sh"
check "версия: tauri.conf.json и Cargo.toml разошлись" test "$CODE" != 0
check "версия: сказано, что расходятся" has "Версии расходятся"

# --- секреты ---
all_secrets=(MACOS_CERTIFICATE=x MACOS_CERTIFICATE_PASSWORD=x "MACOS_SIGNING_IDENTITY=Shade Beta Signing" TAURI_SIGNING_PRIVATE_KEY=x TAURI_SIGNING_PRIVATE_KEY_PASSWORD=x)
run env -i PATH="$PATH" "${all_secrets[@]}" bash "$HERE/require-secrets.sh"
check "секреты: все на месте" test "$CODE" = 0
run env -i PATH="$PATH" MACOS_CERTIFICATE_PASSWORD=x "MACOS_SIGNING_IDENTITY=Shade Beta Signing" TAURI_SIGNING_PRIVATE_KEY=x TAURI_SIGNING_PRIVATE_KEY_PASSWORD=x bash "$HERE/require-secrets.sh"
check "секреты: нет сертификата, сборка падает" test "$CODE" != 0
check "секреты: ошибка называет секрет" has "Нет секрета MACOS_CERTIFICATE"
check "секреты: ad-hoc не подставляется (сказано)" has "ad-hoc подпись не подставляется"
run env -i PATH="$PATH" MACOS_CERTIFICATE=x MACOS_CERTIFICATE_PASSWORD=x MACOS_SIGNING_IDENTITY=- TAURI_SIGNING_PRIVATE_KEY=x TAURI_SIGNING_PRIVATE_KEY_PASSWORD=x bash "$HERE/require-secrets.sh"
check "секреты: имя «-» (ad-hoc) отклонено" test "$CODE" != 0
run env -i PATH="$PATH" MACOS_CERTIFICATE=x MACOS_CERTIFICATE_PASSWORD=x "MACOS_SIGNING_IDENTITY=Shade Beta Signing" bash "$HERE/require-secrets.sh"
check "секреты: нет ключа обновлений, сборка падает" test "$CODE" != 0

# --- latest.json ---
printf 'c2lnbmF0dXJl\n' > "$WORK/a.sig"
run bash "$HERE/make-latest-json.sh" 0.5.0-beta.1 https://github.com/aidbeisembin/shade/releases/download/v0.5.0-beta.1/Shade_aarch64.app.tar.gz "$WORK/a.sig" "Shade 0.5.0-beta.1"
check "latest.json: код 0" test "$CODE" = 0
check "latest.json: версия" test "$(jq -r .version <<<"$OUT")" = 0.5.0-beta.1
check "latest.json: darwin-aarch64" test "$(jq -r '.platforms["darwin-aarch64"].signature' <<<"$OUT")" = c2lnbmF0dXJl
check "latest.json: darwin-aarch64-app" test "$(jq -r '.platforms["darwin-aarch64-app"].url' <<<"$OUT")" = https://github.com/aidbeisembin/shade/releases/download/v0.5.0-beta.1/Shade_aarch64.app.tar.gz
check "latest.json: дата RFC 3339" bash -c "jq -r .pub_date <<<'$OUT' | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$'"
run bash "$HERE/make-latest-json.sh" 0.5.0 http://example.com/a.tar.gz "$WORK/a.sig"
check "latest.json: адрес не https отклонён" test "$CODE" != 0
run bash "$HERE/make-latest-json.sh" 0.5.0 https://example.com/a.tar.gz "$WORK/missing.sig"
check "latest.json: без подписи отклонён" test "$CODE" != 0

# --- подпись обновления (minisign, формат Tauri: base64 от файлов minisign) ---
if command -v minisign >/dev/null; then
  cd "$WORK"
  minisign -G -W -p good.pub -s good.key >/dev/null 2>&1
  minisign -G -W -p other.pub -s other.key >/dev/null 2>&1
  printf 'update-bytes' > update.tar.gz
  minisign -S -s good.key -m update.tar.gz -x update.minisig >/dev/null 2>&1
  base64 < update.minisig | tr -d '\n' > update.tar.gz.sig
  conf_for() { jq -n --arg k "$(base64 < "$1" | tr -d '\n')" '{plugins: {updater: {pubkey: $k}}}' > "$2"; }
  conf_for good.pub good.json
  conf_for other.pub other.json
  cd - >/dev/null
  run bash "$HERE/verify-updater-signature.sh" "$WORK/update.tar.gz" "$WORK/update.tar.gz.sig" "$WORK/good.json"
  check "подпись обновления: сходится" test "$CODE" = 0
  printf 'tampered' > "$WORK/update.tar.gz"
  run bash "$HERE/verify-updater-signature.sh" "$WORK/update.tar.gz" "$WORK/update.tar.gz.sig" "$WORK/good.json"
  check "подпись обновления: подменённый файл отклонён" test "$CODE" != 0
  printf 'update-bytes' > "$WORK/update.tar.gz"
  run bash "$HERE/verify-updater-signature.sh" "$WORK/update.tar.gz" "$WORK/update.tar.gz.sig" "$WORK/other.json"
  check "подпись обновления: чужой ключ в конфиге отклонён" test "$CODE" != 0
  check "подпись обновления: сказано, что не поставится" has "обновление не поставится"
elif [ "${SHADE_REQUIRE_MINISIGN:-0}" = 1 ]; then
  fail=$((fail + 1)); echo "FAIL подпись обновления: нет minisign, а в CI он обязателен"
else
  skip=$((skip + 4)); echo "skip подпись обновления: нет minisign"
fi

# --- описание релиза ---
printf 'abc  Shade_aarch64.dmg\n' > "$WORK/SHA256SUMS.txt"
fake_root
run env SHADE_ROOT="$WORK/root" bash "$HERE/release-notes.sh" 0.5.0-beta.1 "$WORK/SHA256SUMS.txt"
check "описание: чат беты из константы репозитория" has "Обсудить в чате беты в Telegram: https://t.me/shadebeta"
sed -i.bak "s|^export const BETA_CHAT_URL = '.*';|export const BETA_CHAT_URL = '';|" "$WORK/root/frontend/src/shade/lib/beta-chat.ts"
run env SHADE_ROOT="$WORK/root" bash "$HERE/release-notes.sh" 0.5.0-beta.1 "$WORK/SHA256SUMS.txt"
check "описание: код 0" test "$CODE" = 0
check "описание: сначала Терминал, потом .dmg" first_then "### 1. Одна строка в Терминале" "### 2. Скачать .dmg"
check "описание: запасная команда xattr" has "xattr -cr /Applications/Shade.app"
check "описание: install.sh сверяет подпись" has "подпись «Shade Beta Signing»"
check "описание: «Всё равно открыть» и про час" has "видна около часа"
check "описание: команда установки" has "curl -fsSL https://aidbeisembin.com/shade/install.sh | bash"
check "описание: суммы" has "abc  Shade_aarch64.dmg"
check "описание: без чата, когда константа пустая" bash -c "! grep -q 'чате беты' <<<'$OUT'"
sed -i.bak "s|^export const BETA_CHAT_URL = '.*';|export const BETA_CHAT_URL = 'https://t.me/shade_beta_test';|" "$WORK/root/frontend/src/shade/lib/beta-chat.ts"
run env SHADE_ROOT="$WORK/root" bash "$HERE/release-notes.sh" 0.5.0-beta.1 "$WORK/SHA256SUMS.txt"
check "описание: чат появляется, когда задан" has "Обсудить в чате беты в Telegram: https://t.me/shade_beta_test"

# --- README: тот же порядок способов, запасная команда рядом с инструкцией .dmg ---
# Главный README на английском (страница репозитория), русский в README.ru.md; проверяются оба
OUT=$(cat "$ROOT/README.md")
check "README (en): сначала Терминал, потом .dmg" first_then "### Option 1. One line in Terminal" "### Option 2. Download the .dmg"
check "README (en): команда установки в способе 1" first_then "curl -fsSL https://aidbeisembin.com/shade/install.sh | bash" "### Option 2. Download the .dmg"
check "README (en): xattr после шагов .dmg" first_then "4. In the «Open Shade?» dialog" "xattr -cr /Applications/Shade.app"
OUT=$(cat "$ROOT/README.ru.md")
check "README: сначала Терминал, потом .dmg" first_then "### Способ 1. Одна строка в Терминале" "### Способ 2. Скачать .dmg"
check "README: команда установки в способе 1" first_then "curl -fsSL https://aidbeisembin.com/shade/install.sh | bash" "### Способ 2. Скачать .dmg"
check "README: xattr после шагов .dmg" first_then "<!-- /install-steps -->" "xattr -cr /Applications/Shade.app"

echo
echo "release scripts: ok $pass, fail $fail, skip $skip"
[ "$fail" = 0 ]
