#!/bin/bash
# Замер нагрузки сохранения записи на заглушке звука: память (RSS) и процессор процесса,
# который пишет встречу настоящим кодом записи (RecordingSaver + IncrementalAudioSaver,
# тон вместо микрофона, реплика раз в 8 с). Распознавание и захват звука в замер не входят.
#
# Использование: scripts/measure-recording-load.sh [секунды=1800] [файл.csv=/tmp/shade-load.csv]
# Требуется собранный тестовый бинарник: cargo test -p meetily --lib crash_recovery --no-run
set -uo pipefail
SECONDS_TOTAL="${1:-1800}"
OUT="${2:-/tmp/shade-load.csv}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CMAKE_DISABLE_FIND_PACKAGE_OpenSSL=TRUE
BIN="$(cd "$ROOT" && cargo test -p meetily --lib crash_recovery --no-run 2>&1 | sed -n 's/.*(\(target\/debug\/deps\/app_lib-[0-9a-f]*\)).*/\1/p' | tail -1)"
[ -n "$BIN" ] || { echo "тестовый бинарник не найден" >&2; exit 1; }
HOME_DIR="$(mktemp -d)"
SHADE_CRASH_CHILD=1 SHADE_PROGRESS="$HOME_DIR/progress.txt" SHADE_CHILD_MS=500 SHADE_CHILD_SEG_EVERY=16 HOME="$HOME_DIR" \
  "$ROOT/$BIN" crash_recovery::tests::recording_child_writes_until_killed --exact --nocapture >/dev/null 2>&1 &
PID=$!
trap 'kill -9 $PID 2>/dev/null || true; rm -rf "$HOME_DIR"' EXIT
sleep 3
echo "elapsed_s,rss_mb,cpu_percent,cpu_time_s,replicas,chunks,transcript_kb" > "$OUT"
START=$(date +%s)
while true; do
  NOW=$(( $(date +%s) - START ))
  [ "$NOW" -ge "$SECONDS_TOTAL" ] && break
  kill -0 $PID 2>/dev/null || { echo "процесс записи завершился раньше срока" >&2; exit 1; }
  # %cpu у ps за всё время жизни; cputime в формате [ч:]м:с.сс
  read -r RSS PCPU CTIME < <(ps -o rss=,pcpu=,cputime= -p $PID)
  FOLDER="$(ls -d "$HOME_DIR"/Movies/*/*/ 2>/dev/null | head -1)"
  CHUNKS=$(ls "$FOLDER/.checkpoints" 2>/dev/null | grep -c '\.mp4$' || true)
  TKB=$(( $(stat -f %z "$FOLDER/transcripts.json" 2>/dev/null || echo 0) / 1024 ))
  REPL=$(cat "$HOME_DIR/progress.txt" 2>/dev/null || echo 0)
  CS=$(echo "$CTIME" | awk -F'[:]' '{ if (NF==3) print $1*3600+$2*60+$3; else print $1*60+$2 }')
  echo "$NOW,$(( RSS / 1024 )),$PCPU,$CS,$REPL,$CHUNKS,$TKB" >> "$OUT"
  sleep 15
done
echo "готово: $OUT"
