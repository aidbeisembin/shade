#!/usr/bin/env bash
# Перенос данных Shade на новый identifier (17.11.2026). macOS.
#   io.github.katanana23.shade -> com.aidbeisembin.shade
#
#   scripts/migrate-identifier.sh               перенести и проверить
#   scripts/migrate-identifier.sh --check       только проверить перенесённое
#   scripts/migrate-identifier.sh --archive-old старые папки -> _to_delete рядом с ними
#
# Что переносится (всё, что macOS и Tauri кладут по identifier):
#   ~/Library/Application Support/<id>      база meeting_minutes.sqlite (+ -wal, -shm), модели,
#                                           настройки plugin-store, onboarding-status.json
#   ~/Library/WebKit/<id>                   хранилище окна: localStorage (тема, язык, корзина),
#                                           IndexedDB
#   ~/Library/Caches/<id>                   кеш WebView
#   ~/Library/Logs/<id>, HTTPStorages/<id>, Saved Application State/<id>.savedState,
#   Preferences/<id>.plist                  если есть (у Shade обычно нет)
#
# Не переносится, потому что от identifier не зависит: ~/Movies/Shade (записи и «Корзина Shade»,
# RECORDINGS_DIR_NAME) и ~/Library/Application Support/Shade (свои шаблоны и notifications.json,
# APP_DATA_DIR_NAME). Пути в базе (meetings.folder_path) и в метках корзины (trashed.json) ведут
# в ~/Movies/Shade, старого identifier в них нет, поэтому содержимое не правится: копия байт в
# байт. Проверка в конце подтверждает, что старый identifier в данных не встречается.
#
# Разрешения macOS (микрофон, звук системы) привязаны к bundle id и не переносятся: новое
# приложение спросит их заново.
#
# Как переносится и что при сбое: scripts/migrate-lib.sh (клон, сверка, метка, отказ при
# запущенном Shade, старое не удаляется). Порядок переходов: сначала migrate-from-aid.sh
# (если остались данные Aid Meetings), потом этот. Тест: scripts/test-migrate-identifier.sh.

set -euo pipefail

. "$(cd "$(dirname "$0")" && pwd)/migrate-lib.sh"

OLD_ID="io.github.katanana23.shade"
NEW_ID="com.aidbeisembin.shade"
export OLD_ID NEW_ID STAMP

# метка|старое|новое|вид
PAIRS=(
  "data|$AS/$OLD_ID|$AS/$NEW_ID|plain"
  "webkit|$L/WebKit/$OLD_ID|$L/WebKit/$NEW_ID|plain"
  "caches|$L/Caches/$OLD_ID|$L/Caches/$NEW_ID|plain"
  "logs|$L/Logs/$OLD_ID|$L/Logs/$NEW_ID|plain"
  "http|$L/HTTPStorages/$OLD_ID|$L/HTTPStorages/$NEW_ID|plain"
  "state|$L/Saved Application State/$OLD_ID.savedState|$L/Saved Application State/$NEW_ID.savedState|plain"
  "prefs|$L/Preferences/$OLD_ID.plist|$L/Preferences/$NEW_ID.plist|file"
)

fix_copy() { :; } # старого identifier внутри данных нет: копия не правится

old_place() { # где лежит старое: на месте или уже в _to_delete после --archive-old
  if [ -e "$1/$2" ]; then printf '%s' "$1/$2"; else printf '%s' "$1/_to_delete/$2"; fi
}

verify() { # strict | check
  say ""
  say "Проверка"
  py "$1" "$AS/$NEW_ID" "$(old_place "$AS" "$OLD_ID")" "$L/WebKit/$NEW_ID" "$(old_place "$L/WebKit" "$OLD_ID")" \
    "$HOME/Movies/Shade" "$AS/Shade" <<'PY'
import os, shutil, sqlite3, sys, tempfile
mode, new_dir, old_dir, new_wk, old_wk, movies, own_dir = sys.argv[1:]
OLD_ID, STAMP = os.environ['OLD_ID'], os.environ['STAMP']
strict = mode == 'strict'
problems, notes = [], []
tmp = tempfile.mkdtemp(prefix='shade-verify-')

def snapshot(path):
    """База открывается только из временной копии (вместе с -wal и -shm): так чтение не
    меняет ни старые, ни новые файлы, а несброшенный журнал WAL учитывается."""
    d = tempfile.mkdtemp(dir=tmp)
    for suffix in ('', '-wal', '-shm'):
        if os.path.isfile(path + suffix):
            shutil.copy2(path + suffix, os.path.join(d, os.path.basename(path) + suffix))
    return sqlite3.connect(os.path.join(d, os.path.basename(path)))

def stores(root):
    out = {}
    for r, _, files in os.walk(root):
        if 'localstorage.sqlite3' in files:
            out[os.path.relpath(r, root)] = os.path.join(r, 'localstorage.sqlite3')
    return out

def ls_items(path):
    c = snapshot(path)
    rows = {k: bytes(v).decode('utf-16-le', 'replace') if isinstance(v, (bytes, memoryview)) else str(v)
            for k, v in c.execute('SELECT key, value FROM ItemTable')}
    c.close()
    return rows

def compare(what, new, old):
    if old is None:
        return
    if new != old and (strict or new < old):
        problems.append(f'{what}: в новом {new}, в старом {old}')
    elif new != old:
        notes.append(f'{what}: в новом {new}, в старом {old} (новое уже использовали после переноса)')

if os.path.isdir(new_dir):
    if not os.path.isfile(os.path.join(new_dir, STAMP)) and os.path.isdir(old_dir):
        problems.append(f'{new_dir} без метки переноса')
    db = os.path.join(new_dir, 'meeting_minutes.sqlite')
    if os.path.isfile(db):
        c = snapshot(db)
        if c.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            problems.append('база повреждена')
        n = c.execute('SELECT count(*) FROM meetings').fetchone()[0]
        found = sum(1 for (fp,) in c.execute('SELECT folder_path FROM meetings') if fp and os.path.isdir(fp))
        hits = []
        for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
            for col in [r[1] for r in c.execute(f'PRAGMA table_info("{t}")').fetchall()]:
                k = c.execute(f'SELECT count(*) FROM "{t}" WHERE instr(CAST("{col}" AS TEXT), ?) > 0', (OLD_ID,)).fetchone()[0]
                if k:
                    hits.append(f'{t}.{col}: {k}')
        c.close()
        line = f'  встреч {n}, папки записей на месте у {found}'
        odb = os.path.join(old_dir, 'meeting_minutes.sqlite')
        o = None
        if os.path.isfile(odb):
            oc = snapshot(odb)
            o = oc.execute('SELECT count(*) FROM meetings').fetchone()[0]
            oc.close()
            line += f' (в старой базе встреч {o})'
        print(line)
        compare('встреч', n, o)
        if hits:
            problems.append('старый identifier в базе: ' + ', '.join(hits))
    else:
        print('  базы нет (старых данных не было или приложение ещё не запускалось)')
    models = os.path.join(new_dir, 'models')
    if os.path.isdir(models):
        size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(models) for f in fs)
        print(f'  модели: {size / 1e9:.2f} ГБ')
    for name in sorted(os.listdir(new_dir)):
        p = os.path.join(new_dir, name)
        if name.endswith('.json') and os.path.isfile(p) and OLD_ID in open(p, encoding='utf-8', errors='replace').read():
            problems.append(f'старый identifier в {name}')
else:
    print('  папки данных нет (старых данных не было)')

old_stores = stores(old_wk) if os.path.isdir(old_wk) else {}
for rel, path in sorted(stores(new_wk).items()) if os.path.isdir(new_wk) else []:
    items = ls_items(path)
    mine = sorted(k for k in items if k.startswith('shade.'))
    theme, lang = items.get('shade.theme', '-'), items.get('shade.lang', '-')
    print(f'  localStorage {rel.split(os.sep)[-2][:8] if os.sep in rel else rel}…: тема {theme}, язык {lang}, ключей shade.* {len(mine)}')
    if any(OLD_ID in v for v in items.values()):
        problems.append('старый identifier в localStorage')
    if rel in old_stores:
        old = ls_items(old_stores[rel])
        missing = sorted(set(old) - set(items))
        if missing and strict:
            problems.append(f'в localStorage нет ключей старого: {missing}')
        elif missing:
            notes.append(f'в localStorage нет ключей старого: {missing}')
missing_stores = sorted(set(old_stores) - set(stores(new_wk) if os.path.isdir(new_wk) else {}))
if missing_stores:
    problems.append(f'хранилища окна не перенесены: {missing_stores}')

print(f'  {movies} и {own_dir}: от identifier не зависят, не тронуты')
shutil.rmtree(tmp, ignore_errors=True)
for n in notes:
    print('  внимание: ' + n)
if problems:
    print('НЕ ПРОШЛО: ' + '; '.join(problems))
    sys.exit(1)
print('  всё сходится')
PY
}

shade_migrate_main "$@"
