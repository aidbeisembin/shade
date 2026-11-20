#!/usr/bin/env bash
# ВРЕМЕННО: какие расширения самоподписанного сертификата codesign на macos-15 принимает.
set -uo pipefail
W=$(mktemp -d); KC="$W/p.keychain-db"; P=$(openssl rand -hex 8)
OLD=$(security list-keychains -d user | tr -d '"' | xargs)
security create-keychain -p "$P" "$KC"; security unlock-keychain -p "$P" "$KC"
mkdir -p "$W/x.app/Contents/MacOS"; printf 'int main(void){return 0;}\n' > "$W/m.c"; /usr/bin/clang -o "$W/x.app/Contents/MacOS/x" "$W/m.c"
printf '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.x</string><key>CFBundleExecutable</key><string>x</string></dict></plist>' > "$W/x.app/Contents/Info.plist"
openssl version
variants=(
  "all-critical|basicConstraints=critical,CA:false|keyUsage=critical,digitalSignature|extendedKeyUsage=critical,codeSigning"
  "eku-noncrit|basicConstraints=critical,CA:false|keyUsage=critical,digitalSignature|extendedKeyUsage=codeSigning"
  "bc-noncrit|basicConstraints=CA:false|keyUsage=critical,digitalSignature|extendedKeyUsage=critical,codeSigning"
  "ku-noncrit|basicConstraints=critical,CA:false|keyUsage=digitalSignature|extendedKeyUsage=critical,codeSigning"
  "none-crit|basicConstraints=CA:false|keyUsage=digitalSignature|extendedKeyUsage=codeSigning"
  "ku-eku-crit-no-bc|keyUsage=critical,digitalSignature|extendedKeyUsage=critical,codeSigning"
)
for v in "${variants[@]}"; do
  IFS='|' read -r name e1 e2 e3 <<<"$v"
  args=(-addext "$e1" -addext "$e2"); [ -n "${e3:-}" ] && args+=(-addext "$e3")
  openssl req -x509 -newkey rsa:2048 -sha256 -days 2 -nodes -keyout "$W/$name.key" -out "$W/$name.pem" -subj "/CN=Probe $name" "${args[@]}" >/dev/null 2>&1
  openssl pkcs12 -export -inkey "$W/$name.key" -in "$W/$name.pem" -name "Probe $name" -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -passout pass:t -out "$W/$name.p12" >/dev/null 2>&1
  security import "$W/$name.p12" -k "$KC" -f pkcs12 -P t -T /usr/bin/codesign >/dev/null
done
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$P" "$KC" >/dev/null
security list-keychains -d user -s "$KC" $OLD
for trust in no yes; do
  for v in "${variants[@]}"; do
    name=${v%%|*}
    [ "$trust" = yes ] && sudo security add-trusted-cert -d -r trustRoot -p codeSign -k "$KC" "$W/$name.pem" >/dev/null 2>&1
    if out=$(codesign --force --keychain "$KC" -s "Probe $name" "$W/x.app" 2>&1); then r=OK; else r="FAIL: $out"; fi
    echo "PROBE trust=$trust $name: $r"
  done
  security find-identity -p codesigning "$KC" | sed 's/^/PROBE   /'
done
security list-keychains -d user -s $OLD
