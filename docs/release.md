# Релиз Shade

Как выпускается открытая бета, чем она подписана и как обновляется. Workflow: `.github/workflows/release.yml`, скрипты: `scripts/release/`, установка: `scripts/install.sh`.

## Коротко

- Тег `v<версия>` (например `v0.5.0-beta.1`) запускает сборку на `macos-15` (только Apple Silicon, arm64).
- Версия тега обязана совпасть с `version` в `frontend/src-tauri/tauri.conf.json` и `frontend/src-tauri/Cargo.toml` (`scripts/release/check-version.sh`), иначе сборка падает.
- В GitHub Release уходят: `Shade_aarch64.dmg`, `Shade_aarch64.app.tar.gz` и `.sig` (для обновлений), `latest.json`, `install.sh`, `SHA256SUMS.txt`. Имена без версии: на них ведут постоянные адреса `releases/latest/download/…`.
- Релиз публикуется обычным, **не pre-release**: `/releases/latest` pre-release не видит, и адрес обновлений вместе с `install.sh` указал бы на прошлую версию.
- `workflow_dispatch` собирает и проверяет то же самое без публикации, файлы лежат в артефакте прогона 14 дней. `signing=secrets` (по умолчанию) подписывает секретами, `signing=throwaway` одноразовыми сертификатом и ключом обновлений, созданными внутри прогона (проверить путь, пока секретов нет).

## Подпись (почему не ad-hoc)

При ad-hoc подписи (`signingIdentity: "-"`) требование, по которому macOS узнаёт приложение (designated requirement), равно хешу сборки (cdhash). После каждого обновления это «другое» приложение, и разрешения на микрофон и системный звук сбрасываются. Поэтому бета подписана одним постоянным самоподписанным сертификатом «Shade Beta Signing» (срок 10 лет). Требование тогда такое:

```
identifier "com.aidbeisembin.shade" and certificate leaf = H"<SHA-1 сертификата>"
```

Оно не зависит от сборки: новая версия с той же подписью остаётся тем же приложением. Проверка в каждом релизе (`scripts/release/check-signature.sh`): подпись не ad-hoc, в требовании нет cdhash, у собранного приложения, у копии с другой версией и у приложения внутри `.dmg` требование одно.

Встроенный импорт сертификата Tauri (`APPLE_CERTIFICATE`) ищет сертификаты Apple, поэтому сертификат импортирует `scripts/release/import-signing-cert.sh` во временную связку ключей, а Tauri получает только имя (`APPLE_SIGNING_IDENTITY`) и подписывает через `codesign`. Доверие к самоподписанному сертификату для подписи не нужно.

**Расширения сертификата.** Только `keyUsage = critical, digitalSignature`, `extendedKeyUsage = critical, codeSigning` и `subjectKeyIdentifier`. Расширения `basicConstraints` быть не должно: с ним `codesign` на macOS 15 (раннер) не находит ключ («The specified item could not be found in the keychain»), и доверие к сертификату не помогает. Проверено на раннере на шести вариантах расширений. `openssl req -x509` без своего конфига сам добавляет `basicConstraints CA:TRUE` из системного `openssl.cnf`, поэтому выпускать только с `-config`. `import-signing-cert.sh` отклоняет самоподписанный сертификат с этим расширением до сборки. Выпуск нового (тогда у всех сбросятся разрешения, раз в 10 лет или при потере):

```bash
cd ~/.shade-signing && umask 077
printf '[req]\ndistinguished_name = dn\nprompt = no\nx509_extensions = ext\n[dn]\nCN = Shade Beta Signing\n[ext]\nkeyUsage = critical, digitalSignature\nextendedKeyUsage = critical, codeSigning\nsubjectKeyIdentifier = hash\n' > cert.cnf
openssl rand -base64 32 | tr -d '\n' > p12-password.txt
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes -keyout key.pem -out cert.pem -config cert.cnf
openssl pkcs12 -export -inkey key.pem -in cert.pem -name "Shade Beta Signing" -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -passout file:p12-password.txt -out shade-beta-signing.p12 && rm key.pem
```

Шифрование `.p12` старое (3DES, SHA-1): новое по умолчанию у OpenSSL 3 `security import` не читает.

Локальная `pnpm tauri build` по-прежнему подписывает ad-hoc (`signingIdentity: "-"` в конфиге) и не требует ключа обновлений: артефакты обновлений включаются только в CI (`--config`).

**Gatekeeper.** Без Developer ID и нотаризации macOS при первом запуске скачанного браузером приложения спрашивает «Всё равно открыть» (README, «Установка», способ 2). `install.sh` качает через `curl`, файлу не ставится карантин, и вопроса нет; поэтому в README и описании релиза он первый. Если кнопки «Всё равно открыть» нет совсем, README даёт запасную команду `xattr -cr /Applications/Shade.app`: она снимает карантин с уже перенесённого приложения (решение владельца 21.11.2026, `docs/case/decisions.md`).

**install.sh сверяет подпись.** После SHA-256 скрипт проверяет приложение из `.dmg`: `codesign --verify --deep --strict` и первая строка `Authority` у `codesign -dvv` равна `SIGNER` (сейчас «Shade Beta Signing»). Иначе «подпись не совпала, ничего не установлено», `/Applications` не тронута. Шаг релиза «install.sh installs this .dmg» ставит собранный `.dmg` этим же скриптом (`curl` по `file://`, настоящие `hdiutil` и `codesign`) и падает, если подпись в секретах другая: так `SIGNER` и `MACOS_SIGNING_IDENTITY` не разойдутся незаметно.

**Окно .dmg.** Фон с шагами по-русски и по-английски: стрелка «Перетащите в Программы», «Первый запуск: Системные настройки → Конфиденциальность и безопасность → Всё равно открыть», мелко `xattr`. Картинка `scripts/release/dmg/background.png` (680x480 pt, 2x, 144 dpi) рисуется `swift scripts/release/dmg/make-background.swift`; меняя текст, перерисовать и закоммитить PNG. Раскладка (размер окна, места значков) передаётся Tauri через `--config` в шаге Build (`bundle.macOS.dmg`), `tauri.conf.json` не меняется. На CI Tauri по умолчанию пропускает оформление окна (AppleScript в Finder, флаг `--skip-jenkins` при `CI=true`), поэтому в шаге задано `TAURI_BUNDLER_DMG_IGNORE_CI=true`. Шаг «dmg window layout» проверяет, что в образе есть фон, `.DS_Store` и ярлык `Applications`; как окно выглядит, смотреть глазами на `.dmg` из артефакта прогона.

**Образ .dmg без подписи.** Tauri подписывает и сам `.dmg`. Такой образ (подписан, не нотаризован) с карантином браузера macOS 27 молча убирает в Корзину: `open` отвечает -128, окна и кнопки «Всё равно открыть» нет, установить Shade нельзя. Проверено 21.11.2026 на `.dmg` из прогона `workflow_dispatch`, скачанном Chrome. Неподписанный образ с тем же приложением монтируется, и дальше путь из README. Поэтому шаг «Unsigned dmg» (`scripts/release/unsign-dmg.sh`, `hdiutil convert`) снимает подпись с образа; `Shade.app` внутри подписан, требование то же (проверка подписи монтирует образ после этого шага). С Developer ID так же: нотаризуется приложение, образ остаётся без подписи.

## Секреты (Settings → Secrets and variables → Actions)

| Секрет | Что это |
|---|---|
| `MACOS_CERTIFICATE` | `.p12` сертификата подписи в base64 |
| `MACOS_CERTIFICATE_PASSWORD` | пароль `.p12` |
| `MACOS_SIGNING_IDENTITY` | имя сертификата: `Shade Beta Signing` |
| `TAURI_SIGNING_PRIVATE_KEY` | приватный ключ обновлений (`pnpm tauri signer generate`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | его пароль |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | только после Developer ID: нотаризация |

Без любого из первых пяти сборка падает на шаге «Signing secrets present» с названием секрета. Ad-hoc подпись молча не подставляется никогда.

Файлы лежат у владельца в `~/.shade-signing/` (папка 700, файлы 600), задать секреты:

```bash
base64 -i ~/.shade-signing/shade-beta-signing.p12 | gh secret set MACOS_CERTIFICATE --repo aidbeisembin/shade
gh secret set MACOS_CERTIFICATE_PASSWORD --repo aidbeisembin/shade < ~/.shade-signing/p12-password.txt
gh secret set MACOS_SIGNING_IDENTITY --repo aidbeisembin/shade --body "Shade Beta Signing"
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo aidbeisembin/shade < ~/.shade-signing/updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo aidbeisembin/shade < ~/.shade-signing/updater-password.txt
```

**Сохранить в менеджер паролей:** `shade-beta-signing.p12`, `p12-password.txt`, `updater.key`, `updater-password.txt`. Потеря `.p12` значит новый сертификат и сброс разрешений у всех пользователей. Потеря ключа обновлений значит, что установленные копии больше не обновятся сами (новый ключ им незнаком), только переустановкой.

Публичный ключ обновлений записан в `tauri.conf.json` (`plugins.updater.pubkey`). Перед публикацией релиз сверяет `.sig` с ним (`scripts/release/verify-updater-signature.sh`, minisign): если ключ в секретах и ключ в конфиге разойдутся, сборка упадёт, а не выпустит обновление, которое у всех молча не встанет.

## Переход на Developer ID

Workflow не меняется, меняются секреты и одна строка в `install.sh`:

1. `MACOS_CERTIFICATE` и `MACOS_CERTIFICATE_PASSWORD`: `.p12` сертификата «Developer ID Application».
2. `MACOS_SIGNING_IDENTITY`: его полное имя, `Developer ID Application: … (TEAMID)`.
3. `APPLE_ID`, `APPLE_PASSWORD` (пароль приложения), `APPLE_TEAM_ID`: шаг «Notarization credentials» передаст их Tauri, и он нотаризует сборку.
4. `SIGNER` в `scripts/install.sh`: то же имя, что в `MACOS_SIGNING_IDENTITY`; заодно строку про подпись в README и `scripts/release/release-notes.sh`. Без этого релиз упадёт на шаге «install.sh installs this .dmg».

Требование подписи сменится на `anchor apple generic and certificate leaf[subject.OU] = TEAMID`: с самоподписанной версии на первую подписанную Developer ID macOS один раз попросит разрешения заново. Дальше они снова переживают обновления.

## Обновления (`frontend/src/shade/lib/updates.ts`)

- Адрес: `https://github.com/aidbeisembin/shade/releases/latest/download/latest.json` (`tauri.conf.json`, `plugins.updater.endpoints`). Запрос делает ядро (плагин `tauri-plugin-updater`), без идентификаторов пользователя: только `User-Agent: tauri-plugin-updater/<версия>` и `Accept`.
- Проверка через 5 с после запуска и раз в сутки, пока Shade открыт. Во время записи не проверяет, не качает и не ставит; отложенная проверка идёт сразу после записи.
- Найдена новая версия: архив качается в фоне, ядро сверяет подпись с `pubkey`. Только потом карточка «Доступна версия X» у дока. «Обновить»: ещё раз спрашивает ядро, не идёт ли запись, ставит поверх `Shade.app` и перезапускает.
- Нет сети, нет `latest.json`, битая подпись: тихо пропускает (строка `[shade] updates:` в журнале), попробует по расписанию.
- Крестик: эта версия не показывается до следующего запуска. «Проверить обновления» в меню трея отвечает тостом и тогда, когда обновления нет.
- Карантин: по коду плагина (`tauri-plugin-updater` 2.10.1, `install_inner` для macOS) архив скачивается в память через `reqwest`, распаковывается в Rust (`tar`, без расширенных атрибутов) во временную папку и переносится на место `Shade.app`. Атрибут `com.apple.quarantine` macOS ставит файлам, только если их пишет приложение с `LSFileQuarantineEnabled` (у Shade его нет) или их скачал браузер; поэтому после обновления карантина быть не должно и Gatekeeper второй раз не спросит. На живом обновлении не проверено: тестовая сборка Shade пишет в ту же папку данных `~/Library/Application Support/Shade`, что и сборка владельца. Проверка руками: `xattr -l /Applications/Shade.app` после обновления (пункт «Проверки владельца» в PR).
- Если `Shade.app` лежит там, куда нет прав записи, плагин просит пароль администратора (AppleScript). Если Shade запущен из `.dmg` или из «Загрузок» без переноса (App Translocation), обновление не встанет: поэтому инструкция требует перенести Shade в «Программы».

## Выпуск

1. Поднять версию в `tauri.conf.json`, `frontend/src-tauri/Cargo.toml` (и `Cargo.lock`, `frontend/package.json`), слить в `shade`.
2. `git tag v<версия> && git push origin v<версия>`.
3. Через 40-60 минут релиз на странице Releases. Проверить: `latest.json` открывается по постоянному адресу, `install.sh` ставит.

## Проверки

- `bash scripts/release/test-release.sh`: версия и тег, секреты, `latest.json`, подпись обновления (minisign), описание релиза и README (сначала Терминал, потом `.dmg`, запасная команда `xattr`).
- `bash scripts/release/test-check-signature.sh` (macOS): требование без cdhash, одинаковое у двух версий; ad-hoc, без подписи и чужой сертификат отклоняются; `unsign-dmg.sh` снимает подпись с образа, приложение внутри то же; `import-signing-cert.sh` принимает годный `.p12` и отклоняет сертификат с `basicConstraints`, неверный пароль, не то имя; `install.sh` с настоящими `codesign` и `hdiutil` ставит приложение своего сертификата и не ставит чужое, ad-hoc, неподписанное и изменённое после подписи.
- `bash scripts/test-install.sh`: `install.sh` на подставных командах, в том числе подписи нет, чужая, ad-hoc, повреждена.
- `pnpm test`: `lib/updates.test.ts`, `components/update-card.test.tsx`, `lib/beta-chat.test.ts`.
- Все четыре в CI `shade-check` (задача `release` на macOS и `frontend`).
