mod commands;
mod db;
mod models;
mod services;

use commands::{ai, articles, categories, feeds, settings, AppState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let pool = tauri::async_runtime::block_on(async {
                let pool = db::init_db(app.handle()).await?;
                articles::prune(&pool).await?;
                Ok::<_, String>(pool)
            })
            .map_err(std::io::Error::other)?;
            app.manage(AppState {
                pool,
                http: services::feed_service::build_client(),
            });
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            settings::get_setting,
            settings::set_setting,
            categories::list_categories,
            categories::create_category,
            categories::rename_category,
            categories::delete_category,
            categories::reorder_categories,
            feeds::list_feeds,
            feeds::discover_feed,
            feeds::create_feed,
            feeds::import_feeds,
            feeds::update_feed,
            feeds::move_feed,
            feeds::delete_feed,
            feeds::sync_feeds,
            feeds::export_opml,
            feeds::export_files,
            feeds::feed_health,
            articles::list_articles,
            articles::get_counts,
            articles::get_article,
            articles::load_full_content,
            articles::set_read,
            articles::mark_scope_read,
            articles::set_favorite,
            articles::set_read_later,
            articles::update_progress,
            articles::fetch_image,
            articles::save_archive,
            ai::get_llm_config,
            ai::list_llm_models,
            ai::translate_text,
            ai::summarize_article,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
