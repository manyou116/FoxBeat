#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod input;
mod settings;

use input::{InputConfig, InputService, InputStatus};
use serde::Serialize;
use settings::{Position, Settings, Stored};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;

struct Core {
    stored: Mutex<Stored>,
    path: PathBuf,
    input: InputService,
    paused: AtomicBool,
    hidden: AtomicBool,
    adjusting: AtomicBool,
    preview: bool,
    no_listener: bool,
    diagnostics: Mutex<Diagnostics>,
    moved_position: Mutex<Option<(Position, std::time::Instant)>>,
}

#[derive(Default, Serialize)]
struct Diagnostics {
    emitted: u64,
    native_pulses: u64,
    emit_errors: u64,
    received: u64,
    frames: u64,
    dancing_frames: u64,
    motion: String,
    hidden: bool,
    input_status: String,
    direct_clicks: u64,
}

#[tauri::command]
fn pet_diagnostics(app: tauri::AppHandle, window: WebviewWindow, received: u64, direct_clicks: u64, frames: u64, dancing_frames: u64, motion: String, hidden: bool) {
    if !cfg!(debug_assertions) || window.label() != "pet" { return; }
    let core = app.state::<Core>();
    let mut diagnostics = core.diagnostics.lock().unwrap();
    diagnostics.received = received;
    diagnostics.direct_clicks = direct_clicks;
    diagnostics.frames = frames;
    diagnostics.dancing_frames = dancing_frames;
    diagnostics.motion = motion;
    diagnostics.hidden = hidden;
    diagnostics.input_status = core.input.status().state;
    if let Ok(encoded) = serde_json::to_vec(&*diagnostics) {
        let _ = std::fs::write(core.path.with_file_name("runtime-diagnostics.json"), encoded);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    settings: Settings,
    status: InputStatus,
    adjusting: bool,
    paused: bool,
    hidden: bool,
}
#[derive(Clone, Serialize)]
struct Pulse {
    count: u32,
}

fn emit_pulse(app: &tauri::AppHandle, count: u32, native: bool) -> Result<(), String> {
    let result = app.emit_to("pet", "foxbeat://pulse", Pulse { count });
    if cfg!(debug_assertions) {
        if let Some(core) = app.try_state::<Core>() {
            let mut d = core.diagnostics.lock().unwrap();
            d.emitted += u64::from(count);
            if native { d.native_pulses += u64::from(count); }
            if result.is_err() { d.emit_errors += 1; }
        }
    }
    result.map_err(|e| format!("无法把节奏传给小舞伴：{e}"))
}

#[tauri::command]
fn preview_pulse(app: tauri::AppHandle, window: WebviewWindow, from_keyboard: bool) -> Result<(), String> {
    control_only(&window)?;
    let core = app.state::<Core>();
    if core.paused.load(Ordering::Relaxed) || core.hidden.load(Ordering::Relaxed) || core.preview {
        return Ok(());
    }
    // A global keyboard listener already forwards this same key; avoid double steps.
    if from_keyboard && core.input.status().state == "listening"
        && core.stored.lock().unwrap().settings.keyboard {
        return Ok(());
    }
    emit_pulse(&app, 1, false)
}

impl Core {
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            settings: self.stored.lock().unwrap().settings.clone(),
            status: if self.no_listener {
                InputStatus {
                    state: "disabled".into(),
                    message: "当前为预览模式，未开启系统输入监听".into(),
                }
            } else {
                self.input.status()
            },
            adjusting: self.adjusting.load(Ordering::Relaxed),
            paused: self.paused.load(Ordering::Relaxed),
            hidden: self.hidden.load(Ordering::Relaxed),
        }
    }
    fn save(&self, data: &Stored) -> Result<(), String> {
        if self.preview {
            Ok(())
        } else {
            settings::save(&self.path, data)
        }
    }
}

fn input_config(s: &Settings) -> InputConfig {
    InputConfig {
        keyboard: s.keyboard,
        mouse_click: s.mouse_click,
        mouse_scroll: s.mouse_scroll,
        all_keys: s.all_keys,
    }
}
fn publish(app: &tauri::AppHandle) -> Snapshot {
    let snapshot = app.state::<Core>().snapshot();
    let _ = app.emit("foxbeat://state", &snapshot);
    snapshot
}
fn open_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
fn control_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("请从主题中心调整设置".into())
    }
}

#[tauri::command]
fn get_state(core: State<Core>) -> Snapshot {
    core.snapshot()
}

fn save_settings(app: &tauri::AppHandle, value: Settings) -> Result<Snapshot, String> {
    value.validate()?;
    let core = app.state::<Core>();
    let mut stored = core.stored.lock().unwrap();
    let previous = stored.settings.clone();
    let changed_autostart = previous.autostart != value.autostart;
    if changed_autostart {
        if core.preview {
            return Err("预览模式中不修改登录启动设置".into());
        }
        let manager = app.autolaunch();
        (if value.autostart {
            manager.enable()
        } else {
            manager.disable()
        })
        .map_err(|e| format!("登录启动设置失败：{e}"))?;
    }
    let mut next = stored.clone();
    next.settings = value.clone();
    let pet = app.get_webview_window("pet");
    let resized = previous.size != value.size;
    let old_position = pet.as_ref().and_then(|window| window.outer_position().ok());
    let result = (|| {
        if resized {
            if let Some(window) = &pet {
                let side = value.size + 80.0;
                window
                    .set_size(tauri::LogicalSize::new(side, side))
                    .map_err(|e| format!("无法调整小舞伴大小：{e}"))?;
                ensure_visible(app, false)?;
            }
        }
        core.save(&next)
    })();
    if let Err(error) = result {
        if resized {
            if let Some(window) = &pet {
                let side = previous.size + 80.0;
                let _ = window.set_size(tauri::LogicalSize::new(side, side));
                if let Some(position) = old_position {
                    let _ = window.set_position(position);
                }
            }
        }
        if changed_autostart {
            let manager = app.autolaunch();
            let _ = if previous.autostart {
                manager.enable()
            } else {
                manager.disable()
            };
        }
        return Err(error);
    }
    *stored = next;
    drop(stored);
    core.input.configure(input_config(&value));
    Ok(publish(app))
}

#[tauri::command]
fn update_settings(
    app: tauri::AppHandle,
    window: WebviewWindow,
    settings: Settings,
) -> Result<Snapshot, String> {
    control_only(&window)?;
    save_settings(&app, settings)
}
#[tauri::command]
fn apply_theme(
    app: tauri::AppHandle,
    window: WebviewWindow,
    animal: String,
    dance: String,
) -> Result<Snapshot, String> {
    control_only(&window)?;
    let mut settings = app.state::<Core>().stored.lock().unwrap().settings.clone();
    settings.animal = animal;
    settings.dance = dance;
    save_settings(&app, settings)
}

fn adjust(app: &tauri::AppHandle, value: bool) -> Result<Snapshot, String> {
    let core = app.state::<Core>();
    if let Some(pet) = app.get_webview_window("pet") {
        // Direct clicking and dragging remain available outside the optional toolbar.
        pet.set_focusable(true)
            .map_err(|e| format!("无法切换窗口互动状态：{e}"))?;
        pet.set_ignore_cursor_events(false)
            .map_err(|e| format!("无法切换互动模式：{e}"))?;
        if value {
            pet.show().map_err(|e| e.to_string())?;
            core.hidden.store(false, Ordering::Relaxed);
        }
        if !value {
            if let Ok(pos) = pet.outer_position() {
                let mut stored = core.stored.lock().unwrap();
                let mut next = stored.clone();
                next.position = Some(Position { x: pos.x, y: pos.y });
                core.save(&next)?;
                *stored = next;
            }
        }
    }
    core.adjusting.store(value, Ordering::Relaxed);
    Ok(publish(app))
}
#[tauri::command]
fn set_adjusting(app: tauri::AppHandle, value: bool) -> Result<Snapshot, String> {
    adjust(&app, value)
}

/// Keep the grabbed point under the pointer without relying on AppKit's
/// currentEvent still being a mouse-down after the asynchronous IPC round trip.
#[tauri::command]
fn move_pet_from_pointer(window: WebviewWindow, offset_x: f64, offset_y: f64) -> Result<(), String> {
    if window.label() != "pet" { return Err("只能移动桌面舞伴".into()); }
    if !offset_x.is_finite() || !offset_y.is_finite() || offset_x < 0.0 || offset_y < 0.0 {
        return Err("拖动位置无效".into());
    }
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    if offset_x * scale > f64::from(size.width) || offset_y * scale > f64::from(size.height) {
        return Err("拖动位置超出舞伴窗口".into());
    }
    let pointer = window.cursor_position().map_err(|e| e.to_string())?;
    window.set_position(tauri::PhysicalPosition::new(
        (pointer.x - offset_x * scale).round() as i32,
        (pointer.y - offset_y * scale).round() as i32,
    )).map_err(|e| e.to_string())
}

fn save_moved_position(core: &Core, force: bool) -> Result<(), String> {
    let mut pending = core.moved_position.lock().unwrap();
    let Some((position, at)) = pending.as_ref() else { return Ok(()); };
    if !force && at.elapsed() < std::time::Duration::from_millis(500) { return Ok(()); }
    let mut stored = core.stored.lock().unwrap();
    let mut next = stored.clone();
    next.position = Some(position.clone());
    core.save(&next)?;
    *stored = next;
    *pending = None;
    Ok(())
}

fn ensure_visible(app: &tauri::AppHandle, reset: bool) -> Result<(), String> {
    let Some(pet) = app.get_webview_window("pet") else {
        return Ok(());
    };
    let monitors = pet.available_monitors().map_err(|e| e.to_string())?;
    let Some(primary) = pet
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| monitors.first().cloned())
    else {
        return Ok(());
    };
    let position = pet.outer_position().map_err(|e| e.to_string())?;
    let size = pet.outer_size().map_err(|e| e.to_string())?;
    let valid = monitors.iter().any(|m| {
        let p = m.position();
        let s = m.size();
        position.x >= p.x
            && position.y >= p.y
            && i64::from(position.x) + i64::from(size.width) <= i64::from(p.x) + i64::from(s.width)
            && i64::from(position.y) + i64::from(size.height)
                <= i64::from(p.y) + i64::from(s.height)
    });
    if reset || !valid {
        let p = primary.position();
        let s = primary.size();
        let x =
            (i64::from(p.x) + i64::from(s.width) - i64::from(size.width) - 24).max(i64::from(p.x));
        let y = (i64::from(p.y) + i64::from(s.height) - i64::from(size.height) - 80)
            .max(i64::from(p.y));
        pet.set_position(tauri::PhysicalPosition::new(x as i32, y as i32))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn reset_pet(app: tauri::AppHandle) -> Result<Snapshot, String> {
    ensure_visible(&app, true)?;
    adjust(&app, false)?;
    if let Some(pet) = app.get_webview_window("pet") {
        let _ = pet.show();
    }
    app.state::<Core>().hidden.store(false, Ordering::Relaxed);
    Ok(publish(&app))
}
fn pause(app: &tauri::AppHandle, value: bool) -> Result<Snapshot, String> {
    let core = app.state::<Core>();
    core.input.set_paused(value);
    if value {
        adjust(app, false)?;
    }
    core.paused.store(value, Ordering::Relaxed);
    core.hidden.store(value, Ordering::Relaxed);
    if let Some(pet) = app.get_webview_window("pet") {
        if value {
            pet.hide().map_err(|e| e.to_string())?;
        } else {
            ensure_visible(app, false)?;
            pet.show().map_err(|e| e.to_string())?;
        }
    }
    Ok(publish(app))
}
#[tauri::command]
fn set_paused(app: tauri::AppHandle, value: bool) -> Result<Snapshot, String> {
    pause(&app, value)
}
#[tauri::command]
fn retry_input(
    app: tauri::AppHandle,
    window: WebviewWindow,
    request_permission: bool,
) -> Result<Snapshot, String> {
    control_only(&window)?;
    let core = app.state::<Core>();
    if !core.no_listener {
        let config = input_config(&core.stored.lock().unwrap().settings);
        core.input.start(config, request_permission);
        core.input.set_paused(core.paused.load(Ordering::Relaxed));
    }
    Ok(publish(&app))
}
#[tauri::command]
fn open_input_settings(window: WebviewWindow) -> Result<(), String> {
    control_only(&window)?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
fn pet_ready(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "pet" {
        return Ok(());
    }
    ensure_visible(&app, false)?;
    window
        .set_ignore_cursor_events(false)
        .map_err(|e| e.to_string())?;
    if !app.state::<Core>().hidden.load(Ordering::Relaxed) {
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
fn main_ready(app: tauri::AppHandle, window: WebviewWindow) {
    if window.label() == "main" && !std::env::args().any(|s| s == "--autostart") {
        open_main(&app);
    }
}
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.state::<Core>().input.stop();
    app.exit(0);
}

fn install_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let open = MenuItem::with_id(app, "open", "打开主题中心", true, None::<&str>)?;
    let adjust = MenuItem::with_id(app, "adjust", "调整位置 / 摸摸", true, None::<&str>)?;
    let done = MenuItem::with_id(app, "done", "完成调整", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset", "找回小动物", true, None::<&str>)?;
    let pause_item = MenuItem::with_id(app, "pause", "暂停并隐藏", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "resume", "显示并继续", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出狐伴", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &adjust,
            &done,
            &reset,
            &pause_item,
            &resume,
            &separator,
            &quit,
        ],
    )?;
    let mut builder = tauri::tray::TrayIconBuilder::with_id("foxbeat")
        .tooltip("狐伴 FoxBeat")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_main(app),
            "adjust" => {
                let _ = adjust_action(app, true);
            }
            "done" => {
                let _ = adjust_action(app, false);
            }
            "reset" => {
                let _ = reset_pet(app.clone());
            }
            "pause" => {
                let _ = pause(app, true);
            }
            "resume" => {
                let _ = pause(app, false);
            }
            "quit" => {
                app.state::<Core>().input.stop();
                app.exit(0);
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
fn adjust_action(app: &tauri::AppHandle, value: bool) -> Result<Snapshot, String> {
    adjust(app, value)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            open_main(app)
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--autostart"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_state,
            apply_theme,
            update_settings,
            set_adjusting,
            move_pet_from_pointer,
            reset_pet,
            set_paused,
            retry_input,
            open_input_settings,
            pet_ready,
            main_ready,
            quit_app,
            pet_diagnostics,
            preview_pulse
        ])
        .setup(|app| {
            let preview = std::env::args().any(|s| s == "--preview");
            let no_listener = preview || std::env::args().any(|s| s == "--no-listener");
            let path = if let Some(p) = std::env::var_os("FOXBEAT_CONFIG_DIR") {
                PathBuf::from(p).join("settings.json")
            } else {
                app.path().app_config_dir()?.join("settings.json")
            };
            let mut stored = if preview {
                Stored::default()
            } else {
                settings::load(&path).unwrap_or_default()
            };
            if !preview {
                stored.settings.autostart = app.autolaunch().is_enabled().unwrap_or(false);
            }
            let pulse_app = app.handle().clone();
            let status_app = app.handle().clone();
            let input = InputService::new(
                move |count| {
                    let _ = emit_pulse(&pulse_app, count, true);
                },
                move |status| {
                    let _ = status_app.emit("foxbeat://input-status", status);
                },
            );
            let config = input_config(&stored.settings);
            let size = stored.settings.size;
            let saved = stored.position.clone();
            app.manage(Core {
                stored: Mutex::new(stored),
                path,
                input,
                paused: AtomicBool::new(false),
                hidden: AtomicBool::new(false),
                adjusting: AtomicBool::new(false),
                preview,
                no_listener,
                diagnostics: Mutex::new(Diagnostics::default()),
                moved_position: Mutex::new(None),
            });
            install_tray(app.handle())?;
            if !preview {
                let pet = WebviewWindowBuilder::new(
                    app,
                    "pet",
                    WebviewUrl::App("index.html?view=pet".into()),
                )
                .title("狐伴小舞伴")
                .inner_size(size + 80.0, size + 80.0)
                .decorations(false)
                .transparent(true)
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .focused(false)
                .focusable(true)
                .accept_first_mouse(true)
                .visible(false)
                .build()?;
                pet.set_ignore_cursor_events(false)?;
                if let Some(p) = saved {
                    let _ = pet.set_position(tauri::PhysicalPosition::new(p.x, p.y));
                }
            }
            if !no_listener {
                app.state::<Core>().input.start(config, false);
            }
            let monitor_app = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                // Native recovery must not depend on a focused WebView timer.
                if let Some(core) = monitor_app.try_state::<Core>() {
                    if !core.no_listener {
                        core.input.refresh_permission();
                    }
                }
                let queued = monitor_app.clone();
                if monitor_app
                    .run_on_main_thread(move || {
                        if let Some(core) = queued.try_state::<Core>() {
                            let moving = core.moved_position.lock().unwrap().as_ref()
                                .is_some_and(|(_, at)| at.elapsed() < std::time::Duration::from_millis(500));
                            if !core.adjusting.load(Ordering::Relaxed) && !moving {
                                let _ = ensure_visible(&queued, false);
                            }
                            let _ = save_moved_position(&core, false);
                        }
                    })
                    .is_err()
                {
                    break;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "pet" {
                if let tauri::WindowEvent::Moved(position) = event {
                    if let Some(core) = window.app_handle().try_state::<Core>() {
                        *core.moved_position.lock().unwrap() = Some((
                            Position { x: position.x, y: position.y }, std::time::Instant::now()));
                    }
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("FoxBeat could not initialize")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(core) = app.try_state::<Core>() {
                    let _ = save_moved_position(&core, true);
                    core.input.stop();
                }
            }
        });
}
