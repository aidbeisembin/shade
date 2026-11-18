#!/usr/bin/env bash
# Тест scripts/check-brand.sh на временном репозитории с вымышленными файлами.
# Случаи из таблицы PR: чисто, имя в коде, имя в пути, строка-данные, данные плюс второе
# упоминание в строке, файл-исключение, архив PR, FORK.md до и после «## История»,
# новый неотслеживаемый файл, игнорируемый файл, двоичный файл, разный регистр; прежний ник
# владельца: ссылка, прежние identifier как данные, данные плюс ссылка, docs/case, «## История»,
# скрипт переноса, регистр, имя файла.
# Запуск: bash scripts/test-check-brand.sh (macOS и Linux; нужен git).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/check-brand.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Слова собираются из частей, чтобы тест сам не нёс имя целиком (он и так в исключениях)
A="Meet""ily"
B="Zack""riya"

pass=0
fail=0

new_repo() {
  rm -rf "$WORK/r"
  mkdir -p "$WORK/r/scripts" "$WORK/r/docs/case/pr" "$WORK/r/src"
  cp "$GUARD" "$WORK/r/scripts/check-brand.sh"
  git -C "$WORK/r" init -q
  git -C "$WORK/r" config user.email t@example.com
  git -C "$WORK/r" config user.name t
  printf 'Shade\n' > "$WORK/r/README.md"
  printf 'ignored/\n' > "$WORK/r/.gitignore"
  git -C "$WORK/r" add -A
  git -C "$WORK/r" commit -q -m init
}

# expect <название> <ожидаемый код> [фрагмент вывода]
expect() {
  local name="$1" want="$2" needle="${3:-}" out code
  set +e
  out="$(cd "$WORK/r" && bash scripts/check-brand.sh 2>&1)"
  code=$?
  set -e
  if [[ "$code" == "$want" && ( -z "$needle" || "$out" == *"$needle"* ) ]]; then
    pass=$((pass + 1)); echo "ok   $name"
  else
    fail=$((fail + 1)); echo "FAIL $name (код $code, ждали $want)"; echo "$out" | sed 's/^/     /'
  fi
}

commit() { git -C "$WORK/r" add -A && git -C "$WORK/r" commit -q -m step; }

new_repo
expect "чистый репозиторий" 0 "check-brand ok"

new_repo
printf 'const t = "Welcome to %s";\n' "$A" > "$WORK/r/src/a.ts"; commit
expect "имя в коде" 1 "src/a.ts:1:"

new_repo
printf 'x\n' > "$WORK/r/src/$(echo "$A" | tr 'A-Z' 'a-z')-logo.txt"; commit
expect "имя в пути файла" 1 "имя файла"

new_repo
printf "const DB_NAME = '%sRecoveryDB';\n" "$A" > "$WORK/r/src/db.ts"; commit
expect "строка-данные (ключ IndexedDB)" 0

new_repo
printf "const DB_NAME = '%sRecoveryDB'; // from %s\n" "$A" "$A" > "$WORK/r/src/db.ts"; commit
expect "данные плюс второе упоминание в строке" 1 "src/db.ts:1:"

new_repo
printf 'Copyright (c) 2024 %s Solutions\n' "$B" > "$WORK/r/THIRD_PARTY_NOTICES.md"; commit
expect "файл-исключение THIRD_PARTY_NOTICES.md" 0

new_repo
printf 'PR про %s\n' "$A" > "$WORK/r/docs/case/pr/001-x.md"; commit
expect "архив PR docs/case/pr" 0

new_repo
printf '# Fork\n\n%s сверху\n\n## История\n\n%s внизу\n' "$A" "$A" > "$WORK/r/docs/FORK.md"; commit
expect "FORK.md: имя до «## История»" 1 "docs/FORK.md:3:"

new_repo
printf '# Fork\n\nсверху\n\n## История\n\n%s внизу\n' "$A" > "$WORK/r/docs/FORK.md"; commit
expect "FORK.md: имя только в «## История»" 0

new_repo
printf '%s\n' "$B" > "$WORK/r/src/new.md"
expect "новый файл, ещё не в git" 1 "src/new.md:1:"

new_repo
mkdir -p "$WORK/r/ignored"; printf '%s\n' "$A" > "$WORK/r/ignored/x.txt"
expect "игнорируемый файл не проверяется" 0

new_repo
printf '\0\1%s\0' "$A" > "$WORK/r/src/blob.bin"; commit
expect "двоичный файл: только имя" 0

new_repo
printf 'user-agent: %s/1\n' "$(echo "$A" | tr 'a-z' 'A-Z')" > "$WORK/r/src/ua.rs"; commit
expect "регистр не важен" 1 "src/ua.rs:1:"

# --- Правило 2: прежний ник владельца на GitHub -----------------------------------------
N="kata""nana23"

new_repo
printf 'export const GITHUB_URL = "https://github.com/%s/shade";\n' "$N" > "$WORK/r/src/store.ts"; commit
expect "ник: ссылка GitHub в коде" 1 "src/store.ts:1:"

new_repo
printf '| identifier | com.aidbeisembin.shade | io.github.%s.shade | io.github.%s.aid-meetings |\n' "$N" "$N" > "$WORK/r/docs/FORK.md"; commit
expect "ник: прежние identifier как строки-данные" 0

new_repo
printf 'Папка io.github.%s.shade, репозиторий github.com/%s/shade\n' "$N" "$N" > "$WORK/r/README.md"; commit
expect "ник: данные плюс ссылка в той же строке" 1 "README.md:1:"

new_repo
printf 'Автор: %s\n' "$N" > "$WORK/r/docs/case/decisions.md"; commit
expect "ник: docs/case не проверяется" 0

new_repo
printf '# Fork\n\nсверху\n\n## История\n\nрепозиторий %s/shade\n' "$N" > "$WORK/r/docs/FORK.md"; commit
expect "ник: FORK.md в «## История»" 0

new_repo
printf 'OLD="%s"\n' "$N" > "$WORK/r/scripts/migrate-x.sh"; commit
expect "ник: скрипт переноса" 0

new_repo
printf 'user %s\n' "$(echo "$N" | tr 'a-z' 'A-Z')" > "$WORK/r/src/x.md"; commit
expect "ник: регистр не важен" 1 "src/x.md:1:"

new_repo
printf 'x\n' > "$WORK/r/src/$N.txt"; commit
expect "ник: в имени файла" 1 "имя файла"

echo "check-brand tests: $pass ok, $fail fail"
[[ "$fail" == 0 ]]
