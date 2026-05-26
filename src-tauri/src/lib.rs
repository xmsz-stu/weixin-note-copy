use base64::{engine::general_purpose, Engine as _};
use std::{fs, path::PathBuf};

#[tauri::command]
fn local_image_to_data_url(src: String) -> Result<String, String> {
  let path = src_to_path(&src)?;
  let bytes = fs::read(&path).map_err(|error| format!("读取失败 ({error})"))?;
  let mime_type = mime_type_for_path(&path);
  let encoded = general_purpose::STANDARD.encode(bytes);

  Ok(format!("data:{mime_type};base64,{encoded}"))
}

fn src_to_path(src: &str) -> Result<PathBuf, String> {
  let decoded = decode_html_attr(src.trim());
  let without_file_scheme = decoded
    .strip_prefix("file://")
    .or_else(|| decoded.strip_prefix("file:"))
    .unwrap_or(&decoded);

  if without_file_scheme.is_empty() {
    return Err("图片路径为空".to_string());
  }

  Ok(PathBuf::from(without_file_scheme))
}

fn decode_html_attr(value: &str) -> String {
  value
    .replace("&amp;", "&")
    .replace("&quot;", "\"")
    .replace("&#34;", "\"")
    .replace("&apos;", "'")
    .replace("&#39;", "'")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
}

fn mime_type_for_path(path: &PathBuf) -> &'static str {
  match path
    .extension()
    .and_then(|extension| extension.to_str())
    .map(|extension| extension.to_ascii_lowercase())
    .as_deref()
  {
    Some("apng") => "image/apng",
    Some("avif") => "image/avif",
    Some("bmp") => "image/bmp",
    Some("gif") => "image/gif",
    Some("jpg") | Some("jpeg") => "image/jpeg",
    Some("png") => "image/png",
    Some("svg") => "image/svg+xml",
    Some("webp") => "image/webp",
    _ => "application/octet-stream",
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![local_image_to_data_url])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
