use super::{db_err, AppState};
use crate::models::Collection;
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

const COLLECTION_SELECT: &str = "SELECT c.id, c.name, c.sort_order, \
    (SELECT COUNT(*) FROM articles a WHERE a.collection_id = c.id AND a.is_favorite = 1) AS count \
    FROM collections c";

#[tauri::command]
pub async fn list_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    sqlx::query_as::<_, Collection>(&format!("{COLLECTION_SELECT} ORDER BY c.sort_order, c.name"))
        .fetch_all(&state.pool)
        .await
        .map_err(db_err)
}

#[tauri::command]
pub async fn create_collection(state: State<'_, AppState>, name: String) -> Result<Collection, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("收藏夹名称不能为空".to_string());
    }
    if let Some(existing) = sqlx::query_as::<_, Collection>(&format!("{COLLECTION_SELECT} WHERE c.name = ?"))
        .bind(&name)
        .fetch_optional(&state.pool)
        .await
        .map_err(db_err)?
    {
        return Ok(existing);
    }
    let id = Uuid::new_v4().to_string();
    let order: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM collections")
        .fetch_one(&state.pool)
        .await
        .map_err(db_err)?;
    sqlx::query("INSERT INTO collections (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(&name)
        .bind(order)
        .bind(Utc::now())
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    Ok(Collection { id, name, sort_order: order, count: 0 })
}

#[tauri::command]
pub async fn rename_collection(state: State<'_, AppState>, collection_id: String, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("收藏夹名称不能为空".to_string());
    }
    sqlx::query("UPDATE collections SET name = ? WHERE id = ?")
        .bind(name)
        .bind(&collection_id)
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// Articles in the folder stay favorited; they just become unsorted.
#[tauri::command]
pub async fn delete_collection(state: State<'_, AppState>, collection_id: String) -> Result<(), String> {
    let mut tx = state.pool.begin().await.map_err(db_err)?;
    sqlx::query("UPDATE articles SET collection_id = NULL WHERE collection_id = ?")
        .bind(&collection_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(&collection_id)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
    tx.commit().await.map_err(db_err)
}

#[tauri::command]
pub async fn reorder_collections(state: State<'_, AppState>, ordered_ids: Vec<String>) -> Result<(), String> {
    let mut tx = state.pool.begin().await.map_err(db_err)?;
    for (index, id) in ordered_ids.iter().enumerate() {
        sqlx::query("UPDATE collections SET sort_order = ? WHERE id = ?")
            .bind(index as i64)
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
    }
    tx.commit().await.map_err(db_err)
}

/// Files an article into a folder (or unsorted with `None`). Filing implies favoriting.
#[tauri::command]
pub async fn set_article_collection(
    state: State<'_, AppState>,
    article_id: String,
    collection_id: Option<String>,
) -> Result<(), String> {
    sqlx::query("UPDATE articles SET collection_id = ?, is_favorite = 1, updated_at = ? WHERE id = ?")
        .bind(&collection_id)
        .bind(Utc::now())
        .bind(&article_id)
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    Ok(())
}
