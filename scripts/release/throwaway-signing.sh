#!/usr/bin/env bash
# Только workflow_dispatch с signing=throwaway: одноразовые сертификат подписи и ключ обновлений,
# чтобы прогнать весь путь релиза (связка ключей, codesign, проверка требования, подпись
# обновления, latest.json) до того, как владелец задаст настоящие секреты. Публикации в этом
# режиме нет: релиз публикуется только по тегу и только с секретами.
# Пишет DRY_* в $GITHUB_ENV; workflow подставляет их вместо секретов только в этом режиме.

set -euo pipefail

: "${RUNNER_TEMP:?}" "${GITHUB_ENV:?}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
dir="$RUNNER_TEMP/throwaway"
mkdir -p "$dir"
name="Shade Dry Run Signing"
pw=$(openssl rand -hex 16)
echo "::add-mask::$pw"

openssl req -x509 -newkey rsa:2048 -sha256 -days 2 -nodes -keyout "$dir/key.pem" -out "$dir/cert.pem" -subj "/CN=$name" \
  -addext "basicConstraints=critical,CA:false" -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1
openssl pkcs12 -export -inkey "$dir/key.pem" -in "$dir/cert.pem" -name "$name" -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES \
  -macalg sha1 -passout "pass:$pw" -out "$dir/cert.p12" >/dev/null 2>&1
(cd "$root/frontend" && pnpm -s tauri signer generate --ci -w "$dir/updater.key" -p "$pw" >/dev/null 2>&1)

cert=$(base64 < "$dir/cert.p12" | tr -d '\n')
key=$(tr -d '\n' < "$dir/updater.key")
echo "::add-mask::$key"
{
  echo "DRY_MACOS_CERTIFICATE=$cert"
  echo "DRY_MACOS_CERTIFICATE_PASSWORD=$pw"
  echo "DRY_MACOS_SIGNING_IDENTITY=$name"
  echo "DRY_TAURI_SIGNING_PRIVATE_KEY=$key"
  echo "DRY_TAURI_SIGNING_PRIVATE_KEY_PASSWORD=$pw"
  echo "DRY_UPDATER_PUBKEY=$(tr -d '\n' < "$dir/updater.key.pub")"
} >> "$GITHUB_ENV"
rm -f "$dir/key.pem" "$dir/cert.p12" "$dir/updater.key"
echo "Одноразовая подпись «${name}» и ключ обновлений готовы (только этот прогон, без публикации)"
