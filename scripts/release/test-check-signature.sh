#!/usr/bin/env bash
# Тест scripts/release/check-signature.sh на macOS: одноразовый самоподписанный сертификат во
# временной связке ключей, два приложения разных версий.
# Случаи: две версии с одной подписью (требование одно, без cdhash, CDHash разные); ad-hoc
# подпись (требование привязано к cdhash) отклонена; неподписанное отклонено; другой сертификат
# (macOS сочла бы его другим приложением) отклонён; не то имя сертификата отклонено.
# Запуск: bash scripts/release/test-check-signature.sh (только macOS).

set -euo pipefail

[ "$(uname -s)" = Darwin ] || { echo "skip: нужна macOS"; exit 0; }

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/check-signature.sh"
WORK="$(mktemp -d)"
KC="$WORK/test.keychain-db"
KPW=$(openssl rand -hex 16)
trap 'security delete-keychain "$KC" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
trap 'echo "test-check-signature: строка $LINENO: $BASH_COMMAND" >&2' ERR

pass=0 fail=0
run() { set +e; OUT=$("$@" 2>&1); CODE=$?; set -e; }
check() {
  local name="$1"; shift
  if "$@"; then pass=$((pass + 1)); echo "ok   $name"; else fail=$((fail + 1)); echo "FAIL $name"; echo "$OUT" | sed 's/^/     /'; fi
}
has() { grep -qF -- "$1" <<<"$OUT"; }

# Сертификат подписи кода (как «Shade Beta Signing», только одноразовый) в .p12 и в связку
cert() {
  local name="$1" f="$WORK/$2"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 2 -nodes -keyout "$f.key" -out "$f.pem" -subj "/CN=$name" \
    -addext "basicConstraints=critical,CA:false" -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=critical,codeSigning" >"$f.log" 2>&1 || { cat "$f.log" >&2; return 1; }
  openssl pkcs12 -export -inkey "$f.key" -in "$f.pem" -name "$name" -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES \
    -macalg sha1 -passout pass:test -out "$f.p12" >"$f.log" 2>&1 || { cat "$f.log" >&2; return 1; }
  security import "$f.p12" -k "$KC" -f pkcs12 -P test -T /usr/bin/codesign >/dev/null
}
security create-keychain -p "$KPW" "$KC"
security set-keychain-settings -lut 600 "$KC"
security unlock-keychain -p "$KPW" "$KC"
cert "Shade Test Signing" a
cert "Other Test Signing" b
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KPW" "$KC" >/dev/null

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
sign() { codesign --force --keychain "$KC" --options runtime -s "$1" "$2" >/dev/null 2>&1; }

A=$(app a 0.5.1); sign "Shade Test Signing" "$A"
B=$(app b 0.5.2); sign "Shade Test Signing" "$B"
C=$(app c 0.5.3); codesign --force -s - "$C" >/dev/null 2>&1
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

echo
echo "check-signature: ok $pass, fail $fail"
[ "$fail" = 0 ]
