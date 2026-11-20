//! Shade: жесты «назад» и «вперёд» в окне на macOS.
//!
//! WKWebView выполняет жест «смахнуть назад/вперёд» (тачпад, боковые кнопки мыши
//! Logitech через Logi Options+), только когда включён allowsBackForwardNavigationGestures.
//! Tauri 2 эту настройку не выводит, wry по умолчанию держит её выключенной. Экраны Shade
//! меняются через history.pushState, такие записи входят в историю WKWebView, поэтому
//! жест возвращает на прошлый экран без перезагрузки страницы.
//! При отказе (нет окна, вызов не прошёл) пишем в журнал и работаем дальше: остаются
//! ⌘[ / ⌘] и кнопки мыши 4/5 (frontend/src/shade/lib/history-nav.ts).

#[cfg(target_os = "macos")]
pub fn enable(app: &tauri::AppHandle) {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        log::warn!("nav gestures: окно main не найдено");
        return;
    };
    let result = window.with_webview(|webview| {
        use objc::runtime::{Object, YES};
        use objc::{msg_send, sel, sel_impl};
        let wk = webview.inner() as *mut Object;
        if wk.is_null() {
            return;
        }
        // SAFETY: inner() на macOS отдаёт живой WKWebView; вызов идёт в главном потоке
        unsafe {
            let _: () = msg_send![wk, setAllowsBackForwardNavigationGestures: YES];
        }
    });
    if let Err(e) = result {
        log::warn!("nav gestures: не включены: {}", e);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn enable(_app: &tauri::AppHandle) {}
