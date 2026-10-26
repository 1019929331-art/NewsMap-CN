use crate::AppState;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use winreg::enums::*;
use winreg::RegKey;

#[derive(Default)]
pub struct WatcherState {
    pub shown: bool,
    pub paused_until: Option<Instant>,
    pub paused_until_resumed: bool,
}

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "NewsMapCN";

pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let Some(state) = app.try_state::<AppState>() else {
            continue;
        };
        let cfg = state.settings.lock().unwrap().clone();
        let mut shown = state.watcher.lock().unwrap();
        if !cfg.enabled || shown.shown || shown.paused_until_resumed
            || shown.paused_until.is_some_and(|until| Instant::now() < until) {
            continue;
        }
        if idle_seconds() >= u64::from(cfg.idle_minutes) * 60 && !foreground_is_fullscreen() {
            shown.shown = true;
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || show_screensaver_impl(&app2));
        }
    });
}

pub fn pause_for_hour(app: &tauri::AppHandle) {
    exit_screensaver_impl(app);
    if let Some(state) = app.try_state::<AppState>() {
        let mut watcher = state.watcher.lock().unwrap();
        watcher.paused_until_resumed = false;
        watcher.paused_until = Some(Instant::now() + Duration::from_secs(3600));
    }
}

pub fn pause_until_resumed(app: &tauri::AppHandle) {
    exit_screensaver_impl(app);
    if let Some(state) = app.try_state::<AppState>() {
        state.watcher.lock().unwrap().paused_until_resumed = true;
    }
}

pub fn resume(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        let mut watcher = state.watcher.lock().unwrap();
        watcher.paused_until = None;
        watcher.paused_until_resumed = false;
    }
}

fn foreground_is_fullscreen() -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect};

    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_null() {
        return false;
    }
    let mut class_name = [0u16; 64];
    let len = unsafe { GetClassNameW(foreground, class_name.as_mut_ptr(), class_name.len() as i32) };
    let class_name = String::from_utf16_lossy(&class_name[..len.max(0) as usize]);
    if class_name == "Progman" || class_name == "WorkerW" {
        return false;
    }
    let monitor = unsafe { MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_null() {
        return false;
    }
    let mut window = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        rcMonitor: RECT { left: 0, top: 0, right: 0, bottom: 0 },
        rcWork: RECT { left: 0, top: 0, right: 0, bottom: 0 },
        dwFlags: 0,
    };
    if unsafe { GetWindowRect(foreground, &mut window) } == 0
        || unsafe { GetMonitorInfoW(monitor, &mut info) } == 0
    {
        return false;
    }
    window.left <= info.rcMonitor.left
        && window.top <= info.rcMonitor.top
        && window.right >= info.rcMonitor.right
        && window.bottom >= info.rcMonitor.bottom
}

pub fn show_screensaver_impl(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.watcher.lock().unwrap().shown = true;
    }
    if let Some(win) = app.get_webview_window("screensaver") {
        if let Some((x, y)) = cursor_monitor_origin() {
            let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)));
        }
        let _ = win.show();
        let _ = win.set_fullscreen(true);
        let _ = win.set_focus();
        let _ = win.emit("screensaver-shown", ());
    }
}

/// 返回鼠标所在显示器的左上角坐标（物理像素），用于多屏时屏保跟随鼠标
fn cursor_monitor_origin() -> Option<(i32, i32)> {
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut pt = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut pt) } == 0 {
        return None;
    }
    let hmon = unsafe { MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST) };
    if hmon.is_null() {
        return None;
    }
    let mut mi = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        rcMonitor: RECT { left: 0, top: 0, right: 0, bottom: 0 },
        rcWork: RECT { left: 0, top: 0, right: 0, bottom: 0 },
        dwFlags: 0,
    };
    if unsafe { GetMonitorInfoW(hmon, &mut mi) } == 0 {
        return None;
    }
    Some((mi.rcMonitor.left, mi.rcMonitor.top))
}

pub fn exit_screensaver_impl(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.watcher.lock().unwrap().shown = false;
    }
    if let Some(win) = app.get_webview_window("screensaver") {
        let _ = win.hide();
    }
}

pub fn set_autostart(enabled: bool) -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(RUN_KEY)?;
    if enabled {
        let exe = std::env::current_exe()?;
        key.set_value(RUN_VALUE, &format!("\"{}\" --autostart", exe.display()))?;
    } else if key.delete_value(RUN_VALUE).is_err() {
        // 值不存在无需报错
    }
    Ok(())
}

fn idle_seconds() -> u64 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut lii = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    // ponytail: 单机唯一会话内轮询；多会话/远程桌面场景未覆盖
    if unsafe { GetLastInputInfo(&mut lii) } != 0 {
        let now = unsafe { GetTickCount() };
        return u64::from(now.wrapping_sub(lii.dwTime) / 1000);
    }
    0
}
