use device_query::DeviceQuery;
use once_cell::sync::OnceCell;
use rdev::{Event, EventType};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct MacroEvent {
    pub event_type: EventType,
    pub delay: u64,
}

// AtomicBool = lock-free reads in hot path
static IS_RECORDING: AtomicBool = AtomicBool::new(false);
static IS_PLAYING: AtomicBool = AtomicBool::new(false);
static RECORD_MOUSE: AtomicBool = AtomicBool::new(false);
static IS_MACRO_ACTIVE: AtomicBool = AtomicBool::new(false);
static BLOCK_TRIGGER_INPUT: AtomicBool = AtomicBool::new(false);
static EMERGENCY_FALLBACK: AtomicBool = AtomicBool::new(true);
static EMERGENCY_HOLD_TICKS_REQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(166);


#[derive(Clone, Debug, PartialEq)]
pub enum TriggerInput {
    Key(device_query::Keycode),
    Mouse(usize),
}

lazy_static::lazy_static! {
    static ref ACTIVE_TRIGGERS: Mutex<std::collections::HashMap<String, Vec<TriggerInput>>> = Mutex::new(std::collections::HashMap::new());
    static ref EMERGENCY_KEY: Mutex<device_query::Keycode> = Mutex::new(device_query::Keycode::Escape);
}

// OnceLock sender: rdev callback reads with NO mutex at all
static EVENT_TX: OnceCell<std::sync::mpsc::SyncSender<Event>> = OnceCell::new();

static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);
static LAST_EVENT_TIME: Mutex<Option<Instant>> = Mutex::new(None);

// ─── Init ─────────────────────────────────────────────────────────────────────

pub fn set_app_handle(app: AppHandle) {
    *APP_HANDLE.lock().unwrap() = Some(app);
}

pub fn init_listener() {
    // Bounded sync channel — try_send never blocks the hook thread
    let (tx, rx) = std::sync::mpsc::sync_channel::<Event>(4096);
    EVENT_TX.set(tx).ok();

// rdev thread: hook callback must return immediately on Windows
    std::thread::spawn(|| {
        if let Err(e) = rdev::grab(rdev_grab_callback) {
            eprintln!("[rdev] error: {:?}", e);
        }
    });

    // Processing thread: all mutex work done here, not in the hook
    std::thread::spawn(move || {
        for event in rx {
            process_event(event);
        }
    });

    // Fallback global ESC detector & Global Trigger Key detector using device_query
    std::thread::spawn(move || {
        let device_state = device_query::DeviceState::new();
        let mut last_triggered_id: Option<String> = None;

let mut esc_hold_ticks = 0;

        loop {
            let is_rec = IS_RECORDING.load(Ordering::Relaxed);
            let is_play = IS_PLAYING.load(Ordering::Relaxed);
            let keys = device_state.get_keys();
            let mouse = device_state.get_mouse();

            if EMERGENCY_FALLBACK.load(Ordering::Relaxed) && (IS_MACRO_ACTIVE.load(Ordering::Relaxed) || crate::premium::is_script_running()) {
                let e_key = *EMERGENCY_KEY.lock().unwrap();
                let e_ticks = EMERGENCY_HOLD_TICKS_REQ.load(Ordering::Relaxed);
                
                if keys.contains(&e_key) {
                    esc_hold_ticks += 1;
                    if esc_hold_ticks >= e_ticks { // Dynamic hold ticks
                        IS_MACRO_ACTIVE.store(false, Ordering::SeqCst);
                        IS_PLAYING.store(false, Ordering::SeqCst); // Force stop playback immediately
                        crate::premium::stop_script(); // Force stop Lua scripting immediately
                        if let Some(app) = APP_HANDLE.lock().unwrap().as_ref() {
                            let _ = app.emit("emergency-disabled", ());
                        }
                        esc_hold_ticks = 0;
                    }
                } else {
                    esc_hold_ticks = 0;
                }
            }

            if is_rec {
                if keys.contains(&device_query::Keycode::Escape) {
                    IS_RECORDING.store(false, Ordering::SeqCst);
                    if let Some(app) = APP_HANDLE.lock().unwrap().as_ref() {
                        let _ = app.emit("recording-stopped", ());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
            } else if !is_play && IS_MACRO_ACTIVE.load(Ordering::Relaxed) {
                let triggers = ACTIVE_TRIGGERS.lock().unwrap().clone();
                let mut triggered_now: Option<String> = None;
                
                for (id, combo) in &triggers {
                    if combo.is_empty() { continue; }
                    let mut all_pressed = true;
                    for input in combo {
                        match input {
                            TriggerInput::Key(k) => {
                                if !keys.contains(k) {
                                    all_pressed = false;
                                    break;
                                }
                            }
                            TriggerInput::Mouse(btn_idx) => {
                                if mouse.button_pressed.len() <= *btn_idx
                                    || !mouse.button_pressed[*btn_idx]
                                {
                                    all_pressed = false;
                                    break;
                                }
                            }
                        }
                    }
                    if all_pressed {
                        triggered_now = Some(id.clone());
                        break;
                    }
                }

                if let Some(app) = APP_HANDLE.lock().unwrap().as_ref() {
                    match (&last_triggered_id, &triggered_now) {
                        (None, Some(new_id)) => {
                            let _ = app.emit("macro-triggered", new_id);
                        }
                        (Some(old_id), None) => {
                            let _ = app.emit("macro-trigger-released", old_id);
                        }
                        (Some(old_id), Some(new_id)) => {
                            if old_id != new_id {
                                let _ = app.emit("macro-trigger-released", old_id);
                                let _ = app.emit("macro-triggered", new_id);
                            }
                        }
                        (None, None) => {}
                    }
                }
                last_triggered_id = triggered_now;
            }
            std::thread::sleep(std::time::Duration::from_millis(30)); // 30ms = very lightweight
        }
    });
}

lazy_static::lazy_static! {
    static ref SWALLOWED_KEYS: Mutex<Vec<TriggerInput>> = Mutex::new(Vec::new());
    static ref RDEV_IS_TRIGGERED: AtomicBool = AtomicBool::new(false);
}

// ─── rdev Callback — completely lock-free ─────────────────────────────────────

fn rdev_grab_callback(event: Event) -> Option<Event> {
    if IS_RECORDING.load(Ordering::Relaxed) {
        if let Some(tx) = EVENT_TX.get() {
            let _ = tx.try_send(event.clone()); // non-blocking, drops if channel full
        }
        return Some(event);
    }

    if BLOCK_TRIGGER_INPUT.load(Ordering::Relaxed) && IS_MACRO_ACTIVE.load(Ordering::Relaxed) {
        let is_esc = matches!(event.event_type, EventType::KeyPress(rdev::Key::Escape) | EventType::KeyRelease(rdev::Key::Escape));
        if !is_esc {
            let is_press = matches!(event.event_type, EventType::KeyPress(_) | EventType::ButtonPress(_));
            let is_release = matches!(event.event_type, EventType::KeyRelease(_) | EventType::ButtonRelease(_));
            
            let dq_key = match &event.event_type {
                EventType::KeyPress(k) | EventType::KeyRelease(k) => map_rdev_to_dq(k),
                EventType::ButtonPress(b) | EventType::ButtonRelease(b) => map_rdev_btn_to_dq(b),
                _ => None,
            };

            if let Some(dq) = dq_key {
                let triggers = ACTIVE_TRIGGERS.lock().unwrap().clone();
                let mut matched_combo = None;
                for (_, combo) in &triggers {
                    if combo.contains(&dq) {
                        matched_combo = Some(combo.clone());
                        break;
                    }
                }
                
                if let Some(triggers) = matched_combo {
                    if is_press {
                        let mut all_other_pressed = true;
                        let device_state = device_query::DeviceState::new();
                        let keys = device_state.get_keys();
                        let mouse = device_state.get_mouse();
                        for t in &triggers {
                            if *t == dq { continue; }
                            match t {
                                TriggerInput::Key(k) => if !keys.contains(k) { all_other_pressed = false; break; },
                                TriggerInput::Mouse(m) => if mouse.button_pressed.len() <= *m || !mouse.button_pressed[*m] { all_other_pressed = false; break; },
                            }
                        }

                        if all_other_pressed {
                            SWALLOWED_KEYS.lock().unwrap().push(dq.clone());
                            RDEV_IS_TRIGGERED.store(true, Ordering::SeqCst);
                            return None;
                        }
                    } else if is_release {
                        let mut swallowed = SWALLOWED_KEYS.lock().unwrap();
                        let was_swallowed = if let Some(pos) = swallowed.iter().position(|x| *x == dq) {
                            swallowed.remove(pos);
                            true
                        } else {
                            false
                        };

                        RDEV_IS_TRIGGERED.store(false, Ordering::SeqCst);

                        if was_swallowed {
                            return None;
                        }
                    }
                }
            }
        }
    }

    Some(event)
}

fn map_rdev_to_dq(k: &rdev::Key) -> Option<TriggerInput> {
    use rdev::Key as RK;
    use device_query::Keycode as DK;
    let dk = match k {
        RK::Alt => DK::LAlt,
        RK::AltGr => DK::RAlt,
        RK::Backspace => DK::Backspace,
        RK::CapsLock => DK::CapsLock,
        RK::ControlLeft => DK::LControl,
        RK::ControlRight => DK::RControl,
        RK::Delete => DK::Delete,
        RK::DownArrow => DK::Down,
        RK::End => DK::End,
        RK::Escape => DK::Escape,
        RK::F1 => DK::F1, RK::F2 => DK::F2, RK::F3 => DK::F3, RK::F4 => DK::F4, RK::F5 => DK::F5, RK::F6 => DK::F6,
        RK::F7 => DK::F7, RK::F8 => DK::F8, RK::F9 => DK::F9, RK::F10 => DK::F10, RK::F11 => DK::F11, RK::F12 => DK::F12,
        RK::Home => DK::Home,
        RK::LeftArrow => DK::Left,
        RK::MetaLeft => DK::LMeta,
        RK::MetaRight => DK::RMeta,
        RK::PageDown => DK::PageDown,
        RK::PageUp => DK::PageUp,
        RK::Return => DK::Enter,
        RK::RightArrow => DK::Right,
        RK::ShiftLeft => DK::LShift,
        RK::ShiftRight => DK::RShift,
        RK::Space => DK::Space,
        RK::Tab => DK::Tab,
        RK::UpArrow => DK::Up,
        RK::BackQuote => DK::Grave,
        RK::Num0 => DK::Key0, RK::Num1 => DK::Key1, RK::Num2 => DK::Key2, RK::Num3 => DK::Key3, RK::Num4 => DK::Key4,
        RK::Num5 => DK::Key5, RK::Num6 => DK::Key6, RK::Num7 => DK::Key7, RK::Num8 => DK::Key8, RK::Num9 => DK::Key9,
        RK::KeyA => DK::A, RK::KeyB => DK::B, RK::KeyC => DK::C, RK::KeyD => DK::D, RK::KeyE => DK::E, RK::KeyF => DK::F, RK::KeyG => DK::G,
        RK::KeyH => DK::H, RK::KeyI => DK::I, RK::KeyJ => DK::J, RK::KeyK => DK::K, RK::KeyL => DK::L, RK::KeyM => DK::M, RK::KeyN => DK::N,
        RK::KeyO => DK::O, RK::KeyP => DK::P, RK::KeyQ => DK::Q, RK::KeyR => DK::R, RK::KeyS => DK::S, RK::KeyT => DK::T, RK::KeyU => DK::U,
        RK::KeyV => DK::V, RK::KeyW => DK::W, RK::KeyX => DK::X, RK::KeyY => DK::Y, RK::KeyZ => DK::Z,
        _ => return None,
    };
    Some(TriggerInput::Key(dk))
}

fn map_rdev_btn_to_dq(b: &rdev::Button) -> Option<TriggerInput> {
    match b {
        rdev::Button::Left => Some(TriggerInput::Mouse(1)),
        rdev::Button::Right => Some(TriggerInput::Mouse(2)),
        rdev::Button::Middle => Some(TriggerInput::Mouse(3)),
        _ => None,
    }
}

// removed is_event_trigger

// ─── Event Processing (runs in dedicated thread) ──────────────────────────────

fn process_event(event: Event) {
    // Route to active Lua scripting thread if scripting is running
    crate::premium::route_script_event(&event);

    // ESC → stop recording
    let is_esc =
        matches!(&event.event_type, EventType::KeyPress(k) if format!("{:?}", k) == "Escape");
    if is_esc && IS_RECORDING.load(Ordering::Relaxed) {
        IS_RECORDING.store(false, Ordering::SeqCst);
        if let Some(app) = APP_HANDLE.lock().unwrap().as_ref() {
            let _ = app.emit("recording-stopped", ());
        }
        return;
    }

    if !IS_RECORDING.load(Ordering::Relaxed) {
        return;
    }

    // Optionally ignore mouse movement
    if matches!(&event.event_type, EventType::MouseMove { .. }) {
        if !RECORD_MOUSE.load(Ordering::Relaxed) {
            return;
        }
    }

    let delay = {
        let mut last = LAST_EVENT_TIME.lock().unwrap();
        let elapsed = last.map(|t| t.elapsed().as_millis() as u64).unwrap_or(0);
        *last = Some(Instant::now());
        elapsed
    };

    let macro_event = MacroEvent {
        event_type: event.event_type,
        delay,
    };

    if let Some(app) = APP_HANDLE.lock().unwrap().as_ref() {
        let _ = app.emit("macro-event", macro_event);
    }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn start_record_cmd() {
    *LAST_EVENT_TIME.lock().unwrap() = Some(Instant::now());
    IS_RECORDING.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn stop_record_cmd() {
    IS_RECORDING.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn set_record_mouse_movement(enabled: bool) {
    RECORD_MOUSE.store(enabled, Ordering::SeqCst);
}

fn map_dom_code_to_keycode(s: &str) -> Option<device_query::Keycode> {
    use device_query::Keycode::*;
    let mapped = match s {
        "ControlLeft" => LControl,
        "ControlRight" => RControl,
        "ShiftLeft" => LShift,
        "ShiftRight" => RShift,
        "AltLeft" => LAlt,
        "AltRight" => RAlt,
        "Space" => Space,
        "Enter" => Enter,
        "Escape" => Escape,
        "Tab" => Tab,
        "Backspace" => Backspace,
        "ArrowUp" => Up,
        "ArrowDown" => Down,
        "ArrowLeft" => Left,
        "ArrowRight" => Right,
        _ => {
            if s.starts_with("Key") && s.len() == 4 {
                let c = s.chars().nth(3).unwrap();
                match c {
                    'A' => A,
                    'B' => B,
                    'C' => C,
                    'D' => D,
                    'E' => E,
                    'F' => F,
                    'G' => G,
                    'H' => H,
                    'I' => I,
                    'J' => J,
                    'K' => K,
                    'L' => L,
                    'M' => M,
                    'N' => N,
                    'O' => O,
                    'P' => P,
                    'Q' => Q,
                    'R' => R,
                    'S' => S,
                    'T' => T,
                    'U' => U,
                    'V' => V,
                    'W' => W,
                    'X' => X,
                    'Y' => Y,
                    'Z' => Z,
                    _ => return None,
                }
            } else if s.starts_with("Digit") && s.len() == 6 {
                let c = s.chars().nth(5).unwrap();
                match c {
                    '0' => Key0,
                    '1' => Key1,
                    '2' => Key2,
                    '3' => Key3,
                    '4' => Key4,
                    '5' => Key5,
                    '6' => Key6,
                    '7' => Key7,
                    '8' => Key8,
                    '9' => Key9,
                    _ => return None,
                }
            } else if s.starts_with("Numpad") && s.len() == 7 {
                let c = s.chars().nth(6).unwrap();
                match c {
                    '0' => Numpad0,
                    '1' => Numpad1,
                    '2' => Numpad2,
                    '3' => Numpad3,
                    '4' => Numpad4,
                    '5' => Numpad5,
                    '6' => Numpad6,
                    '7' => Numpad7,
                    '8' => Numpad8,
                    '9' => Numpad9,
                    _ => return None,
                }
            } else {
                return None;
            }
        }
    };
    Some(mapped)
}

#[tauri::command]
pub fn set_trigger_combo(combo: Vec<String>) {
    let mut inputs = Vec::new();
    for c in combo {
        if c.starts_with("MouseBtn") {
            let idx = c.replace("MouseBtn", "").parse::<usize>().unwrap_or(0);
            inputs.push(TriggerInput::Mouse(idx));
        } else if let Some(k) = map_dom_code_to_keycode(&c) {
            inputs.push(TriggerInput::Key(k));
        }
    }
    // Backward compatibility if needed, or just map it to ACTIVE_TRIGGERS
    let mut map = std::collections::HashMap::new();
    map.insert("legacy".to_string(), inputs);
    *ACTIVE_TRIGGERS.lock().unwrap() = map;
}

#[tauri::command]
pub fn set_active_triggers(triggers: std::collections::HashMap<String, Vec<String>>) {
    let mut map = std::collections::HashMap::new();
    for (id, combo_strs) in triggers {
        let mut inputs = Vec::new();
        for c in combo_strs {
            if c.starts_with("MouseBtn") {
                let idx = c.replace("MouseBtn", "").parse::<usize>().unwrap_or(0);
                inputs.push(TriggerInput::Mouse(idx));
            } else if let Some(k) = map_dom_code_to_keycode(&c) {
                inputs.push(TriggerInput::Key(k));
            }
        }
        map.insert(id, inputs);
    }
    *ACTIVE_TRIGGERS.lock().unwrap() = map;
}

#[tauri::command]
pub fn set_macro_active(active: bool) {
    IS_MACRO_ACTIVE.store(active, Ordering::SeqCst);
}

#[tauri::command]
pub fn inject_macro_event(event_type: serde_json::Value) {
    if !IS_RECORDING.load(Ordering::Relaxed) {
        return;
    }

    // Convert JSON Value to rdev::EventType
    if let Ok(ev_type) = serde_json::from_value::<EventType>(event_type) {
        let delay = {
            let mut last = LAST_EVENT_TIME.lock().unwrap();
            let elapsed = last.map(|t| t.elapsed().as_millis() as u64).unwrap_or(0);
            *last = Some(Instant::now());
            elapsed
        };

        let macro_event = MacroEvent {
            event_type: ev_type,
            delay,
        };

        if let Some(app) = APP_HANDLE.lock().unwrap().as_ref() {
            let _ = app.emit("macro-event", macro_event);
        }
    }
}

#[tauri::command]
pub fn play_macro_cmd(events: Vec<MacroEvent>) {
    if IS_PLAYING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app_handle = APP_HANDLE.lock().unwrap().clone();
    std::thread::spawn(move || {
        if let Some(app) = &app_handle {
            let _ = app.emit("playback-state", true);
        }
        for event in &events {
            if !IS_PLAYING.load(Ordering::Relaxed) {
                break;
            }
            // Interruptible sleep logic
            let delay_ms = event.delay;
            let chunks = delay_ms / 10;
            let remainder = delay_ms % 10;
            for _ in 0..chunks {
                if !IS_PLAYING.load(Ordering::Relaxed) { break; }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            if IS_PLAYING.load(Ordering::Relaxed) && remainder > 0 {
                std::thread::sleep(std::time::Duration::from_millis(remainder));
            }

            if !IS_PLAYING.load(Ordering::Relaxed) {
                break;
            }
            let _ = rdev::simulate(&event.event_type);
        }
        IS_PLAYING.store(false, Ordering::SeqCst);
        if let Some(app) = &app_handle {
            let _ = app.emit("playback-state", false);
        }
    });
}

#[tauri::command]
pub fn stop_playback_cmd() {
    IS_PLAYING.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub fn set_block_trigger_input(enabled: bool) {
    BLOCK_TRIGGER_INPUT.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
pub fn set_emergency_config(enabled: bool, key: String, duration: u64) {
    EMERGENCY_FALLBACK.store(enabled, Ordering::Relaxed);
    
    // Parse the JS key string back into device_query::Keycode
    if let Some(k) = map_dom_code_to_keycode(&key) {
        *EMERGENCY_KEY.lock().unwrap() = k;
    }
    
    // Convert duration (ms) to ticks (30ms per tick)
    let ticks = duration / 30;
    EMERGENCY_HOLD_TICKS_REQ.store(ticks, Ordering::Relaxed);
}
// End of recorder module
