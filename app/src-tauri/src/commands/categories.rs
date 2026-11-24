use super::{db_err, AppState};
use crate::models::Category;
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

const CATEGORY_SELECT: &str = "SELECT id, name, sort_order FROM categories";

#[tauri::command]
pub async fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    sqlx::query_as::<_, Category>(&format!("{CATEGORY_SELECT} ORDER BY sort_order, name"))
        .fetch_all(&state.pool)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn create_category(state: State<'_, AppState>, name: String) -> Result<Category, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("分类名不能为空".to_string());
    }
    let existing = sqlx::query_as::<_, Category>(&format!("{CATEGORY_SELECT} WHERE name = ?"))
        .bind(&name)
        .fetch_optional(&state.pool)
        .await
        .map_err(db_err)?;
    if let Some(category) = existing {
        return Ok(category);
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now();
    let next_order: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories")
        .fetch_one(&state.pool)
        .await
        .map_err(db_err)?;
    sqlx::query(
        "INSERT INTO categories (id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&name)
    .bind(next_order)
    .bind(now)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(db_err)?;

    Ok(Category { id, name, sort_order: next_order })
}

#[tauri::command]
pub async fn rename_category(state: State<'_, AppState>, category_id: String, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("分类名不能为空".to_string());
    }
    sqlx::query("UPDATE categories SET name = ?, updated_at = ? WHERE id = ?")
        .bind(name)
        .bind(Utc::now())
        .bind(&category_id)
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// Feeds in the category become uncategorized; nothing is deleted.
#[tauri::command]
pub async fn delete_category(state: State<'_, AppState>, category_id: String) -> Result<(), String> {
    let mut tx = state.pool.begin().await.map_err(db_err)?;
    sqlx::query("UPDATE feeds SET category_id = NULL WHERE category_id = ?")
        .bind(&category_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("UPDATE categories SET parent_id = NULL WHERE parent_id = ?")
        .bind(&category_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM categories WHERE id = ?")
        .bind(&category_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)
}

#[tauri::command]
pub async fn reorder_categories(state: State<'_, AppState>, ordered_ids: Vec<String>) -> Result<(), String> {
    let mut tx = state.pool.begin().await.map_err(db_err)?;
    for (index, id) in ordered_ids.iter().enumerate() {
        sqlx::query("UPDATE categories SET sort_order = ? WHERE id = ?")
            .bind(index as i64)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    tx.commit().await.map_err(db_err)
}
