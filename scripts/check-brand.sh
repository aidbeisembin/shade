#!/usr/bin/env bash
# Страж имён: Shade называется своим именем. Ищет имя исходного проекта и его автора
# (WORDS ниже) без учёта регистра в путях и в тексте файлов репозитория: отслеживаемых и
# новых, ещё не добавленных (кроме игнорируемых .gitignore). Двоичные файлы проверяются
# только по имени.
#
# Запуск из любой папки репозитория: bash scripts/check-brand.sh. Код выхода 1 и список
# «файл:строка: текст», если найдено вне исключений. Тест: bash scripts/test-check-brand.sh.
#
# Исключения (каждое с причиной; добавлять новое только с записью в docs/case/decisions.md,
# CLAUDE.md, «Принцип работы»):
#   - файлы целиком (EXCLUDE_FILES, EXCLUDE_DIRS);
#   - docs/FORK.md только ниже заголовка «## История» (HISTORY_FILES);
#   - строки-данные (ALLOWED_LITERALS): ключи и пути хранилищ, которые нельзя переименовать
#     без переноса данных, и один внешний адрес, который может сменить только владелец (домен
#     проекта Vercel). Сервер модели, аналитика и ffmpeg исходного проекта сюда не вернутся:
#     Shade от них не зависит (docs/case/decisions.md, 2026-11-17). Литерал вырезается из
#     строки, остаток проверяется: второе упоминание в той же строке не пройдёт.

set -euo pipefail

WORDS='meetily|zackriya'

EXCLUDE_FILES=(
  "THIRD_PARTY_NOTICES.md"          # лицензия MIT исходного проекта с копирайтом: обязана быть
  "scripts/check-brand.sh"          # сам страж
  "scripts/test-check-brand.sh"     # его тест
  "scripts/migrate-from-aid.sh"     # перенос со старых путей: старые пути это данные
  "scripts/test-migrate-from-aid.sh"
)
EXCLUDE_DIRS=(
  "docs/case/pr/"                   # архив описаний PR, не переписывается
)
HISTORY_FILES=(
  "docs/FORK.md"                    # история проекта: имена допустимы в разделе «## История»
)
ALLOWED_LITERALS=(
  "meetily-tau.vercel.app"                        # запасной адрес отзывов (прямой домен проекта Vercel); уйдёт, когда владелец сменит домен проекта
  '.join("Meetily")'                              # запасной путь моделей в ядре: путь данных
  "MeetilyRecoveryDB"                             # имя базы IndexedDB восстановления записи: ключ хранилища
  "meetily.meetingDetails.transcriptPaneRatio"    # ключ localStorage исходного интерфейса
  "/var/meetily/meeting_minutes.db"               # путь базы старой установки для импорта: данные
)

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

is_excluded() {
  local path="$1" f d
  for f in "${EXCLUDE_FILES[@]}"; do [[ "$path" == "$f" ]] && return 0; done
  for d in "${EXCLUDE_DIRS[@]}"; do [[ "$path" == "$d"* ]] && return 0; done
  return 1
}

history_start() {
  # Номер строки заголовка «## История» или 0, если файл не из HISTORY_FILES или заголовка нет
  local path="$1" f n
  for f in "${HISTORY_FILES[@]}"; do
    if [[ "$path" == "$f" ]]; then
      n="$(grep -n '^## История' "$path" 2>/dev/null | head -1 | cut -d: -f1 || true)"
      echo "${n:-0}"
      return
    fi
  done
  echo 0
}

strip_allowed() {
  local text="$1" lit
  for lit in "${ALLOWED_LITERALS[@]}"; do text="${text//"$lit"/}"; done
  printf '%s' "$text"
}

violations=()

# 1. Пути файлов
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  is_excluded "$path" && continue
  [[ -e "$path" ]] || continue
  violations+=("$path: имя файла")
done < <(git -c core.quotePath=false ls-files --cached --others --exclude-standard | grep -i -E "$WORDS" || true)

# 2. Текст файлов
while IFS= read -r hit; do
  [[ -z "$hit" ]] && continue
  path="${hit%%:*}"
  rest="${hit#*:}"
  line="${rest%%:*}"
  text="${rest#*:}"
  is_excluded "$path" && continue
  start="$(history_start "$path")"
  if [[ "$start" -gt 0 && "$line" -gt "$start" ]]; then continue; fi
  if printf '%s' "$(strip_allowed "$text")" | grep -q -i -E "$WORDS"; then
    trimmed="$(printf '%s' "$text" | sed -e 's/^[[:space:]]*//' | cut -c1-160)"
    violations+=("$path:$line: $trimmed")
  fi
done < <(git -c core.quotePath=false grep --untracked -I -n -i -E "$WORDS" -- . || true)

if ((${#violations[@]})); then
  echo "check-brand: найдено ${#violations[@]} вне исключений:"
  printf '  %s\n' "${violations[@]}"
  echo "Переименуйте в Shade или уберите. Если это данные или внешний адрес, добавьте исключение с причиной в scripts/check-brand.sh и запись в docs/case/decisions.md."
  exit 1
fi
echo "check-brand ok: чужих имён вне исключений нет (файлов-исключений ${#EXCLUDE_FILES[@]}, папок ${#EXCLUDE_DIRS[@]}, строк-данных ${#ALLOWED_LITERALS[@]})"
