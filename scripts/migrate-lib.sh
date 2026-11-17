# Общий движок переноса данных Shade. Не запускается сам: его подключают (source) скрипты
# переноса, по одному на каждую смену имён:
#   scripts/migrate-from-aid.sh     2026-11-14, Aid Meetings и ShadeNotes -> Shade
#   scripts/migrate-identifier.sh   2026-11-17, io.github.katanana23.shade -> com.aidbeisembin.shade
#
# Скрипт переноса задаёт до вызова shade_migrate_main:
#   PAIRS      массив "метка|старое|новое|вид"; вид file для одиночного файла, любой другой для папки
#   fix_copy   функция (вид, копия): правка путей внутри копии; для видов без правки ничего не делает
#   verify     функция (режим): итоговая проверка; режим strict сразу после переноса, иначе check
#
# Гарантии для каждой пары: клон APFS (cp -c) во временную <цель>.shade-migrating, сверка
# diff -rq со старым, правка копии, метка .shade-migrated и только потом mv в цель. Старое не
# удаляется и не меняется. Повторный запуск пропускает цели с меткой. Прерванная копия
# откладывается в <цель>.shade-migrating.stale-<время>, цель без метки (приложение запускали до
# переноса) в <цель>.pre-migration-<время>. При запущенном приложении отказ, ничего не тронуто.
# --archive-old только по явному ключу и только после переноса с меткой и проверки.
#
# Для тестов: HOME подменяется, SHADE_MIGRATE_PGREP заменяет pgrep,
# SHADE_MIGRATE_STOP_AFTER_COPY=<метка> обрывает работу после копии этой пары (выход 3).

STAMP=".shade-migrated"
TMP_SUFFIX=".shade-migrating"
TS="$(date +%Y%m%d-%H%M%S)"
PGREP="${SHADE_MIGRATE_PGREP:-pgrep}"
L="$HOME/Library"
AS="$L/Application Support"

say() { printf '%s\n' "$*"; }
fail() { printf 'ОШИБКА: %s\n' "$*" >&2; exit 1; }
py() { python3 -I - "$@"; }

refuse_if_running() {
  local name
  for name in Shade ShadeNotes; do
    if "$PGREP" -x "$name" >/dev/null 2>&1; then
      fail "запущено приложение «$name». Закройте его (и tauri dev) и запустите скрипт снова. Ничего не тронуто."
    fi
  done
}

clone_copy() {
  # cp -c: клон APFS, место почти не занимает. Где клонов нет (другая ФС, Linux), обычная копия.
  if [ "$(uname)" = Darwin ] && cp -cRp "$1" "$2" 2>/dev/null; then return 0; fi
  rm -rf "$2" 2>/dev/null || true   # неполный клон: только что созданная копия, не данные
  cp -Rp "$1" "$2"
}

migrate_one() { # метка старое новое вид
  local label="$1" src="$2" dst="$3" kind="$4" tmp="$3$TMP_SUFFIX"
  say "[$label] $src"
  if [ ! -e "$src" ]; then
    if [ -e "$dst" ]; then say "  старого нет, новое на месте"; else say "  старого нет, пропуск"; fi
    return 0
  fi
  if [ "$kind" = file ]; then
    if [ -e "$dst" ] && cmp -s "$src" "$dst"; then say "  уже перенесено"; return 0; fi
    [ -e "$dst" ] && mv "$dst" "$dst.pre-migration-$TS" && say "  новое уже было: отложено в $dst.pre-migration-$TS"
    cp -p "$src" "$tmp" && cmp -s "$src" "$tmp" || fail "копия $src не совпала"
    mv "$tmp" "$dst"
    say "  перенесено -> $dst"
    return 0
  fi
  if [ -e "$dst/$STAMP" ]; then say "  уже перенесено"; return 0; fi
  if [ -e "$tmp" ]; then
    mv "$tmp" "$tmp.stale-$TS"
    say "  прошлый перенос прерван: неполная копия отложена в $tmp.stale-$TS"
  fi
  if [ -e "$dst" ]; then
    mv "$dst" "$dst.pre-migration-$TS"
    say "  новое уже было без метки переноса (приложение запускали раньше): отложено в $dst.pre-migration-$TS"
  fi
  clone_copy "$src" "$tmp"
  diff -rq "$src" "$tmp" >/dev/null || fail "копия $src не совпала со старой; цель не создана, старое не тронуто"
  if [ "${SHADE_MIGRATE_STOP_AFTER_COPY:-}" = "$label" ]; then
    say "  (тест) обрыв после копии"; exit 3
  fi
  fix_copy "$kind" "$tmp"
  printf '{"from":"%s","at":"%s"}\n' "$src" "$TS" > "$tmp/$STAMP"
  mv "$tmp" "$dst"
  say "  перенесено -> $dst"
}

archive_old() {
  local entry label src dst kind parent target
  for entry in "${PAIRS[@]}"; do
    IFS='|' read -r label src dst kind <<<"$entry"
    if [ ! -e "$src" ]; then continue; fi
    if [ "$kind" = file ]; then
      cmp -s "$src" "$dst" 2>/dev/null || fail "[$label] $dst не совпадает со старым: старое не трогаю"
    else
      [ -e "$dst/$STAMP" ] || fail "[$label] $dst без метки переноса: сначала перенос и проверка"
    fi
  done
  verify check
  for entry in "${PAIRS[@]}"; do
    IFS='|' read -r label src dst kind <<<"$entry"
    [ -e "$src" ] || continue
    parent="$(dirname "$src")/_to_delete"
    mkdir -p "$parent"
    target="$parent/$(basename "$src")"
    [ -e "$target" ] && target="$target-$TS"
    mv "$src" "$target"
    say "[$label] старое -> $target"
  done
  say "Ничего не удалено. Удалить папки _to_delete можно вручную, когда новое приложение проверено."
}

shade_migrate_main() {
  local mode="${1:-migrate}" entry label src dst kind
  refuse_if_running
  case "$mode" in
    migrate)
      for entry in "${PAIRS[@]}"; do
        IFS='|' read -r label src dst kind <<<"$entry"
        migrate_one "$label" "$src" "$dst" "$kind"
      done
      verify strict ;;
    --check) verify check ;;
    --archive-old) archive_old ;;
    *) fail "неизвестный ключ $mode (есть --check и --archive-old)" ;;
  esac
}
