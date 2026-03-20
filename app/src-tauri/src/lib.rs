mod commands;
mod db;
mod models;
mod services;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let pool = tauri::async_runtime::block_on(db::init_db(app.handle()))
                .map_err(std::io::Error::other)?;
            app.manage(commands::AppState { pool });
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_setting,
            commands::set_setting,
            commands::list_categories,
            commands::create_category,
            commands::update_category_name,
            commands::delete_category,
            commands::list_feeds,
            commands::create_feed,
            commands::update_feed,
            commands::update_feed_category,
            commands::update_feed_favicon,
            commands::delete_feed,
            commands::list_articles,
            commands::fetch_article_content,
            commands::analyze_article,
            commands::list_article_ai_analyses,
            commands::update_article_progress,
            commands::update_article_flags,
            commands::fetch_feed_articles,
            commands::suggest_source_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
