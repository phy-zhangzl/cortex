pub mod ai;
pub mod articles;
pub mod categories;
pub mod feeds;
pub mod settings;

use reqwest::Client;
use sqlx::SqlitePool;

pub struct AppState {
    pub pool: SqlitePool,
    pub http: Client,
}

pub(crate) fn db_err(e: sqlx::Error) -> String {
    e.to_string()
}
