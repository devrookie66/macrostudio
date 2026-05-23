mod recorder;
mod premium;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Start global OS-level input listener in a background thread
    recorder::init_listener();

    tauri::Builder::default()
        .setup(|app| {
            recorder::set_app_handle(app.handle().clone());
            premium::set_app_handle(app.handle().clone());
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            recorder::start_record_cmd,
            recorder::stop_record_cmd,
            recorder::play_macro_cmd,
            recorder::stop_playback_cmd,
            recorder::set_record_mouse_movement,
            recorder::inject_macro_event,
            recorder::set_trigger_combo,
            recorder::set_macro_active,
            recorder::set_block_trigger_input,
            recorder::set_active_triggers,
            recorder::set_emergency_config,
            #[cfg(feature = "premium")]
            premium::scripting::start_script_cmd,
            #[cfg(feature = "premium")]
            premium::scripting::stop_script_cmd,
            #[cfg(feature = "premium")]
            premium::scripting::validate_script_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
