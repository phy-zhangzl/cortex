mod commands;
mod db;
mod models;
mod services;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Define database migrations
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: include_str!("../migrations/001_initial_schema.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .setup(|app| {
            let pool = tauri::async_runtime::block_on(db::init_db(app.handle()))
                .map_err(std::io::Error::other)?;
            app.manage(commands::AppState { pool });
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:cortex.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::list_categories,
            commands::create_category,
            commands::update_category_name,
            commands::delete_category,
            commands::list_feeds,
            commands::create_feed,
            commands::update_feed_category,
            commands::delete_feed,
            commands::list_articles,
            commands::fetch_article_content,
            commands::update_article_progress,
            commands::update_article_flags,
            commands::fetch_feed_articles,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
