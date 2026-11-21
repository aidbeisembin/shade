#!/usr/bin/env bash
# Тест scripts/release/check-signature.sh на macOS: одноразовый самоподписанный сертификат во
# временной связке ключей, два приложения разных версий.
# Случаи: две версии с одной подписью (требование одно, без cdhash, CDHash разные); ad-hoc
# подпись (требование привязано к cdhash) отклонена; неподписанное отклонено; другой сертификат
# (macOS сочла бы его другим приложением) отклонён; не то имя сертификата отклонено.
# unsign-dmg.sh: подписанный образ становится неподписанным, приложение внутри то же.
# install.sh с настоящими codesign, hdiutil и curl (file://): ставит приложение нужного сертификата;
# чужой сертификат, ad-hoc, без подписи и изменённое после подписи приложение не ставит.
# import-signing-cert.sh: годный .p12 принят; самоподписанный с basicConstraints, неверный пароль,
# не то имя отклонены.
# Запуск: bash scripts/release/test-check-signature.sh (только macOS).

set -eEuo pipefail

[ "$(uname -s)" = Darwin ] || { echo "skip: нужна macOS"; exit 0; }

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/check-signature.sh"
WORK="$(mktemp -d)"
KC="$WORK/test.keychain-db"
KPW=$(openssl rand -hex 16)
# Связка в списке поиска, как в import-signing-cert.sh: на macOS 15 codesign --keychain без этого
# отвечает «The specified item could not be found in the keychain». При выходе список прежний
OLD_LIST=$(security list-keychains -d user | tr -d '"' | xargs)
restore() {
  hdiutil detach "$WORK/smnt" -quiet >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  security list-keychains -d user -s $OLD_LIST
  security delete-keychain "$KC" >/dev/null 2>&1 || true
  for k in "$WORK"/rt-*/shade-signing.keychain-db; do [ -e "$k" ] && security delete-keychain "$k" >/dev/null 2>&1; done
  rm -rf "$WORK"
}
trap restore EXIT
trap 'echo "test-check-signature: строка $LINENO: $BASH_COMMAND" >&2' ERR

pass=0 fail=0
run() { CODE=0; OUT=$(trap - ERR; "$@" 2>&1) || CODE=$?; }
check() {
  local name="$1"; shift
  if "$@"; then pass=$((pass + 1)); echo "ok   $name"; else fail=$((fail + 1)); echo "FAIL $name"; echo "$OUT" | sed 's/^/     /'; fi
}
has() { grep -qF -- "$1" <<<"$OUT"; }

# Сертификат подписи кода (как «Shade Beta Signing», только одноразовый) в .p12; без
# basicConstraints, как настоящий (с ним codesign на macOS 15 не подписывает). Третий аргумент:
# лишнее расширение для случая «не тот сертификат»
p12() {
  local name="$1" f="$WORK/$2"
  # Свой конфиг: без него openssl req -x509 добавляет basicConstraints CA:TRUE из системного openssl.cnf
  printf '[req]\ndistinguished_name = dn\nprompt = no\nx509_extensions = ext\n[dn]\nCN = %s\n[ext]\nkeyUsage = critical, digitalSignature\nextendedKeyUsage = critical, codeSigning\nsubjectKeyIdentifier = hash\n%s\n' \
    "$name" "${3:-}" > "$f.cnf"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 2 -nodes -keyout "$f.key" -out "$f.pem" -config "$f.cnf" \
    >"$f.log" 2>&1 || { cat "$f.log" >&2; return 1; }
  openssl pkcs12 -export -inkey "$f.key" -in "$f.pem" -name "$name" -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES \
    -macalg sha1 -passout pass:test -out "$f.p12" >"$f.log" 2>&1 || { cat "$f.log" >&2; return 1; }
}
cert() { p12 "$@"; security import "$WORK/$2.p12" -k "$KC" -f pkcs12 -P test -T /usr/bin/codesign >/dev/null; }
security create-keychain -p "$KPW" "$KC"
security set-keychain-settings -lut 600 "$KC"
security unlock-keychain -p "$KPW" "$KC"
cert "Shade Test Signing" a
cert "Other Test Signing" b
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KPW" "$KC" >/dev/null
# shellcheck disable=SC2086
security list-keychains -d user -s "$KC" $OLD_LIST

# Минимальное приложение с идентификатором Shade; версия в Info.plist и в коде
app() {
  local dir="$WORK/$1.app" v="$2"
  mkdir -p "$dir/Contents/MacOS"
  printf 'int main(void){return %s;}\n' "${v//./}" > "$WORK/$1.c"
  /usr/bin/clang -o "$dir/Contents/MacOS/Shade" "$WORK/$1.c"
  cat > "$dir/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.aidbeisembin.shade</string>
<key>CFBundleExecutable</key><string>Shade</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$v</string>
<key>CFBundleVersion</key><string>$v</string>
</dict></plist>
EOF
  echo "$dir"
}
# По имени, как Tauri; если не вышло, печатаем, что видит связка
sign() {
  codesign --force --keychain "$KC" --options runtime -s "$1" "$2" 2>"$WORK/sign.err" && return 0
  echo "sign: «${1}» не вышло: $(cat "$WORK/sign.err")" >&2
  security find-identity -p codesigning "$KC" >&2
  return 1
}

A=$(app a 0.5.1); sign "Shade Test Signing" "$A"
B=$(app b 0.5.2); sign "Shade Test Signing" "$B"
C=$(app c 0.5.3); codesign --force -s - "$C"
D=$(app d 0.5.4)
E=$(app e 0.5.5); sign "Other Test Signing" "$E"

run bash "$CHECK" "$A" "$B"
check "две версии одной подписью: код 0" test "$CODE" = 0
check "две версии: требование по сертификату" has 'certificate leaf = H"'
check "две версии: требования совпадают" has "Требования совпадают"
check "две версии: CDHash разные" test "$(grep -c 'CDHash:' <<<"$OUT")" = 2 -a "$(grep 'CDHash:' <<<"$OUT" | sort -u | wc -l | tr -d ' ')" = 2

run bash "$CHECK" "$C"
check "ad-hoc: отклонено" test "$CODE" != 0
check "ad-hoc: сказано про сброс разрешений" has "ad-hoc"

run bash "$CHECK" "$D"
check "без подписи: отклонено" test "$CODE" != 0

run bash "$CHECK" "$A" "$E"
check "другой сертификат: отклонено" test "$CODE" != 0
check "другой сертификат: требования расходятся" has "Требования расходятся"

run env SHADE_SIGNING_IDENTITY="Shade Beta Signing" bash "$CHECK" "$A"
check "не тот сертификат по имени: отклонено" test "$CODE" != 0

# unsign-dmg.sh: подписанный образ (как у Tauri) становится неподписанным, приложение внутри то же
mkdir -p "$WORK/dmgsrc"; ditto "$A" "$WORK/dmgsrc/Shade.app"
hdiutil create -quiet -volname Shade -srcfolder "$WORK/dmgsrc" -format UDZO "$WORK/s.dmg"
codesign --force --keychain "$KC" -s "Shade Test Signing" "$WORK/s.dmg"
run codesign -dv "$WORK/s.dmg"
check "dmg: до снятия подписан" test "$CODE" = 0
run bash "$HERE/unsign-dmg.sh" "$WORK/s.dmg"
check "dmg: скрипт отработал" test "$CODE" = 0
run codesign -dv "$WORK/s.dmg"
check "dmg: подписи больше нет" test "$CODE" != 0
hdiutil attach -nobrowse -readonly -quiet -mountpoint "$WORK/smnt" "$WORK/s.dmg"
run bash "$CHECK" "$WORK/smnt/Shade.app" "$A"
hdiutil detach "$WORK/smnt" -quiet
check "dmg: приложение внутри с той же подписью" test "$CODE" = 0
run bash "$HERE/unsign-dmg.sh" "$WORK/нет.dmg"
check "dmg: нет файла, отказ" test "$CODE" != 0

# install.sh: настоящие codesign, hdiutil и curl (file://), подставной только open (не запускать)
inst() {
  local app="$1" rel="$WORK/rel-$2"; shift 2
  mkdir -p "$rel/src" "$rel/apps" "$rel/stub"
  ditto "$app" "$rel/src/Shade.app"
  hdiutil create -quiet -volname Shade -srcfolder "$rel/src" -format UDZO "$rel/Shade_aarch64.dmg"
  (cd "$rel" && shasum -a 256 Shade_aarch64.dmg > SHA256SUMS.txt)
  printf '#!/bin/sh\necho "open $*"\n' > "$rel/stub/open"; chmod +x "$rel/stub/open"
  run env PATH="$rel/stub:$PATH" LANG=ru_RU.UTF-8 SHADE_RELEASE_URL="file://$rel" SHADE_APPS_DIR="$rel/apps" "$@" \
    /bin/bash "$HERE/../install.sh"
  INST_APPS="$rel/apps"
}
refused() { test "$CODE" != 0 && has "подпись не совпала, ничего не установлено" && test ! -e "$INST_APPS/Shade.app"; }
inst "$A" ok SHADE_SIGNER="Shade Test Signing"
check "install.sh: свой сертификат, поставлено" test "$CODE" = 0 -a -x "$INST_APPS/Shade.app/Contents/MacOS/Shade"
check "install.sh: свой сертификат, запущено" has "open $INST_APPS/Shade.app"
inst "$A" default
check "install.sh: ждёт «Shade Beta Signing», подпись другая, отказ" refused
inst "$E" other SHADE_SIGNER="Shade Test Signing"
check "install.sh: чужой сертификат, отказ" refused
inst "$C" adhoc SHADE_SIGNER="Shade Test Signing"
check "install.sh: ad-hoc, отказ" refused
inst "$D" unsigned SHADE_SIGNER="Shade Test Signing"
check "install.sh: без подписи, отказ" refused
T="$WORK/t.app"; ditto "$A" "$T"; /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 9.9.9" "$T/Contents/Info.plist"
inst "$T" tampered SHADE_SIGNER="Shade Test Signing"
check "install.sh: изменён после подписи, отказ" refused

# import-signing-cert.sh: секреты как в CI; сертификат с basicConstraints отклонён до сборки
imp() {
  mkdir -p "$WORK/rt-$1"
  run env -u GITHUB_OUTPUT RUNNER_TEMP="$WORK/rt-$1" MACOS_CERTIFICATE="$(base64 < "$WORK/$1.p12" | tr -d '\n')" \
    MACOS_CERTIFICATE_PASSWORD="${2:-test}" MACOS_SIGNING_IDENTITY="$3" bash "$HERE/import-signing-cert.sh"
}
p12 "Shade Import Signing" imp-ok
p12 "Shade Import BC" imp-bc "basicConstraints = critical, CA:false"
imp imp-ok test "Shade Import Signing"
check "импорт: годный сертификат принят" test "$CODE" = 0
imp imp-bc test "Shade Import BC"
check "импорт: basicConstraints отклонён" test "$CODE" != 0
check "импорт: сказано почему" has "basicConstraints"
imp imp-ok wrong "Shade Import Signing"
check "импорт: неверный пароль отклонён" test "$CODE" != 0
imp imp-ok test "Shade Missing Signing"
check "импорт: нет такого имени отклонено" test "$CODE" != 0

echo
echo "check-signature: ok $pass, fail $fail"
[ "$fail" = 0 ]
