//! Read-only native input, reduced to anonymous, bounded activity pulses.
//!
//! Callbacks must return promptly (for example, emit a Tauri event). No character
//! decoding, input injection, clipboard access, or per-key logging is performed.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const FRAME_INTERVAL: Duration = Duration::from_millis(33);
const MAX_PENDING_PULSES: u32 = 256;

fn lock<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InputConfig {
    pub keyboard: bool,
    pub mouse_click: bool,
    pub mouse_scroll: bool,
    pub all_keys: bool,
}

impl Default for InputConfig {
    fn default() -> Self {
        Self {
            keyboard: true,
            mouse_click: false,
            mouse_scroll: false,
            all_keys: false,
        }
    }
}

impl InputConfig {
    fn any_source(self) -> bool {
        self.keyboard || self.mouse_click || self.mouse_scroll
    }

    fn same_sources(self, other: Self) -> bool {
        self.keyboard == other.keyboard
            && self.mouse_click == other.mouse_click
            && self.mouse_scroll == other.mouse_scroll
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputStatus {
    pub state: String,
    pub message: String,
}

impl InputStatus {
    fn new(state: &str, message: &str) -> Self {
        Self {
            state: state.into(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Copy)]
struct KeyActivity {
    /// Bounded physical-key identity; never leaves the native listener.
    identity: usize,
    down: bool,
    repeated: bool,
    modifier: bool,
    typing_key: bool,
    shortcut: bool,
}

struct PressFilter {
    held: [bool; 1024],
}

impl Default for PressFilter {
    fn default() -> Self {
        Self {
            held: [false; 1024],
        }
    }
}

impl PressFilter {
    fn accept(&mut self, key: KeyActivity, config: InputConfig) -> bool {
        let Some(held) = self.held.get_mut(key.identity) else {
            return false;
        };
        if !key.down {
            *held = false;
            return false;
        }
        let was_held = *held;
        *held = true;
        config.keyboard
            && !key.modifier
            && !key.repeated
            && !was_held
            && (config.all_keys || (key.typing_key && !key.shortcut))
    }

    fn clear(&mut self) {
        self.held.fill(false);
    }
}

/// Option is used to type accents on macOS. Right Alt + Ctrl is AltGr on Windows.
fn is_shortcut(mac: bool, control: bool, command: bool, alt: bool, right_alt: bool) -> bool {
    if mac {
        control || command
    } else {
        command || ((control || alt) && !(right_alt && control))
    }
}

struct Shared {
    config: Mutex<InputConfig>,
    pet_click_bounds: Mutex<Option<[f64; 4]>>,
    status: Mutex<InputStatus>,
    paused: AtomicBool,
    on_pulse: Box<dyn Fn(u32) + Send + Sync>,
    on_status: Box<dyn Fn(InputStatus) + Send + Sync>,
}

impl Shared {
    fn publish(&self, status: InputStatus) {
        {
            let mut current = lock(&self.status);
            if *current == status {
                return;
            }
            *current = status.clone();
        }
        // Consumer failures cannot unwind through a system input callback.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (self.on_status)(status)));
    }
}

type Waker = Box<dyn Fn() + Send + Sync>;

struct RunState {
    shared: Arc<Shared>,
    lifecycle: Mutex<()>,
    cancelled: AtomicBool,
    listening: AtomicBool,
    pending: AtomicU32,
    filter: Mutex<PressFilter>,
    waker: Mutex<Option<Waker>>,
}

impl RunState {
    fn new(shared: Arc<Shared>) -> Self {
        Self {
            shared,
            lifecycle: Mutex::new(()),
            cancelled: AtomicBool::new(false),
            listening: AtomicBool::new(false),
            pending: AtomicU32::new(0),
            filter: Mutex::new(PressFilter::default()),
            waker: Mutex::new(None),
        }
    }

    fn install_waker(&self, wake: Waker) {
        let mut waker = lock(&self.waker);
        *waker = Some(wake);
        // Close the race where stop() precedes native-thread initialization.
        if self.cancelled.load(Ordering::Acquire) {
            if let Some(wake) = waker.as_ref() {
                wake();
            }
        }
    }

    fn cancel(&self) {
        let _lifecycle = lock(&self.lifecycle);
        self.cancelled.store(true, Ordering::Release);
        self.listening.store(false, Ordering::Release);
        self.pending.store(0, Ordering::Release);
        if let Some(wake) = lock(&self.waker).as_ref() {
            wake();
        }
    }

    fn add_pulse(&self) {
        if self.cancelled.load(Ordering::Acquire)
            || !self.listening.load(Ordering::Acquire)
            || self.shared.paused.load(Ordering::Acquire)
        {
            return;
        }
        let _ = self
            .pending
            .fetch_update(Ordering::AcqRel, Ordering::Relaxed, |count| {
                Some(count.saturating_add(1).min(MAX_PENDING_PULSES))
            });
    }

    fn key(&self, key: KeyActivity) {
        let config = *lock(&self.shared.config);
        if lock(&self.filter).accept(key, config) {
            self.add_pulse();
        }
    }

    fn mouse(&self, scroll: bool) {
        let config = *lock(&self.shared.config);
        if if scroll {
            config.mouse_scroll
        } else {
            config.mouse_click
        } {
            self.add_pulse();
        }
    }

    fn mouse_at(&self, scroll: bool, x: f64, y: f64) {
        // The pet handles its click on release, after distinguishing a drag.
        if !scroll && lock(&self.shared.pet_click_bounds).is_some_and(|[left, top, right, bottom]|
            x >= left && x < right && y >= top && y < bottom) {
            return;
        }
        self.mouse(scroll);
    }

    fn ready(&self) {
        let _lifecycle = lock(&self.lifecycle);
        if self.cancelled.load(Ordering::Acquire) {
            return;
        }
        self.listening.store(true, Ordering::Release);
        self.publish_activity_state();
    }

    /// A UI pause toggle must never mark a failed or uninitialized listener ready.
    fn refresh_pause_state(&self) {
        let _lifecycle = lock(&self.lifecycle);
        self.pending.store(0, Ordering::Release);
        if !self.cancelled.load(Ordering::Acquire) && self.listening.load(Ordering::Acquire) {
            self.publish_activity_state();
        }
    }

    fn publish_activity_state(&self) {
        self.shared
            .publish(if self.shared.paused.load(Ordering::Acquire) {
                InputStatus::new("paused", "互动已暂停")
            } else {
                InputStatus::new("listening", "正在感受敲键节奏，不读取输入文字")
            });
    }

    fn fail(&self, status: InputStatus) {
        let _lifecycle = lock(&self.lifecycle);
        if !self.cancelled.load(Ordering::Acquire) {
            self.listening.store(false, Ordering::Release);
            self.pending.store(0, Ordering::Release);
            self.shared.publish(status);
        }
    }

    fn dispatch(&self) {
        while !self.cancelled.load(Ordering::Acquire) {
            thread::park_timeout(FRAME_INTERVAL);
            let count = self.pending.swap(0, Ordering::AcqRel);
            if count > 0
                && !self.cancelled.load(Ordering::Acquire)
                && self.listening.load(Ordering::Acquire)
                && !self.shared.paused.load(Ordering::Acquire)
            {
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    (self.shared.on_pulse)(count);
                }));
            }
        }
    }
}

struct Session {
    state: Arc<RunState>,
    native: JoinHandle<()>,
    dispatch: JoinHandle<()>,
}

#[derive(Clone, Copy)]
struct NativeBackend {
    check_permission: fn(bool) -> Result<(), InputStatus>,
    run: fn(Arc<RunState>, InputConfig) -> Result<(), InputStatus>,
}

impl Session {
    fn stop(self) {
        self.state.cancel();
        self.dispatch.thread().unpark();
        let _ = self.native.join();
        let _ = self.dispatch.join();
    }
}

/// Owns native listener lifetimes. Construction/configuration do not request permissions.
pub struct InputService {
    shared: Arc<Shared>,
    operation: Mutex<()>,
    session: Mutex<Option<Session>>,
    /// Retained across disabled sources or failed startup; cleared only by stop().
    wanted_running: AtomicBool,
    backend: NativeBackend,
}

impl InputService {
    pub fn set_pet_click_bounds(&self, bounds: Option<[f64; 4]>) {
        *lock(&self.shared.pet_click_bounds) = bounds;
    }

    pub fn new(
        on_pulse: impl Fn(u32) + Send + Sync + 'static,
        on_status: impl Fn(InputStatus) + Send + Sync + 'static,
    ) -> Self {
        Self {
            shared: Arc::new(Shared {
                config: Mutex::new(InputConfig::default()),
                status: Mutex::new(InputStatus::new("ready", "尚未开始感受敲键节奏")),
                paused: AtomicBool::new(false),
                on_pulse: Box::new(on_pulse),
                pet_click_bounds: Mutex::new(None),
                on_status: Box::new(on_status),
            }),
            operation: Mutex::new(()),
            session: Mutex::new(None),
            wanted_running: AtomicBool::new(false),
            backend: NativeBackend {
                check_permission: native::check_permission,
                run: native::run,
            },
        }
    }

    pub fn start(&self, config: InputConfig, request_permission: bool) -> InputStatus {
        let _operation = lock(&self.operation);
        self.wanted_running.store(true, Ordering::Release);
        self.start_locked(config, request_permission)
    }

    fn start_locked(&self, config: InputConfig, request_permission: bool) -> InputStatus {
        self.stop_locked();
        *lock(&self.shared.config) = config;
        if !config.any_source() {
            self.shared.publish(InputStatus::new(
                "disabled",
                "所有互动来源已关闭，请开启键盘、鼠标点击或滚轮",
            ));
            return self.status();
        }
        if let Err(status) = (self.backend.check_permission)(request_permission) {
            self.shared.publish(status);
            return self.status();
        }
        self.shared
            .publish(InputStatus::new("ready", "正在准备输入监听"));
        let state = Arc::new(RunState::new(self.shared.clone()));
        let dispatch_state = state.clone();
        let dispatch = match thread::Builder::new()
            .name("foxbeat-pulses".into())
            .spawn(move || dispatch_state.dispatch())
        {
            Ok(handle) => handle,
            Err(_) => {
                self.shared
                    .publish(InputStatus::new("error", "无法启动互动线程，请重试"));
                return self.status();
            }
        };
        let native_state = state.clone();
        let run_native = self.backend.run;
        let native = thread::Builder::new()
            .name("foxbeat-native-input".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run_native(native_state.clone(), config)
                }));
                match result {
                    Ok(Err(status)) => native_state.fail(status),
                    Err(_) => {
                        native_state.fail(InputStatus::new("error", "输入监听意外停止，请重试"))
                    }
                    Ok(Ok(())) if !native_state.cancelled.load(Ordering::Acquire) => {
                        native_state.fail(InputStatus::new("error", "输入监听已结束，请重试"));
                    }
                    Ok(Ok(())) => {}
                }
                native_state.cancel();
            });
        match native {
            Ok(native) => {
                *lock(&self.session) = Some(Session {
                    state,
                    native,
                    dispatch,
                })
            }
            Err(_) => {
                state.cancel();
                dispatch.thread().unpark();
                let _ = dispatch.join();
                self.shared
                    .publish(InputStatus::new("error", "无法启动系统输入监听，请重试"));
            }
        }
        // Startup is asynchronous: a later callback reports listening or the exact failure.
        self.status()
    }

    pub fn configure(&self, config: InputConfig) {
        let _operation = lock(&self.operation);
        let previous = *lock(&self.shared.config);
        if self.wanted_running.load(Ordering::Acquire) && !previous.same_sources(config) {
            // Source restoration must restart even when all-off removed the old session.
            // configure() alone (including --no-listener) never grants this intent.
            self.start_locked(config, false);
        } else {
            *lock(&self.shared.config) = config;
        }
    }

    /// Reconnect after the user grants permission in System Settings, even while
    /// every application window is in the background. Never prompts or retries
    /// arbitrary native errors, and never starts an explicitly stopped service.
    pub fn refresh_permission(&self) {
        let _operation = lock(&self.operation);
        if !self.wanted_running.load(Ordering::Acquire)
            || self.status().state != "permission_required"
        {
            return;
        }
        let config = *lock(&self.shared.config);
        if config.any_source() && (self.backend.check_permission)(false).is_ok() {
            self.start_locked(config, false);
        }
    }

    pub fn stop(&self) {
        let _operation = lock(&self.operation);
        self.wanted_running.store(false, Ordering::Release);
        self.stop_locked();
        self.shared
            .publish(InputStatus::new("stopped", "输入互动已停止"));
    }

    fn stop_locked(&self) {
        let session = lock(&self.session).take();
        if let Some(session) = session {
            session.stop();
        }
    }

    pub fn set_paused(&self, paused: bool) {
        let _operation = lock(&self.operation);
        self.shared.paused.store(paused, Ordering::Release);
        if let Some(session) = lock(&self.session).as_ref() {
            session.state.refresh_pause_state();
        }
    }

    pub fn status(&self) -> InputStatus {
        lock(&self.shared.status).clone()
    }
}

impl Drop for InputService {
    fn drop(&mut self) {
        self.stop_locked();
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use core_foundation::runloop::{kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop};
    use core_graphics::event::{
        CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
        CGEventType, CallbackResult, EventField,
    };
    use std::time::Instant;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightListenEventAccess() -> bool;
        fn CGRequestListenEventAccess() -> bool;
    }

    pub(super) fn check_permission(request: bool) -> Result<(), InputStatus> {
        // Both public APIs are available on our macOS 13+ deployment target.
        let allowed = unsafe { CGPreflightListenEventAccess() };
        if allowed {
            return Ok(());
        }
        if request && unsafe { CGRequestListenEventAccess() } {
            return Ok(());
        }
        Err(InputStatus::new("permission_required",
            "目前只能响应本窗口试打，切到其他软件后不会跟随。请在“系统设置 → 隐私与安全性 → 输入监控”允许 FoxBeat；授权后会自动检查，若系统提示退出并重新打开，请按提示操作。"))
    }

    pub(super) fn run(state: Arc<RunState>, config: InputConfig) -> Result<(), InputStatus> {
        if state.cancelled.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut events = Vec::new();
        if config.keyboard {
            events.extend([CGEventType::KeyDown, CGEventType::KeyUp]);
        }
        if config.mouse_click {
            events.extend([
                CGEventType::LeftMouseDown,
                CGEventType::RightMouseDown,
                CGEventType::OtherMouseDown,
            ]);
        }
        if config.mouse_scroll {
            events.push(CGEventType::ScrollWheel);
        }
        let disabled = Arc::new(AtomicU32::new(0));
        let disabled_callback = disabled.clone();
        let callback_state = state.clone();
        let tap = CGEventTap::new(CGEventTapLocation::Session, CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly, events, move |_proxy, kind, event| {
                match kind {
                    CGEventType::TapDisabledByTimeout => { disabled_callback.store(1, Ordering::Release); }
                    CGEventType::TapDisabledByUserInput => { disabled_callback.store(2, Ordering::Release); }
                    CGEventType::KeyDown | CGEventType::KeyUp => {
                        let code = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as usize;
                        let flags = event.get_flags();
                        callback_state.key(KeyActivity {
                            identity: code,
                            down: matches!(kind, CGEventType::KeyDown),
                            repeated: event.get_integer_value_field(EventField::KEYBOARD_EVENT_AUTOREPEAT) != 0,
                            modifier: (54..=63).contains(&code),
                            typing_key: matches!(code, 0..=51 | 65 | 67 | 69 | 75 | 76 | 78 | 81..=89 | 91..=95 | 102 | 104),
                            shortcut: is_shortcut(true,
                                flags.contains(CGEventFlags::CGEventFlagControl),
                                flags.contains(CGEventFlags::CGEventFlagCommand),
                                flags.contains(CGEventFlags::CGEventFlagAlternate), false),
                        });
                    }
                    CGEventType::LeftMouseDown | CGEventType::RightMouseDown | CGEventType::OtherMouseDown => {
                        let point = event.location();
                        callback_state.mouse_at(false, point.x, point.y);
                    }
                    CGEventType::ScrollWheel => callback_state.mouse(true),
                    _ => {}
                }
                CallbackResult::Keep
            }).map_err(|_| {
                check_permission(false).err().unwrap_or_else(|| InputStatus::new("error",
                    "系统未能创建输入监听，请检查输入监控权限后重新打开 FoxBeat"))
            })?;
        let source = tap
            .mach_port()
            .create_runloop_source(0)
            .map_err(|_| InputStatus::new("error", "无法创建输入事件循环，请重试"))?;
        let run_loop = CFRunLoop::get_current();
        run_loop.add_source(&source, unsafe { kCFRunLoopCommonModes });
        let wake_loop = run_loop.clone();
        state.install_waker(Box::new(move || wake_loop.stop()));
        tap.enable();
        state.ready();
        let mut permission_check = Instant::now();
        let mut timeout_count = 0;
        let result = loop {
            if state.cancelled.load(Ordering::Acquire) {
                break Ok(());
            }
            CFRunLoop::run_in_mode(
                unsafe { kCFRunLoopDefaultMode },
                Duration::from_millis(100),
                false,
            );
            if permission_check.elapsed() >= Duration::from_secs(1) {
                permission_check = Instant::now();
                if let Err(status) = check_permission(false) {
                    break Err(status);
                }
            }
            match disabled.swap(0, Ordering::AcqRel) {
                1 if timeout_count < 2 => {
                    timeout_count += 1;
                    lock(&state.filter).clear();
                    state.pending.store(0, Ordering::Release);
                    tap.enable();
                }
                1 | 2 => {
                    break Err(check_permission(false).err().unwrap_or_else(|| {
                        InputStatus::new("error", "系统暂停了输入监听，请点击重试")
                    }))
                }
                _ => {}
            }
        };
        run_loop.remove_source(&source, unsafe { kCFRunLoopCommonModes });
        *lock(&state.waker) = None;
        result
    }
}

#[cfg(target_os = "windows")]
mod native {
    use super::*;
    use std::cell::RefCell;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    thread_local! { static CONTEXT: RefCell<Option<Arc<RunState>>> = const { RefCell::new(None) }; }

    pub(super) fn check_permission(_request: bool) -> Result<(), InputStatus> {
        Ok(())
    }

    fn key_down(vk: i32) -> bool {
        unsafe { GetAsyncKeyState(vk) < 0 }
    }

    unsafe extern "system" fn keyboard_hook(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && lp != 0 {
            // KBDLLHOOKSTRUCT uses pointer-sized ULONG_PTR in the Windows SDK.
            let key = unsafe { &*(lp as *const KBDLLHOOKSTRUCT) };
            if key.flags & LLKHF_INJECTED == 0 {
                CONTEXT.with(|context| {
                    if let Some(state) = context.borrow().as_ref() {
                        let vk = key.vkCode;
                        let extended = usize::from(key.flags & LLKHF_EXTENDED != 0);
                        let identity = if key.scanCode == 0 { 512 + (vk & 0xff) as usize }
                            else { ((key.scanCode & 0xff) as usize) * 2 + extended };
                        state.key(KeyActivity {
                            identity,
                            down: matches!(wp as u32, WM_KEYDOWN | WM_SYSKEYDOWN),
                            repeated: false, // LL hooks have no repeat bit; PressFilter tracks down/up.
                            modifier: matches!(vk, 0x10..=0x12 | 0x14 | 0x5b..=0x5c | 0xa0..=0xa5),
                            typing_key: matches!(vk, 0x08 | 0x09 | 0x0d | 0x20 | 0x30..=0x39 | 0x41..=0x5a | 0x60..=0x6f | 0xba..=0xe2),
                            shortcut: is_shortcut(false, key_down(0x11),
                                key_down(0x5b) || key_down(0x5c), key_down(0x12), key_down(0xa5)),
                        });
                    }
                });
            }
        }
        // Always forward; the desktop pet never swallows or modifies an input event.
        unsafe { CallNextHookEx(null_mut(), code, wp, lp) }
    }

    unsafe extern "system" fn mouse_hook(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && lp != 0 {
            let data = unsafe { &*(lp as *const MSLLHOOKSTRUCT) };
            if data.flags & LLMHF_INJECTED == 0 {
                CONTEXT.with(|context| {
                    if let Some(state) = context.borrow().as_ref() {
                        match wp as u32 {
                            WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN => {
                                state.mouse_at(false, f64::from(data.pt.x), f64::from(data.pt.y))
                            }
                            WM_MOUSEWHEEL | WM_MOUSEHWHEEL => state.mouse(true),
                            _ => {}
                        }
                    }
                });
            }
        }
        unsafe { CallNextHookEx(null_mut(), code, wp, lp) }
    }

    pub(super) fn run(state: Arc<RunState>, config: InputConfig) -> Result<(), InputStatus> {
        if state.cancelled.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut message: MSG = unsafe { std::mem::zeroed() };
        // Create this thread's queue before publishing its stop waker.
        unsafe {
            PeekMessageW(&mut message, null_mut(), 0, 0, PM_NOREMOVE);
        }
        let thread_id = unsafe { GetCurrentThreadId() };
        state.install_waker(Box::new(move || unsafe {
            PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
        }));
        if state.cancelled.load(Ordering::Acquire) {
            return Ok(());
        }
        CONTEXT.with(|context| *context.borrow_mut() = Some(state.clone()));
        let module = unsafe { GetModuleHandleW(null()) };
        let keyboard = if config.keyboard {
            unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), module, 0) }
        } else {
            null_mut()
        };
        let mouse = if config.mouse_click || config.mouse_scroll {
            unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), module, 0) }
        } else {
            null_mut()
        };
        let installed = (!config.keyboard || !keyboard.is_null())
            && (!(config.mouse_click || config.mouse_scroll) || !mouse.is_null());
        let result = if !installed {
            Err(InputStatus::new(
                "error",
                "Windows 未能创建输入监听，请重试；安全桌面和其他登录会话不在监听范围内",
            ))
        } else {
            state.ready();
            loop {
                if state.cancelled.load(Ordering::Acquire) {
                    break Ok(());
                }
                let status = unsafe { GetMessageW(&mut message, null_mut(), 0, 0) };
                if status == -1 {
                    break Err(InputStatus::new(
                        "error",
                        "Windows 输入事件循环异常，请重试",
                    ));
                }
                if status == 0 {
                    break Ok(());
                }
                unsafe {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        };
        if !keyboard.is_null() {
            unsafe {
                UnhookWindowsHookEx(keyboard);
            }
        }
        if !mouse.is_null() {
            unsafe {
                UnhookWindowsHookEx(mouse);
            }
        }
        CONTEXT.with(|context| *context.borrow_mut() = None);
        *lock(&state.waker) = None;
        result
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod native {
    use super::*;
    pub(super) fn check_permission(_request: bool) -> Result<(), InputStatus> {
        Err(InputStatus::new(
            "unsupported",
            "当前版本支持 macOS 和 Windows",
        ))
    }
    pub(super) fn run(_state: Arc<RunState>, _config: InputConfig) -> Result<(), InputStatus> {
        check_permission(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{self, Receiver};

    fn disabled_config() -> InputConfig {
        InputConfig {
            keyboard: false,
            mouse_click: false,
            mouse_scroll: false,
            all_keys: false,
        }
    }

    fn permission_allowed(_request: bool) -> Result<(), InputStatus> {
        Ok(())
    }

    fn permission_allowed_without_prompt(request: bool) -> Result<(), InputStatus> {
        assert!(!request, "background recovery must never request permission");
        Ok(())
    }

    fn permission_denied(_request: bool) -> Result<(), InputStatus> {
        Err(InputStatus::new(
            "permission_required",
            "test permission is unavailable",
        ))
    }

    fn no_permission_check_expected(_request: bool) -> Result<(), InputStatus> {
        panic!("configuration must not attempt to start listening")
    }

    fn fake_native_run(state: Arc<RunState>, _config: InputConfig) -> Result<(), InputStatus> {
        let current = thread::current();
        state.install_waker(Box::new(move || current.unpark()));
        state.ready();
        while !state.cancelled.load(Ordering::Acquire) {
            thread::park_timeout(Duration::from_millis(100));
        }
        Ok(())
    }

    fn failed_native_run(_state: Arc<RunState>, _config: InputConfig) -> Result<(), InputStatus> {
        Err(InputStatus::new("error", "test native startup failed"))
    }

    fn fake_service() -> (InputService, Receiver<InputStatus>) {
        let (sender, receiver) = mpsc::channel();
        let mut service = InputService::new(
            |_| panic!("unexpected pulse"),
            move |status| {
                let _ = sender.send(status);
            },
        );
        service.backend = NativeBackend {
            check_permission: permission_allowed,
            run: fake_native_run,
        };
        (service, receiver)
    }

    fn wait_status(receiver: &Receiver<InputStatus>, expected: &str) -> Vec<InputStatus> {
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let mut seen = Vec::new();
        loop {
            let status = receiver
                .recv_timeout(deadline.saturating_duration_since(std::time::Instant::now()))
                .unwrap_or_else(|_| panic!("timed out waiting for {expected}; saw {seen:?}"));
            let matches = status.state == expected;
            seen.push(status);
            if matches {
                return seen;
            }
        }
    }

    fn typing(identity: usize) -> KeyActivity {
        KeyActivity {
            identity,
            down: true,
            repeated: false,
            modifier: false,
            typing_key: true,
            shortcut: false,
        }
    }

    #[test]
    fn held_keys_repeat_only_after_release() {
        let mut filter = PressFilter::default();
        let config = InputConfig::default();
        assert!(filter.accept(typing(2), config));
        for _ in 0..100 {
            assert!(!filter.accept(typing(2), config));
        }
        assert!(filter.accept(typing(3), config));
        assert!(!filter.accept(
            KeyActivity {
                down: false,
                ..typing(2)
            },
            config
        ));
        assert!(filter.accept(typing(2), config));
    }

    #[test]
    fn first_observed_autorepeat_is_not_counted() {
        let mut filter = PressFilter::default();
        assert!(!filter.accept(
            KeyActivity {
                repeated: true,
                ..typing(4)
            },
            InputConfig::default()
        ));
        assert!(!filter.accept(typing(4), InputConfig::default()));
    }

    #[test]
    fn modifiers_shortcuts_and_navigation_are_filtered_by_default() {
        let mut filter = PressFilter::default();
        let config = InputConfig::default();
        assert!(!filter.accept(
            KeyActivity {
                modifier: true,
                ..typing(1)
            },
            config
        ));
        assert!(!filter.accept(
            KeyActivity {
                shortcut: true,
                ..typing(2)
            },
            config
        ));
        assert!(!filter.accept(
            KeyActivity {
                typing_key: false,
                ..typing(3)
            },
            config
        ));
        assert!(!filter.accept(typing(5000), config));
        filter.clear();
        let all = InputConfig {
            all_keys: true,
            ..config
        };
        assert!(!filter.accept(
            KeyActivity {
                modifier: true,
                ..typing(1)
            },
            all
        ));
        assert!(filter.accept(
            KeyActivity {
                shortcut: true,
                ..typing(2)
            },
            all
        ));
        assert!(filter.accept(
            KeyActivity {
                typing_key: false,
                ..typing(3)
            },
            all
        ));
    }

    #[test]
    fn international_modifiers_do_not_block_typing() {
        assert!(!is_shortcut(true, false, false, true, false)); // Option accent
        assert!(!is_shortcut(false, true, false, true, true)); // AltGr
        assert!(is_shortcut(false, true, false, true, false)); // Ctrl+left Alt
        assert!(is_shortcut(false, true, true, true, true)); // Windows key still wins
        assert!(is_shortcut(true, false, true, false, false)); // Command
    }

    #[test]
    fn pulse_backlog_is_bounded_and_pause_discards_activity() {
        let service = InputService::new(|_| {}, |_| {});
        let run = RunState::new(service.shared.clone());
        run.ready();
        for _ in 0..10_000 {
            run.add_pulse();
        }
        assert_eq!(run.pending.swap(0, Ordering::AcqRel), MAX_PENDING_PULSES);
        service.shared.paused.store(true, Ordering::Release);
        run.add_pulse();
        assert_eq!(run.pending.load(Ordering::Acquire), 0);
        service.shared.paused.store(false, Ordering::Release);
        run.cancel();
        run.add_pulse();
        assert_eq!(run.pending.load(Ordering::Acquire), 0);
    }

    #[test]
    fn disabled_sources_do_not_produce_pulses() {
        let service = InputService::new(|_| {}, |_| {});
        let run = RunState::new(service.shared.clone());
        run.ready();
        run.mouse(false);
        run.mouse(true);
        assert_eq!(run.pending.load(Ordering::Acquire), 0);
        *lock(&service.shared.config) = InputConfig {
            keyboard: false,
            mouse_click: true,
            mouse_scroll: false,
            all_keys: false,
        };
        run.key(typing(2));
        run.mouse(false);
        run.mouse(true);
        assert_eq!(run.pending.load(Ordering::Acquire), 1);
    }

    #[test]
    fn pet_clicks_are_local_but_scroll_and_outside_clicks_still_follow() {
        let service = InputService::new(|_| {}, |_| {});
        *lock(&service.shared.config) = InputConfig { mouse_click: true, mouse_scroll: true, ..InputConfig::default() };
        service.set_pet_click_bounds(Some([-300.0, -100.0, -100.0, 100.0]));
        let run = RunState::new(service.shared.clone());
        run.ready();
        run.mouse_at(false, -200.0, 0.0);
        assert_eq!(run.pending.load(Ordering::Acquire), 0);
        run.mouse_at(true, -200.0, 0.0);
        run.mouse_at(false, -100.0, 0.0);
        assert_eq!(run.pending.swap(0, Ordering::AcqRel), 2);
        service.set_pet_click_bounds(None);
        run.mouse_at(false, -200.0, 0.0);
        assert_eq!(run.pending.load(Ordering::Acquire), 1);
    }

    #[test]
    fn stop_before_native_initialization_still_wakes_worker() {
        let service = InputService::new(|_| {}, |_| {});
        let run = RunState::new(service.shared.clone());
        let called = Arc::new(AtomicBool::new(false));
        run.cancel();
        let notified = called.clone();
        run.install_waker(Box::new(move || {
            notified.store(true, Ordering::Release);
        }));
        assert!(called.load(Ordering::Acquire));
        run.ready();
        assert!(!run.listening.load(Ordering::Acquire));
    }

    #[test]
    fn construction_configuration_and_empty_start_do_not_touch_system_apis() {
        fn send_sync<T: Send + Sync>() {}
        send_sync::<InputService>();
        let service = InputService::new(|_| panic!("unexpected pulse"), |_| {});
        assert_eq!(service.status().state, "ready");
        let config = InputConfig {
            keyboard: false,
            mouse_click: false,
            mouse_scroll: false,
            all_keys: true,
        };
        service.configure(config);
        assert_eq!(service.start(config, false).state, "disabled");
        assert!(lock(&service.session).is_none());
        service.stop();
        assert_eq!(service.status().state, "stopped");
    }

    #[test]
    fn stopped_session_cannot_overwrite_status_with_stale_failure() {
        let service = InputService::new(|_| {}, |_| {});
        let run = RunState::new(service.shared.clone());
        run.cancel();
        service.stop();
        run.fail(InputStatus::new("error", "stale worker failure"));
        assert_eq!(service.status().state, "stopped");
    }

    #[test]
    fn restoring_a_source_restarts_a_previously_running_listener() {
        let (service, states) = fake_service();
        service.start(InputConfig::default(), false);
        wait_status(&states, "listening");
        service.configure(disabled_config());
        wait_status(&states, "disabled");
        assert!(lock(&service.session).is_none());
        service.configure(InputConfig::default());
        wait_status(&states, "listening");
        assert!(lock(&service.session).is_some());
    }

    #[test]
    fn permission_grant_recovers_without_window_focus_or_prompt() {
        let (mut service, states) = fake_service();
        service.backend.check_permission = permission_denied;
        service.start(InputConfig::default(), false);
        wait_status(&states, "permission_required");
        service.refresh_permission();
        assert!(lock(&service.session).is_none());
        service.backend.check_permission = permission_allowed_without_prompt;
        service.refresh_permission();
        wait_status(&states, "listening");
        service.backend.check_permission = no_permission_check_expected;
        service.refresh_permission(); // Healthy sessions must remain intact.
        assert!(lock(&service.session).is_some());
        service.stop();
        service.refresh_permission(); // Explicit stop must stay stopped.
        assert!(lock(&service.session).is_none());
    }

    #[test]
    fn permission_recovery_preserves_pause_and_disabled_sources() {
        let (mut service, states) = fake_service();
        service.backend.check_permission = permission_denied;
        service.start(InputConfig::default(), false);
        wait_status(&states, "permission_required");
        service.set_paused(true);
        service.backend.check_permission = permission_allowed_without_prompt;
        service.refresh_permission();
        assert!(wait_status(&states, "paused").iter().all(|s| s.state != "listening"));
        service.configure(disabled_config());
        service.backend.check_permission = no_permission_check_expected;
        service.refresh_permission();
        assert_eq!(service.status().state, "disabled");
        assert!(lock(&service.session).is_none());
    }

    #[test]
    fn starting_with_sources_off_remembers_intent_without_checking_permission() {
        let (mut service, states) = fake_service();
        service.backend.check_permission = no_permission_check_expected;
        assert_eq!(service.start(disabled_config(), true).state, "disabled");
        wait_status(&states, "disabled");
        assert!(lock(&service.session).is_none());
        service.backend.check_permission = permission_allowed;
        service.configure(InputConfig::default());
        wait_status(&states, "listening");
    }

    #[test]
    fn configure_without_start_and_after_explicit_stop_never_starts_listener() {
        let (mut service, states) = fake_service();
        service.backend.check_permission = no_permission_check_expected;
        service.configure(disabled_config());
        service.configure(InputConfig::default());
        assert!(lock(&service.session).is_none());
        assert!(!service.wanted_running.load(Ordering::Acquire));
        service.backend.check_permission = permission_allowed;
        service.start(InputConfig::default(), false);
        wait_status(&states, "listening");
        service.stop();
        service.backend.check_permission = no_permission_check_expected;
        service.configure(disabled_config());
        service.configure(InputConfig::default());
        assert_eq!(service.status().state, "stopped");
        assert!(lock(&service.session).is_none());
        assert!(!service.wanted_running.load(Ordering::Acquire));
    }

    #[test]
    fn unpausing_does_not_claim_listening_when_disabled_denied_or_failed() {
        let (mut service, states) = fake_service();
        assert_eq!(service.start(disabled_config(), false).state, "disabled");
        service.set_paused(true);
        service.set_paused(false);
        assert_eq!(service.status().state, "disabled");
        service.backend.check_permission = permission_denied;
        assert_eq!(
            service.start(InputConfig::default(), false).state,
            "permission_required"
        );
        service.set_paused(true);
        service.set_paused(false);
        assert_eq!(service.status().state, "permission_required");
        service.backend = NativeBackend {
            check_permission: permission_allowed,
            run: failed_native_run,
        };
        service.start(InputConfig::default(), false);
        wait_status(&states, "error");
        service.set_paused(true);
        service.set_paused(false);
        assert_eq!(service.status().state, "error");
    }

    #[test]
    fn retry_and_restored_sources_preserve_pause_without_listening_transition() {
        let (service, states) = fake_service();
        service.set_paused(true);
        service.start(InputConfig::default(), false);
        assert!(wait_status(&states, "paused")
            .iter()
            .all(|status| status.state != "listening"));
        service.start(InputConfig::default(), false);
        assert!(wait_status(&states, "paused")
            .iter()
            .all(|status| status.state != "listening"));
        service.configure(disabled_config());
        wait_status(&states, "disabled");
        service.configure(InputConfig::default());
        assert!(wait_status(&states, "paused")
            .iter()
            .all(|status| status.state != "listening"));
        service.set_paused(false);
        wait_status(&states, "listening");
    }

    #[test]
    fn a_pause_refresh_cannot_resurrect_failed_native_state() {
        let service = InputService::new(|_| {}, |_| {});
        let state = RunState::new(service.shared.clone());
        state.ready();
        state.fail(InputStatus::new("error", "test native failure"));
        state.refresh_pause_state();
        assert!(!state.listening.load(Ordering::Acquire));
        assert_eq!(service.status().state, "error");
    }

    #[test]
    fn session_stop_wakes_and_joins_both_threads_without_native_input() {
        let service = InputService::new(|_| panic!("unexpected pulse"), |_| {});
        let state = Arc::new(RunState::new(service.shared.clone()));
        let native_state = state.clone();
        let finished = Arc::new(AtomicBool::new(false));
        let native_finished = finished.clone();
        let native = thread::spawn(move || {
            let current = thread::current();
            native_state.install_waker(Box::new(move || current.unpark()));
            while !native_state.cancelled.load(Ordering::Acquire) {
                thread::park_timeout(Duration::from_millis(100));
            }
            native_finished.store(true, Ordering::Release);
        });
        let dispatch_state = state.clone();
        let dispatch = thread::spawn(move || dispatch_state.dispatch());
        Session {
            state: state.clone(),
            native,
            dispatch,
        }
        .stop();
        assert!(state.cancelled.load(Ordering::Acquire));
        assert!(finished.load(Ordering::Acquire));
    }
}
