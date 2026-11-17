#!/usr/bin/env bash
# Страж имён: Shade называется своим именем. Два правила, каждое со своими исключениями:
#   1. имя исходного проекта и его автора (WORDS);
#   2. прежний ник владельца на GitHub (OLD_NICK_WORDS): с 17.11.2026 ник aidbeisembin, старый
#      может занять кто угодно, поэтому ссылок на него быть не должно.
# Поиск без учёта регистра в путях и в тексте файлов репозитория: отслеживаемых и новых, ещё
# не добавленных (кроме игнорируемых .gitignore). Двоичные файлы проверяются только по имени.
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

# --- Правило 1: имя исходного проекта ---------------------------------------------------
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

# --- Правило 2: прежний ник владельца ---------------------------------------------------
OLD_NICK_WORDS='katanana23'
OLD_NICK_EXCLUDE_FILES=(
  "scripts/check-brand.sh"          # сам страж
  "scripts/test-check-brand.sh"     # его тест
)
OLD_NICK_EXCLUDE_PREFIXES=(
  "docs/case/"                      # кейс: архив PR, журнал решений; история не переписывается
  "scripts/migrate-"                # скрипты переноса: старые пути это данные
  "scripts/test-migrate-"
)
OLD_NICK_ALLOWED_LITERALS=(
  "io.github.katanana23.shade"          # прежний identifier (до 17.11.2026): имя папок данных в таблице имён и указаниях к переносу
  "io.github.katanana23.aid-meetings"   # identifier до 14.11.2026: то же
)
# Ссылки github.com/<прежний ник> и сам ник отдельно не проходят нигде, кроме исключений выше
# и раздела «## История» в docs/FORK.md. Решение: docs/case/decisions.md, 2026-11-17.

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

is_excluded() { # правило путь
  local rule="$1" path="$2" f d
  if [[ "$rule" == brand ]]; then
    for f in "${EXCLUDE_FILES[@]}"; do [[ "$path" == "$f" ]] && return 0; done
    for d in "${EXCLUDE_DIRS[@]}"; do [[ "$path" == "$d"* ]] && return 0; done
  else
    for f in "${OLD_NICK_EXCLUDE_FILES[@]}"; do [[ "$path" == "$f" ]] && return 0; done
    for d in "${OLD_NICK_EXCLUDE_PREFIXES[@]}"; do [[ "$path" == "$d"* ]] && return 0; done
  fi
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

strip_allowed() { # правило текст
  local rule="$1" text="$2" lit
  if [[ "$rule" == brand ]]; then
    for lit in "${ALLOWED_LITERALS[@]}"; do text="${text//"$lit"/}"; done
  else
    for lit in "${OLD_NICK_ALLOWED_LITERALS[@]}"; do text="${text//"$lit"/}"; done
  fi
  printf '%s' "$text"
}

violations=()

scan() { # правило слова
  local rule="$1" words="$2" path hit rest line text start trimmed
  # 1. Пути файлов
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    is_excluded "$rule" "$path" && continue
    [[ -e "$path" ]] || continue
    violations+=("$path: имя файла")
  done < <(git -c core.quotePath=false ls-files --cached --others --exclude-standard | grep -i -E "$words" || true)

  # 2. Текст файлов
  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    path="${hit%%:*}"
    rest="${hit#*:}"
    line="${rest%%:*}"
    text="${rest#*:}"
    is_excluded "$rule" "$path" && continue
    start="$(history_start "$path")"
    if [[ "$start" -gt 0 && "$line" -gt "$start" ]]; then continue; fi
    if printf '%s' "$(strip_allowed "$rule" "$text")" | grep -q -i -E "$words"; then
      trimmed="$(printf '%s' "$text" | sed -e 's/^[[:space:]]*//' | cut -c1-160)"
      violations+=("$path:$line: $trimmed")
    fi
  done < <(git -c core.quotePath=false grep --untracked -I -n -i -E "$words" -- . || true)
}

scan brand "$WORDS"
scan old-nick "$OLD_NICK_WORDS"

if ((${#violations[@]})); then
  echo "check-brand: найдено ${#violations[@]} вне исключений:"
  printf '  %s\n' "${violations[@]}"
  echo "Переименуйте в Shade (ссылки GitHub: aidbeisembin) или уберите. Если это данные или внешний адрес, добавьте исключение с причиной в scripts/check-brand.sh и запись в docs/case/decisions.md."
  exit 1
fi
echo "check-brand ok: чужих имён вне исключений нет (файлов-исключений ${#EXCLUDE_FILES[@]}, папок ${#EXCLUDE_DIRS[@]}, строк-данных ${#ALLOWED_LITERALS[@]}); прежнего ника нет (исключений ${#OLD_NICK_EXCLUDE_FILES[@]}+${#OLD_NICK_EXCLUDE_PREFIXES[@]}, строк-данных ${#OLD_NICK_ALLOWED_LITERALS[@]})"
