mod classify;
mod news;
mod storage;
mod watcher;
mod weather;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

pub struct AppState {
    pub data_dir: PathBuf,
    pub settings: Mutex<storage::Settings>,
    pub favorites: Mutex<Vec<storage::Favorite>>,
    pub news_cache: Mutex<Option<news::NewsCache>>,
    pub watcher: Mutex<watcher::WatcherState>,
    pub client: reqwest::Client,
}

#[tauri::command]
async fn fetch_news(state: tauri::State<'_, AppState>) -> Result<news::FetchResult, String> {
    Ok(news::fetch_news(&state).await)
}

#[tauri::command]
fn get_cached_news(state: tauri::State<'_, AppState>) -> Option<news::FetchResult> {
    news::cached_news(&state)
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, AppState>) -> storage::Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(
    settings: storage::Settings,
    state: tauri::State<'_, AppState>,
) -> Result<storage::Settings, String> {
    let mut s = settings;
    s.idle_minutes = s.idle_minutes.clamp(1, 60);
    let prev_enabled = state.settings.lock().unwrap().enabled;
    if s.enabled != prev_enabled {
        watcher::set_autostart(s.enabled).map_err(|e| format!("设置开机自启失败: {}", e))?;
    }
    *state.settings.lock().unwrap() = s.clone();
    storage::save_settings(&state.data_dir, &s).map_err(|e| e.to_string())?;
    Ok(s)
}

#[tauri::command]
fn favorites_list(state: tauri::State<'_, AppState>) -> Vec<storage::Favorite> {
    state.favorites.lock().unwrap().clone()
}

#[tauri::command]
async fn fetch_weather(
    city_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<weather::WeatherResult, String> {
    Ok(weather::fetch_weather(&state.client, &city_id, &state.data_dir).await)
}

#[tauri::command]
fn favorites_toggle(
    item: news::NewsItem,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<storage::Favorite>, String> {
    let mut favs = state.favorites.lock().unwrap();
    // 按 id 或归一化标题去重，避免同一条新闻跨刷新重复收藏
    if let Some(pos) = favs
        .iter()
        .position(|f| f.id == item.id || f.title.trim() == item.title.trim())
    {
        favs.remove(pos);
    } else {
        let saved_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .to_string();
        favs.push(storage::Favorite {
            id: item.id,
            title: item.title,
            url: item.url,
            province: item.province,
            summary: item.summary,
            saved_at,
        });
    }
    let out = favs.clone();
    drop(favs);
    storage::save_favorites(&state.data_dir, &out).map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
fn show_screensaver(app: tauri::AppHandle) {
    watcher::show_screensaver_impl(&app);
}

#[tauri::command]
fn exit_screensaver(app: tauri::AppHandle) {
    watcher::exit_screensaver_impl(&app);
}

#[tauri::command]
fn start_preview(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("preview") {
        let _ = win.unminimize();
        let _ = win.show();
        // 防止被设置窗口挡住：短暂置顶后再释放
        let _ = win.set_always_on_top(true);
        let _ = win.set_focus();
        let app2 = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1200));
            if let Some(w) = app2.get_webview_window("preview") {
                let _ = w.set_always_on_top(false);
            }
        });
    }
}

#[tauri::command]
fn close_preview(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("preview") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn close_settings(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let verb: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
    let target: Vec<u16> = std::ffi::OsStr::new(url.as_str())
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        return Err("无法打开新闻链接".to_string());
    }
    Ok(())
}

fn validate_external_url(raw: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw).map_err(|_| "无效链接".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("仅支持不含账号信息的 http/https 链接".to_string());
    }
    Ok(parsed)
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let show_settings = MenuItem::with_id(app, "show_settings", "设置", true, None::<&str>)?;
    let run_now = MenuItem::with_id(app, "run_now", "立即全屏", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause_hour", "暂停自动显示 1 小时", true, None::<&str>)?;
    let pause_until_resumed = MenuItem::with_id(app, "pause_until_resumed", "本次运行暂停自动显示", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "恢复自动显示", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_settings, &run_now, &pause, &pause_until_resumed, &resume, &quit])?;
    let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(win) = tray.app_handle().get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_settings" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "run_now" => watcher::show_screensaver_impl(app),
            "pause_hour" => watcher::pause_for_hour(app),
            "pause_until_resumed" => watcher::pause_until_resumed(app),
            "resume" => watcher::resume(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir());
            let settings = storage::load_settings(&data_dir);
            let autostart_enabled = settings.enabled;
            let favorites = storage::load_favorites(&data_dir);
            app.manage(AppState {
                data_dir,
                settings: Mutex::new(settings),
                favorites: Mutex::new(favorites),
                news_cache: Mutex::new(None),
                watcher: Mutex::new(watcher::WatcherState::default()),
                client: reqwest::Client::new(),
            });
            let _ = watcher::set_autostart(autostart_enabled);
            let args: Vec<String> = std::env::args().collect();
            if args.iter().any(|a| a == "--autostart") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            if args.iter().any(|a| a == "--screensaver") {
                watcher::show_screensaver_impl(app.handle());
            }
            let _ = setup_tray(app);
            watcher::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            fetch_news,
            get_cached_news,
            get_settings,
            save_settings,
            favorites_list,
            favorites_toggle,
            fetch_weather,
            show_screensaver,
            exit_screensaver,
            start_preview,
            close_preview,
            close_settings,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_urls_require_http_or_https_and_a_host() {
        assert!(validate_external_url("https://news.example.com/story").is_ok());
        assert!(validate_external_url("http://news.example.com/story?a=1&b=2").is_ok());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("https://").is_err());
        assert!(validate_external_url("https://user:pass@news.example.com").is_err());
    }
}
