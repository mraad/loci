#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use loci_core::{Store, desktop_data_dir, index_ollama, read_vault};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

type Shared = Arc<Mutex<Store>>;
#[tauri::command]
async fn loci(
    operation: String,
    params: Value,
    store: tauri::State<'_, Shared>,
    app: tauri::AppHandle,
) -> Result<Value, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let work = || -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
            match operation.as_str() {
                "capabilities" => return Ok(json!({"platform":std::env::consts::OS,"rust":true})),
                "setTheme" => {
                    let theme = match params["theme"].as_str() {
                        Some("light") => tauri::Theme::Light,
                        Some("dark") => tauri::Theme::Dark,
                        _ => return Err("Choose a light or dark theme".into()),
                    };
                    app.set_theme(Some(theme));
                    return Ok(json!(true));
                }
                "importVault" => {
                    let Some(path) = app.dialog().file().blocking_pick_folder() else {
                        return Ok(Value::Null);
                    };
                    return Ok(read_vault(&path.into_path()?)?);
                }
                "importAppleNotes" => return apple_notes(),
                "exportLibrary" => {
                    let Some(path) = app
                        .dialog()
                        .file()
                        .add_filter("Loci collection", &["json"])
                        .set_file_name("loci-library.json")
                        .blocking_save_file()
                    else {
                        return Ok(json!(false));
                    };
                    let notes = store.lock().map_err(|_| "Storage unavailable")?.notes()?;
                    std::fs::write(
                        path.into_path()?,
                        serde_json::to_vec_pretty(&json!({"version":1,"notes":notes}))?,
                    )?;
                    return Ok(json!(true));
                }
                "openSource" => {
                    let url = params["url"].as_str().ok_or("Invalid source URL")?;
                    if !url.starts_with("https://") && !url.starts_with("http://") {
                        return Err("Only HTTP(S) source links are allowed".into());
                    }
                    app.opener().open_url(url, None::<String>)?;
                    return Ok(json!(true));
                }
                "indexSemantics" => {
                    let notes = store.lock().map_err(|_| "Storage unavailable")?.notes()?;
                    let indexed = index_ollama(&notes)?;
                    return Ok(store
                        .lock()
                        .map_err(|_| "Storage unavailable")?
                        .save_embeddings(indexed)?);
                }
                _ => {}
            }
            Ok(store
                .lock()
                .map_err(|_| "Storage unavailable")?
                .request(&operation, params)?)
        };
        work().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn apple_notes() -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    // A fixed read-only script goes through stdin; imported text never becomes executable code.
    let mut child = Command::new("/usr/bin/osascript")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .ok_or("Apple Notes importer could not start")?
        .write_all(include_str!("../../assets/apple-notes.applescript").as_bytes())?;
    let result = child.wait_with_output()?;
    if !result.status.success() {
        return Err(format!(
            "Apple Notes access failed: {}",
            String::from_utf8_lossy(&result.stderr)
        )
        .into());
    }
    let data: Value = serde_json::from_slice(&result.stdout)?;
    if !data["notes"].is_array() {
        return Err("Apple Notes returned invalid data".into());
    }
    Ok(json!({"appleNotes":data["notes"],"skipped":data["skipped"]}))
}
#[cfg(not(target_os = "macos"))]
fn apple_notes() -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    Err("Apple Notes import requires macOS; import a Loci backup on this platform".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let directory = desktop_data_dir()?;
            let store = Store::open(
                &directory.join("loci-rust.sqlite"),
                Some(&directory.join("loci.sqlite")),
            )?;
            app.manage(Arc::new(Mutex::new(store)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![loci])
        .run(tauri::generate_context!())
        .expect("Loci could not start");
}
