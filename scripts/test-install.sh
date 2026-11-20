#!/usr/bin/env bash
# Тест scripts/install.sh на подставных командах (curl, hdiutil, ditto, pgrep, sysctl, uname, open)
# и временной папке вместо /Applications. Случаи из таблицы PR: установка с нуля, Shade уже стоит
# (данные не тронуты), Shade запущен, нет сети, SHA-256 не совпал, суммы нет в SHA256SUMS.txt,
# не Apple Silicon, не macOS, тексты на английском.
# Сам install.sh исполняется /bin/bash, если он есть (на Mac это bash 3.2, как у curl | bash).
# Запуск: bash scripts/test-install.sh (macOS и Linux).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
INSTALL="$HERE/install.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
RUN_BASH=/bin/bash
[ -x "$RUN_BASH" ] || RUN_BASH="$(command -v bash)"

STUB="$WORK/stub" FIX="$WORK/fix"
mkdir -p "$STUB" "$FIX/Shade.app/Contents/MacOS"
echo new > "$FIX/Shade.app/Contents/version"
printf 'dmg-bytes' > "$FIX/Shade_aarch64.dmg"

stub() { printf '#!/usr/bin/env bash\n%s\n' "$2" > "$STUB/$1"; chmod +x "$STUB/$1"; }
stub uname 'echo "${FAKE_UNAME:-Darwin}"'
stub sysctl 'echo "${FAKE_ARM64:-1}"'
stub pgrep '[ "${FAKE_RUNNING:-0}" = 1 ]'
stub open 'echo "open $*" >> "$LOG"'
stub ditto 'cp -R "$1" "$2"'
# curl -fsSL --retry 2 -o <файл> <адрес>
stub curl 'url="${!#}"; echo "curl $url" >> "$LOG"; [ "${FAKE_OFFLINE:-0}" = 1 ] && exit 6
out=""; while [ $# -gt 0 ]; do if [ "$1" = -o ]; then out="$2"; shift; fi; shift; done
cp "$FIX/${url##*/}" "$out"'
# hdiutil attach ... -mountpoint <папка> <dmg> | hdiutil detach <папка>
stub hdiutil 'if [ "$1" = attach ]; then m=""; while [ $# -gt 0 ]; do if [ "$1" = -mountpoint ]; then m="$2"; shift; fi; shift; done
mkdir -p "$m" && cp -R "$FIX/Shade.app" "$m/"; else exit 0; fi'

pass=0 fail=0

# новый «Mac»: пустая папка программ, данные Shade в своём HOME
fresh() {
  rm -rf "$WORK/apps" "$WORK/home" "$WORK/log"
  mkdir -p "$WORK/apps" "$WORK/home/Library/Application Support/com.aidbeisembin.shade"
  echo meetings > "$WORK/home/Library/Application Support/com.aidbeisembin.shade/meeting_minutes.sqlite"
  : > "$WORK/log"
  if [ "${BAD_SUM:-0}" = 1 ]; then
    echo "0000000000000000000000000000000000000000000000000000000000000000  Shade_aarch64.dmg" > "$FIX/SHA256SUMS.txt"
  elif [ "${NO_SUM:-0}" = 1 ]; then
    (cd "$FIX" && shasum -a 256 Shade.app/Contents/version > SHA256SUMS.txt)
  else
    (cd "$FIX" && shasum -a 256 Shade_aarch64.dmg > SHA256SUMS.txt)
  fi
}

run() {
  set +e
  OUT=$(env PATH="$STUB:$PATH" HOME="$WORK/home" LOG="$WORK/log" FIX="$FIX" \
    FAKE_UNAME="${FAKE_UNAME:-Darwin}" FAKE_ARM64="${FAKE_ARM64:-1}" FAKE_RUNNING="${FAKE_RUNNING:-0}" FAKE_OFFLINE="${FAKE_OFFLINE:-0}" \
    SHADE_APPS_DIR="$WORK/apps" SHADE_RELEASE_URL="https://example.test/latest/download" \
    LANG="${TEST_LANG:-ru_RU.UTF-8}" "$RUN_BASH" "$INSTALL" 2>&1)
  CODE=$?
  set -e
}

check() {
  local name="$1"; shift
  if "$@"; then pass=$((pass + 1)); echo "ok   $name"; else fail=$((fail + 1)); echo "FAIL $name"; echo "$OUT" | sed 's/^/     /'; fi
}

has() { grep -qF -- "$1" <<<"$OUT"; }
app_version() { cat "$WORK/apps/Shade.app/Contents/version" 2>/dev/null; }
data_intact() { [ "$(cat "$WORK/home/Library/Application Support/com.aidbeisembin.shade/meeting_minutes.sqlite")" = meetings ]; }
logged() { grep -qF -- "$1" "$WORK/log"; }

# 1. Установка с нуля: скачан dmg и суммы, приложение на месте, запущено
fresh; run
check "с нуля: код 0" test "$CODE" = 0
check "с нуля: Shade.app на месте" test "$(app_version)" = new
check "с нуля: скачан dmg последнего релиза" logged "curl https://example.test/latest/download/Shade_aarch64.dmg"
check "с нуля: скачаны суммы" logged "curl https://example.test/latest/download/SHA256SUMS.txt"
check "с нуля: запущен" logged "open $WORK/apps/Shade.app"

# 2. Shade уже стоит: заменён, данные не тронуты, старой копии не осталось
fresh; mkdir -p "$WORK/apps/Shade.app/Contents"; echo old > "$WORK/apps/Shade.app/Contents/version"; run
check "уже стоит: код 0" test "$CODE" = 0
check "уже стоит: версия новая" test "$(app_version)" = new
check "уже стоит: данные не тронуты" data_intact
check "уже стоит: сказано про данные" has "данные остаются"
check "уже стоит: в папке только Shade.app" test "$(ls "$WORK/apps")" = Shade.app

# 3. Shade запущен: просим закрыть, ничего не качаем и не меняем
fresh; mkdir -p "$WORK/apps/Shade.app/Contents"; echo old > "$WORK/apps/Shade.app/Contents/version"; 
FAKE_RUNNING=1 run
check "запущен: код не 0" test "$CODE" != 0
check "запущен: просим закрыть" has "Закройте его"
check "запущен: не скачивали" test ! -s "$WORK/log"
check "запущен: старая версия на месте" test "$(app_version)" = old

# 4. Нет сети: понятный отказ, ничего не поставлено
fresh; FAKE_OFFLINE=1 run
check "нет сети: код не 0" test "$CODE" != 0
check "нет сети: сказано про интернет" has "Проверьте интернет"
check "нет сети: приложения нет" test ! -e "$WORK/apps/Shade.app"

# 5. SHA-256 не совпал: отказ, ничего не поставлено, прежняя версия на месте
BAD_SUM=1 fresh; mkdir -p "$WORK/apps/Shade.app/Contents"; echo old > "$WORK/apps/Shade.app/Contents/version"; run
check "сумма не совпала: код не 0" test "$CODE" != 0
check "сумма не совпала: сказано" has "контрольная сумма не совпала"
check "сумма не совпала: прежняя версия на месте" test "$(app_version)" = old
check "сумма не совпала: не запускали" bash -c "! grep -q '^open' '$WORK/log'"

# 6. В SHA256SUMS.txt нет строки для dmg: тот же отказ
NO_SUM=1 fresh; run
check "суммы нет: код не 0" test "$CODE" != 0
check "суммы нет: приложения нет" test ! -e "$WORK/apps/Shade.app"

# 7. Не Apple Silicon: понятный отказ до скачивания
fresh; FAKE_ARM64=0 run
check "Intel: код не 0" test "$CODE" != 0
check "Intel: сказано про Apple Silicon" has "Apple Silicon"
check "Intel: не скачивали" test ! -s "$WORK/log"

# 8. Не macOS
fresh; FAKE_UNAME=Linux run
check "не macOS: код не 0" test "$CODE" != 0
check "не macOS: сказано" has "нужна macOS"

# 9. Английский язык системы: тексты по-английски
fresh; FAKE_ARM64=0 TEST_LANG=en_US.UTF-8 run
check "en: отказ по-английски" has "Apple Silicon (M1 or later) is required"

echo
echo "install.sh: ok $pass, fail $fail"
[ "$fail" = 0 ]
