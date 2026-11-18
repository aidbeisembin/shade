#!/usr/bin/env bash
# Тест scripts/migrate-identifier.sh на подставном HOME с вымышленными данными.
# Случаи из таблицы PR: есть только старые данные; повторный запуск; нет данных вовсе;
# сбой посередине; цель уже есть (новую сборку запускали до переноса); приложение запущено;
# архив старого; старый identifier внутри данных.
# Запуск: bash scripts/test-migrate-identifier.sh (macOS и Linux; нужны python3 и bash).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/migrate-identifier.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
NO_APP="$WORK/no-app.sh"
printf '#!/bin/sh\nexit 1\n' > "$NO_APP"; chmod +x "$NO_APP"
APP_RUNS="$WORK/app-runs.sh"
printf '#!/bin/sh\n[ "$2" = Shade ]\n' > "$APP_RUNS"; chmod +x "$APP_RUNS"

OLD_ID="io.github.katanana23.shade"
NEW_ID="com.aidbeisembin.shade"

PASS=0
ok() { PASS=$((PASS + 1)); printf 'ok   %s\n' "$1"; }
no() { printf 'FAIL %s\n' "$1" >&2; cat "$WORK/out" >&2; exit 1; }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }

run() { # HOME [ключи...] -> вывод в $WORK/out, код в RC
  local home="$1"; shift
  set +e
  HOME="$home" SHADE_MIGRATE_PGREP="${PGREP_STUB:-$NO_APP}" bash "$SCRIPT" "$@" >"$WORK/out" 2>&1
  RC=$?
  set -e
}

# Вымышленные данные под старым identifier, как у Shade после переноса 14.11: база в режиме
# WAL с несброшенным журналом (две встречи из трёх только в -wal), модели, настройки, метка
# прошлого переноса, localStorage с темой и языком; записи и свои шаблоны в папках без identifier.
seed() {
  local h="$1"
  local as="$h/Library/Application Support"
  local data="$as/$OLD_ID" rec="$h/Movies/Shade"
  local ls_dir="$h/Library/WebKit/$OLD_ID/WebsiteData/Default/h1/h1/LocalStorage"
  mkdir -p "$data/models/parakeet/m" "$as/Shade" "$rec/Meeting A" "$rec/Корзина Shade/Meeting B" \
    "$ls_dir" "$h/Library/Caches/$OLD_ID"
  printf 'model' > "$data/models/parakeet/m/encoder.onnx"
  printf '{"status":{"completed":true}}' > "$data/onboarding-status.json"
  printf '{"save_folder":"%s"}' "$rec" > "$data/recording_preferences.json"
  printf '{"from":"%s/io.github.katanana23.aid-meetings","at":"20261114-120000"}\n' "$as" > "$data/.shade-migrated"
  printf '{"enabled":true}' > "$as/Shade/notifications.json"
  printf 'audio' > "$rec/Meeting A/audio.mp4"
  printf 'audio' > "$rec/Корзина Shade/Meeting B/audio.mp4"
  printf '{"trashedAt":1,"name":"B","meetingId":"m-b","from":"%s/Meeting B","title":"B"}' "$rec" > "$rec/Корзина Shade/Meeting B/trashed.json"
  printf 'cache' > "$h/Library/Caches/$OLD_ID/c"
  python3 -I - "$data/meeting_minutes.sqlite" "$rec" <<'PY'
import os, sqlite3, sys
db, rec = sys.argv[1:]
c = sqlite3.connect(db)
c.execute('PRAGMA journal_mode=WAL')
c.execute('PRAGMA wal_autocheckpoint=0')
c.execute('CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, folder_path TEXT)')
c.execute('INSERT INTO meetings VALUES (?,?,?,?,?)', ('m-a', 'A', '1', '1', rec + '/Meeting A'))
c.commit()
c.execute('PRAGMA wal_checkpoint(TRUNCATE)')
c.executemany('INSERT INTO meetings VALUES (?,?,?,?,?)', [
    ('m-b', 'B', '1', '1', rec + '/Корзина Shade/Meeting B'),
    ('m-c', 'C', '1', '1', rec + '/Meeting C'),
])
c.commit()
os._exit(0)  # без close: журнал остаётся в -wal, как у закрытого посреди работы приложения
PY
  python3 -I - "$ls_dir/localstorage.sqlite3" "$rec" <<'PY'
import json, sqlite3, sys
ls, rec = sys.argv[1:]
c = sqlite3.connect(ls)
c.execute('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB NOT NULL ON CONFLICT FAIL)')
items = {
    'shade.theme': 'dark',
    'shade.lang': 'en',
    'shade.meetingTrash.v1': json.dumps([{'id': 'm-b', 'title': 'B', 'folder': rec + '/Meeting B', 'at': 1}]),
    'primaryLanguage': 'ru',
}
c.executemany('INSERT INTO ItemTable VALUES (?, ?)', [(k, v.encode('utf-16-le')) for k, v in items.items()])
c.commit(); c.close()
PY
}

snapshot() { # хеш всех файлов дерева (имена и содержимое)
  python3 -I - "$1" <<'PY'
import hashlib, os, sys
h = hashlib.sha256()
for root, dirs, files in sorted(os.walk(sys.argv[1])):
    dirs.sort()
    for f in sorted(files):
        p = os.path.join(root, f)
        h.update(os.path.relpath(p, sys.argv[1]).encode())
        h.update(open(p, 'rb').read())
print(h.hexdigest())
PY
}
old_snap() { # всё старое и всё, что от identifier не зависит
  local h="$1"
  printf '%s' "$(snapshot "$h/Library/Application Support/$OLD_ID")$(snapshot "$h/Library/WebKit/$OLD_ID")$(snapshot "$h/Library/Caches/$OLD_ID")$(snapshot "$h/Movies/Shade")$(snapshot "$h/Library/Application Support/Shade")"
}
q() { python3 -I -c "$1" "${@:2}"; }

# --- 1. Есть только старые данные -----------------------------------------------------
H="$WORK/h1"; seed "$H"
check "засев: две встречи только в журнале -wal" '[ -s "$H/Library/Application Support/$OLD_ID/meeting_minutes.sqlite-wal" ]'
BEFORE_OLD="$(old_snap "$H")"
run "$H"
cat "$WORK/out"
NEW_AS="$H/Library/Application Support/$NEW_ID"
LS_NEW="$H/Library/WebKit/$NEW_ID/WebsiteData/Default/h1/h1/LocalStorage/localstorage.sqlite3"
check "перенос: выход 0, проверка прошла" '[ "$RC" = 0 ] && grep -q "всё сходится" "$WORK/out"'
check "перенос: встречи посчитаны с журналом (3 и 3)" 'grep -q "встреч 3, папки записей на месте у 2 (в старой базе встреч 3)" "$WORK/out"'
check "база, модели, настройки на новом месте" '[ -f "$NEW_AS/meeting_minutes.sqlite-wal" ] && [ "$(cat "$NEW_AS/models/parakeet/m/encoder.onnx")" = model ] && [ -f "$NEW_AS/onboarding-status.json" ]'
check "метка нового переноса указывает на старый identifier" 'grep -q "\"from\":\"$H/Library/Application Support/$OLD_ID\"" "$NEW_AS/.shade-migrated"'
check "база в новой папке читается и полна" '[ "$(q "import sqlite3,sys; print(sqlite3.connect(sys.argv[1]).execute(\"select count(*) from meetings\").fetchone()[0])" "$NEW_AS/meeting_minutes.sqlite")" = 3 ]'
check "localStorage: тема и язык на месте" '[ "$(q "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); g=lambda k: bytes(c.execute(\"select value from ItemTable where key=?\",(k,)).fetchone()[0]).decode(\"utf-16-le\"); print(g(\"shade.theme\"), g(\"shade.lang\"))" "$LS_NEW")" = "dark en" ]'
check "кеш перенесён" '[ -f "$H/Library/Caches/$NEW_ID/c" ]'
check "старое и папки без identifier не тронуты" '[ "$(old_snap "$H")" = "$BEFORE_OLD" ]'
check "Movies/Shade и Application Support/Shade не скопированы под новым именем" '[ -z "$(find "$H" -path "*$NEW_ID*" -name "notifications.json")" ] && [ -z "$(find "$H" -path "*$NEW_ID*" -name "audio.mp4")" ]'
check "временных папок не осталось" '[ -z "$(find "$H" -name "*.shade-migrating*")" ]'

# --- 2. Повторный запуск -------------------------------------------------------------
BEFORE="$(snapshot "$H")"
run "$H"
check "повторный запуск: выход 0, три папки уже перенесены" '[ "$RC" = 0 ] && [ "$(grep -c "уже перенесено" "$WORK/out")" = 3 ] && grep -q "всё сходится" "$WORK/out"'
check "повторный запуск: дерево не изменилось" '[ "$(snapshot "$H")" = "$BEFORE" ]'
run "$H" --check
check "--check: выход 0" '[ "$RC" = 0 ] && grep -q "всё сходится" "$WORK/out"'

# --- 3. Данных нет вовсе ---------------------------------------------------------------
E="$WORK/empty"; mkdir -p "$E"
run "$E"
check "нет данных: выход 0, ничего не создано" '[ "$RC" = 0 ] && [ -z "$(find "$E" -mindepth 1)" ]'

# --- 4. Сбой посередине -----------------------------------------------------------------
I="$WORK/int"; seed "$I"
BEFORE_OLD="$(old_snap "$I")"
set +e
HOME="$I" SHADE_MIGRATE_PGREP="$NO_APP" SHADE_MIGRATE_STOP_AFTER_COPY=webkit bash "$SCRIPT" >"$WORK/out" 2>&1; RC=$?
set -e
check "сбой: скрипт оборвался" '[ "$RC" = 3 ]'
check "сбой: папка данных перенесена, хранилище окна только во временной копии" '[ -f "$I/Library/Application Support/$NEW_ID/.shade-migrated" ] && [ -d "$I/Library/WebKit/$NEW_ID.shade-migrating" ] && [ ! -e "$I/Library/WebKit/$NEW_ID" ]'
check "сбой: старое не тронуто" '[ "$(old_snap "$I")" = "$BEFORE_OLD" ]'
run "$I"
check "после сбоя: повторный запуск доводит до конца" '[ "$RC" = 0 ] && [ -f "$I/Library/WebKit/$NEW_ID/.shade-migrated" ] && grep -q "всё сходится" "$WORK/out"'
check "после сбоя: неполная копия отложена, не удалена" '[ -n "$(find "$I/Library/WebKit" -maxdepth 1 -name "$NEW_ID.shade-migrating.stale-*")" ]'

# --- 5. Цель уже есть: новую сборку запускали до переноса ----------------------------
P="$WORK/pre"; seed "$P"
mkdir -p "$P/Library/Application Support/$NEW_ID"
printf 'fresh' > "$P/Library/Application Support/$NEW_ID/onboarding-status.json"
run "$P"
check "цель без метки: отложена, перенос прошёл" '[ "$RC" = 0 ] && [ "$(cat "$P/Library/Application Support/$NEW_ID".pre-migration-*/onboarding-status.json)" = fresh ] && [ -f "$P/Library/Application Support/$NEW_ID/.shade-migrated" ] && grep -q "всё сходится" "$WORK/out"'

# --- 6. Приложение запущено ------------------------------------------------------------
R="$WORK/run"; seed "$R"
BEFORE="$(snapshot "$R")"
PGREP_STUB="$APP_RUNS" run "$R"
check "приложение запущено: отказ" '[ "$RC" = 1 ] && grep -q "запущено приложение «Shade»" "$WORK/out"'
check "приложение запущено: ничего не изменено" '[ "$(snapshot "$R")" = "$BEFORE" ]'

# --- 7. Архив старого --------------------------------------------------------------------
A="$WORK/arc"; seed "$A"
run "$A" --archive-old
check "архив без переноса: отказ, старое на месте" '[ "$RC" = 1 ] && [ -d "$A/Library/Application Support/$OLD_ID" ]'
run "$A"; run "$A" --archive-old
check "архив после переноса: старое в _to_delete" '[ "$RC" = 0 ] && [ -d "$A/Library/Application Support/_to_delete/$OLD_ID" ] && [ -d "$A/Library/WebKit/_to_delete/$OLD_ID" ] && [ ! -e "$A/Library/Application Support/$OLD_ID" ]'
check "архив: записи и свои шаблоны на месте" '[ -f "$A/Movies/Shade/Meeting A/audio.mp4" ] && [ -f "$A/Library/Application Support/Shade/notifications.json" ]'
run "$A"
check "после архива: повторный запуск спокоен, сверка со старым из _to_delete" '[ "$RC" = 0 ] && grep -q "в старой базе встреч 3" "$WORK/out" && grep -q "всё сходится" "$WORK/out"'

# --- 8. Старый identifier внутри данных ----------------------------------------------
X="$WORK/stale"; seed "$X"
printf '{"model_dir":"%s/Library/Application Support/%s/models"}' "$X" "$OLD_ID" > "$X/Library/Application Support/$OLD_ID/preferences.json"
run "$X"
check "старый identifier в настройках: проверка не прошла, старое на месте" '[ "$RC" = 1 ] && grep -q "старый identifier в preferences.json" "$WORK/out" && [ -f "$X/Library/Application Support/$OLD_ID/preferences.json" ]'

printf '\nВсе проверки прошли: %s\n' "$PASS"
