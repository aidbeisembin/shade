//! Название встречи по сути разговора (Shade): тонкий слой ядра под интерфейс.
//!
//! Промпт и чистка ответа живут в интерфейсе (`frontend/src/shade/lib/meeting-title.ts`, с
//! тестами в CI). Здесь только то, чего интерфейс сделать не может:
//! 1. `api_generate_title_text`: один короткий запрос к той же модели и провайдеру, что
//!    настроены для итогов (ключи и сервер знает только ядро). Облачному провайдеру текст
//!    уходит только если вызывающий явно разрешил (`allow_cloud`); без разрешения отказ
//!    `cloud-not-allowed` до всякой сети. Это вторая страховка после проверки в интерфейсе.
//! 2. Пометка «название задал человек» в файле `title.json` папки встречи (рядом с
//!    `recovered.json`, схема базы не меняется) и запись названия автоматикой с проверкой:
//!    не трогать, если человек переименовал встречу (пометка `manual`) или название уже не то,
//!    что автоматика видела, когда начинала (сравнение «ожидаемое → новое»).

use crate::crash_recovery::fsio::write_atomic;
use crate::database::repositories::{meeting::MeetingsRepository, setting::SettingsRepository};
use crate::state::AppState;
use crate::summary::llm_client::{generate_summary, LLMProvider};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};
use tokio_util::sync::CancellationToken;

/// Имя файла пометки в папке встречи.
pub const TITLE_FILE: &str = "title.json";
/// Дольше этого модель не ждём: название не повод держать сеть и процессор.
const GENERATE_TIMEOUT: Duration = Duration::from_secs(90);
/// Самое длинное название, которое автоматика запишет (знаков). Интерфейс режет до 6 слов раньше.
const MAX_TITLE_CHARS: usize = 120;

/// Кто задал название. Нет файла: не знаем, считаем «ничьё» (название по умолчанию или из итогов старой версии).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TitleOrigin {
    Manual,
    Auto,
}

#[derive(Debug, Serialize, Deserialize)]
struct TitleMark {
    origin: TitleOrigin,
    at: String,
}

pub fn read_origin(folder: &Path) -> Option<TitleOrigin> {
    let raw = std::fs::read(folder.join(TITLE_FILE)).ok()?;
    serde_json::from_slice::<TitleMark>(&raw).ok().map(|m| m.origin)
}

pub fn write_origin(folder: &Path, origin: TitleOrigin) -> Result<(), String> {
    let mark = TitleMark { origin, at: chrono::Utc::now().to_rfc3339() };
    let json = serde_json::to_vec_pretty(&mark).map_err(|e| e.to_string())?;
    write_atomic(&folder.join(TITLE_FILE), &json).map_err(|e| format!("title.json: {e}"))
}

/// Адрес сервера на этом компьютере: localhost, 127.0.0.1, ::1. Остальное считается удалённым.
pub fn endpoint_is_local(endpoint: &str) -> bool {
    let rest = endpoint.trim();
    let rest = rest.split_once("://").map_or(rest, |(_, r)| r);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host_port = authority.rsplit('@').next().unwrap_or("");
    let host = if let Some(inner) = host_port.strip_prefix('[') {
        inner.split(']').next().unwrap_or("")
    } else {
        host_port.split(':').next().unwrap_or("")
    };
    matches!(host.to_ascii_lowercase().as_str(), "localhost" | "127.0.0.1" | "::1")
}

/// Модель работает на этом компьютере: встроенная или Ollama на локальном адресе. Как `privacy.ts`
/// в интерфейсе: свой сервер OpenAI-совместимого API считается неизвестным, то есть не локальным.
pub fn provider_is_local(provider: &LLMProvider, ollama_endpoint: Option<&str>) -> bool {
    match provider {
        LLMProvider::BuiltInAI => true,
        LLMProvider::Ollama => ollama_endpoint.map_or(true, |e| e.trim().is_empty() || endpoint_is_local(e)),
        _ => false,
    }
}

/// Что вышло из попытки записать название автоматикой.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetOutcome {
    /// Записано.
    Set,
    /// Название задал человек: не тронуто.
    Manual,
    /// Название уже другое, чем автоматика видела в начале: не тронуто.
    Changed,
    /// Встречи нет.
    Missing,
    /// Название для записи негодно (пустое, с переводом строки, слишком длинное): не тронуто.
    Rejected,
}

impl SetOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            SetOutcome::Set => "set",
            SetOutcome::Manual => "manual",
            SetOutcome::Changed => "changed",
            SetOutcome::Missing => "missing",
            SetOutcome::Rejected => "rejected",
        }
    }
}

/// Решение без ввода-вывода (все ветки под тестом): можно ли автоматике писать название.
/// `override_manual` только по нажатию «Придумать заново»: человек сам попросил.
pub fn decide_set(
    current: Option<&str>,
    origin: Option<TitleOrigin>,
    expected: &str,
    new_title: &str,
    override_manual: bool,
) -> SetOutcome {
    let Some(current) = current else { return SetOutcome::Missing };
    let new_title = new_title.trim();
    if new_title.is_empty() || new_title.contains(['\n', '\r']) || new_title.chars().count() > MAX_TITLE_CHARS {
        return SetOutcome::Rejected;
    }
    if origin == Some(TitleOrigin::Manual) && !override_manual {
        return SetOutcome::Manual;
    }
    if current != expected {
        return SetOutcome::Changed;
    }
    SetOutcome::Set
}

/// Записи названий идут по одной: пометка и база не расходятся, когда человек переименовывает
/// как раз в момент записи автоматикой.
static TITLE_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

async fn folder_of(pool: &sqlx::SqlitePool, meeting_id: &str) -> Result<(Option<String>, Option<PathBuf>), String> {
    let meeting = MeetingsRepository::get_meeting_metadata(pool, meeting_id)
        .await
        .map_err(|e| format!("Failed to load meeting: {e}"))?;
    Ok(match meeting {
        None => (None, None),
        Some(m) => {
            let folder = m.folder_path.filter(|p| !p.trim().is_empty()).map(PathBuf::from);
            (Some(m.title), folder)
        }
    })
}

/// Кто задал название встречи: `manual`, `auto` или `null`, если пометки нет.
#[tauri::command]
pub async fn api_get_title_origin(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<TitleOrigin>, String> {
    let (_, folder) = folder_of(state.db_manager.pool(), &meeting_id).await?;
    Ok(folder.and_then(|f| read_origin(&f)))
}

/// Человек переименовал встречу: пометка `manual`, после неё автоматика встречу не трогает
/// (кроме «Придумать заново» по нажатию). Вызывается до записи названия. Встреча без папки
/// записи пометку получить не может: для неё работает сравнение «ожидаемое → новое».
#[tauri::command]
pub async fn api_mark_title_manual(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<bool, String> {
    let _guard = TITLE_LOCK.lock().await;
    let (_, folder) = folder_of(state.db_manager.pool(), &meeting_id).await?;
    match folder {
        Some(folder) => write_origin(&folder, TitleOrigin::Manual).map(|_| true),
        None => Ok(false),
    }
}

/// Автоматика записывает придуманное название. Возвращает `set`, `manual`, `changed`,
/// `missing` или `rejected` (см. `SetOutcome`); в базе меняется то же поле `title`
/// (и `meeting_name` у кусков текста, как делает ядро итогов).
#[tauri::command]
pub async fn api_set_auto_title(
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    expected_title: String,
    new_title: String,
    override_manual: Option<bool>,
) -> Result<String, String> {
    let _guard = TITLE_LOCK.lock().await;
    let pool = state.db_manager.pool();
    let (current, folder) = folder_of(pool, &meeting_id).await?;
    let origin = folder.as_deref().and_then(read_origin);
    let outcome = decide_set(current.as_deref(), origin, &expected_title, &new_title, override_manual.unwrap_or(false));
    if outcome != SetOutcome::Set {
        info!("[shade] Название встречи {meeting_id}: не записано ({})", outcome.as_str());
        return Ok(outcome.as_str().to_string());
    }
    let title = new_title.trim();
    // Сначала база, потом пометка: если пометка не записалась, название всё равно на месте,
    // а пометка «auto» нужна только для различия в интерфейсе и по умолчанию отсутствует.
    MeetingsRepository::update_meeting_name(pool, &meeting_id, title)
        .await
        .map_err(|e| format!("Failed to update meeting title: {e}"))?;
    if let Some(folder) = folder {
        if let Err(e) = write_origin(&folder, TitleOrigin::Auto) {
            warn!("[shade] Название встречи {meeting_id}: пометка auto не записана: {e}");
        }
    }
    info!("[shade] Название встречи {meeting_id}: записано автоматически");
    Ok(SetOutcome::Set.as_str().to_string())
}

/// Один короткий запрос к модели итогов. Тексты запроса собирает интерфейс (`meeting-title.ts`).
/// Ошибки короткие и машинные: `model-not-configured`, `cloud-not-allowed`, `timeout`, остальное
/// текст ошибки провайдера. Ничего не пишет в базу.
#[tauri::command]
pub async fn api_generate_title_text<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    system_prompt: String,
    user_prompt: String,
    allow_cloud: bool,
) -> Result<String, String> {
    let pool = state.db_manager.pool();
    let config = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to read model config: {e}"))?
        .filter(|c| !c.provider.trim().is_empty() && !c.model.trim().is_empty())
        .ok_or_else(|| "model-not-configured".to_string())?;
    let provider = LLMProvider::from_str(&config.provider)?;
    let ollama_endpoint = if provider == LLMProvider::Ollama { config.ollama_endpoint.clone() } else { None };

    // Приватность: облако (и свой сервер, про который нельзя сказать «локальный») только с явным разрешением
    if !provider_is_local(&provider, ollama_endpoint.as_deref()) && !allow_cloud {
        return Err("cloud-not-allowed".to_string());
    }

    let (api_key, custom) = match provider {
        LLMProvider::Ollama | LLMProvider::BuiltInAI => (String::new(), None),
        LLMProvider::CustomOpenAI => {
            let cfg = SettingsRepository::get_custom_openai_config(pool)
                .await
                .map_err(|e| format!("Failed to read custom OpenAI config: {e}"))?
                .ok_or_else(|| "model-not-configured".to_string())?;
            (cfg.api_key.clone().unwrap_or_default(), Some(cfg))
        }
        _ => match SettingsRepository::get_api_key(pool, &config.provider).await {
            Ok(Some(key)) if !key.is_empty() => (key, None),
            _ => return Err("model-not-configured".to_string()),
        },
    };

    let app_data_dir = app.path().app_data_dir().ok();
    let token = CancellationToken::new();
    let client = reqwest::Client::new();
    let run = generate_summary(
        &client,
        &provider,
        &config.model,
        &api_key,
        &system_prompt,
        &user_prompt,
        ollama_endpoint.as_deref(),
        custom.as_ref().map(|c| c.endpoint.as_str()),
        custom.as_ref().and_then(|c| c.max_tokens.map(|t| t as u32)),
        custom.as_ref().and_then(|c| c.temperature),
        custom.as_ref().and_then(|c| c.top_p),
        app_data_dir.as_ref(),
        Some(&token),
    );
    match tokio::time::timeout(GENERATE_TIMEOUT, run).await {
        Ok(Ok(completion)) => Ok(completion.content.trim().to_string()),
        Ok(Err(e)) => Err(e),
        Err(_) => {
            token.cancel();
            Err("timeout".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("shade-title-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn local_hosts_only() {
        assert!(endpoint_is_local("http://localhost:11434"));
        assert!(endpoint_is_local("http://127.0.0.1:11434/api"));
        assert!(endpoint_is_local("http://[::1]:11434"));
        assert!(endpoint_is_local("localhost"));
        assert!(!endpoint_is_local("http://192.168.1.5:11434"));
        assert!(!endpoint_is_local("https://ollama.example.com"));
        // чужой хост с localhost в имени пользователя или пути не считается локальным
        assert!(!endpoint_is_local("http://localhost@evil.example.com"));
        assert!(!endpoint_is_local("https://evil.example.com/localhost"));
    }

    #[test]
    fn privacy_matches_the_interface() {
        assert!(provider_is_local(&LLMProvider::BuiltInAI, None));
        assert!(provider_is_local(&LLMProvider::Ollama, None));
        assert!(provider_is_local(&LLMProvider::Ollama, Some("http://localhost:11434")));
        assert!(!provider_is_local(&LLMProvider::Ollama, Some("http://10.0.0.7:11434")));
        for cloud in [LLMProvider::OpenAI, LLMProvider::Claude, LLMProvider::Groq, LLMProvider::OpenRouter, LLMProvider::CustomOpenAI] {
            assert!(!provider_is_local(&cloud, None), "{cloud:?} не локальный");
        }
    }

    #[test]
    fn origin_file_round_trip_and_garbage() {
        let dir = temp_folder("origin");
        assert_eq!(read_origin(&dir), None);
        write_origin(&dir, TitleOrigin::Manual).unwrap();
        assert_eq!(read_origin(&dir), Some(TitleOrigin::Manual));
        write_origin(&dir, TitleOrigin::Auto).unwrap();
        assert_eq!(read_origin(&dir), Some(TitleOrigin::Auto));
        // испорченный файл: «не знаем», а не «ручное» и не падение
        std::fs::write(dir.join(TITLE_FILE), b"{oops").unwrap();
        assert_eq!(read_origin(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn manual_title_is_never_overwritten_by_automation() {
        let d = |origin, ovr| decide_set(Some("Мой план"), origin, "Мой план", "Бюджет на квартал", ovr);
        assert_eq!(d(Some(TitleOrigin::Manual), false), SetOutcome::Manual);
        // только по нажатию «Придумать заново»
        assert_eq!(d(Some(TitleOrigin::Manual), true), SetOutcome::Set);
        assert_eq!(d(Some(TitleOrigin::Auto), false), SetOutcome::Set);
        assert_eq!(d(None, false), SetOutcome::Set);
    }

    #[test]
    fn renamed_while_generating_is_not_overwritten() {
        // автоматика начинала с «Meeting …», а человек уже переименовал (у встречи без папки пометки нет)
        let out = decide_set(Some("Мой план"), None, "Meeting 16_11_26_15_02_11", "Бюджет на квартал", false);
        assert_eq!(out, SetOutcome::Changed);
    }

    #[test]
    fn missing_and_unfit_titles_are_refused() {
        assert_eq!(decide_set(None, None, "a", "Бюджет на квартал", false), SetOutcome::Missing);
        assert_eq!(decide_set(Some("a"), None, "a", "  ", false), SetOutcome::Rejected);
        assert_eq!(decide_set(Some("a"), None, "a", "Две\nстроки", false), SetOutcome::Rejected);
        assert_eq!(decide_set(Some("a"), None, "a", &"слово ".repeat(40), false), SetOutcome::Rejected);
    }
}
