"""
Prompt Vault — backend API for the Hermes Dashboard plugin.

Provides a FastAPI router for managing a local prompt library.
Prompts are stored in SQLite at ~/.hermes/plugins/prompt-vault/prompts.db.

Mount point: /api/plugins/prompt-vault/
"""

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

_DB_DIR = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")) / "plugins" / "prompt-vault"
_DB_PATH = _DB_DIR / "prompts.db"


def _get_db() -> sqlite3.Connection:
    _DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _ensure_schema(conn)
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS prompts (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            description TEXT DEFAULT '',
            category    TEXT DEFAULT '',
            tags        TEXT DEFAULT '[]',
            favorite    INTEGER DEFAULT 0,
            run_count   INTEGER DEFAULT 0,
            last_run_at TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS prompt_versions (
            id          TEXT PRIMARY KEY,
            prompt_id   TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            note        TEXT DEFAULT '',
            created_at  TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category);
        CREATE INDEX IF NOT EXISTS idx_prompts_favorite ON prompts(favorite);
        CREATE INDEX IF NOT EXISTS idx_versions_prompt ON prompt_versions(prompt_id);
    """)
    conn.commit()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class PromptCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    description: str = ""
    category: str = ""
    tags: List[str] = []
    favorite: bool = False


class PromptUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    favorite: Optional[bool] = None


class PromptVersionNote(BaseModel):
    note: str = ""


class ImportData(BaseModel):
    prompts: List[PromptCreate]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["tags"] = json.loads(d.get("tags") or "[]")
    d["favorite"] = bool(d.get("favorite", 0))
    return d


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(tags=["prompt-vault"])


# --- Prompts CRUD ---

@router.get("/prompts")
def list_prompts(
    search: Optional[str] = None,
    category: Optional[str] = None,
    tag: Optional[str] = None,
    favorite: Optional[bool] = None,
    sort: str = Query("updated_at", pattern="^(updated_at|created_at|title|run_count)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    db = _get_db()
    try:
        where_clauses = []
        params: list[Any] = []

        if search:
            where_clauses.append("(p.title LIKE ? OR p.content LIKE ? OR p.description LIKE ?)")
            q = f"%{search}%"
            params.extend([q, q, q])

        if category:
            where_clauses.append("p.category = ?")
            params.append(category)

        if tag:
            where_clauses.append("p.tags LIKE ?")
            params.append(f'%"{tag}"%')

        if favorite is not None:
            where_clauses.append("p.favorite = ?")
            params.append(1 if favorite else 0)

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        order_sql = f"ORDER BY p.{sort} {order.upper()}"
        # Always put favorites first when sorting by date
        if sort in ("updated_at", "created_at"):
            order_sql = f"ORDER BY p.favorite DESC, p.{sort} {order.upper()}"

        # Count
        count_row = db.execute(f"SELECT COUNT(*) FROM prompts p {where_sql}", params).fetchone()
        total = count_row[0]

        # Fetch
        rows = db.execute(
            f"SELECT p.* FROM prompts p {where_sql} {order_sql} LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()

        # Get all unique tags
        all_tags_rows = db.execute("SELECT DISTINCT tags FROM prompts WHERE tags != '[]'").fetchall()
        all_tags = set()
        for r in all_tags_rows:
            for t in json.loads(r["tags"]):
                all_tags.add(t)

        # Get all unique categories
        all_cats = [
            r["category"]
            for r in db.execute("SELECT DISTINCT category FROM prompts WHERE category != ''").fetchall()
        ]

        return {
            "prompts": [_row_to_dict(r) for r in rows],
            "total": total,
            "all_tags": sorted(all_tags),
            "all_categories": sorted(all_cats),
        }
    finally:
        db.close()


@router.post("/prompts")
def create_prompt(data: PromptCreate) -> dict:
    db = _get_db()
    try:
        now = _now_iso()
        prompt_id = str(uuid.uuid4())[:8]
        db.execute(
            """INSERT INTO prompts (id, title, content, description, category, tags, favorite, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (prompt_id, data.title, data.content, data.description, data.category,
             json.dumps(data.tags), 1 if data.favorite else 0, now, now),
        )
        db.commit()
        row = db.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        db.close()


@router.get("/prompts/{prompt_id}")
def get_prompt(prompt_id: str) -> dict:
    db = _get_db()
    try:
        row = db.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Prompt not found")

        prompt = _row_to_dict(row)

        # Get version history
        versions = db.execute(
            "SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC",
            (prompt_id,),
        ).fetchall()
        prompt["versions"] = [
            {"id": v["id"], "title": v["title"], "content": v["content"],
             "note": v["note"], "created_at": v["created_at"]}
            for v in versions
        ]

        return prompt
    finally:
        db.close()


@router.put("/prompts/{prompt_id}")
def update_prompt(prompt_id: str, data: PromptUpdate) -> dict:
    db = _get_db()
    try:
        row = db.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Prompt not found")

        # Save version before updating (if content changed)
        if data.content is not None and data.content != row["content"]:
            ver_id = str(uuid.uuid4())[:8]
            db.execute(
                """INSERT INTO prompt_versions (id, prompt_id, title, content, note, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (ver_id, prompt_id, row["title"], row["content"], "Auto-saved", _now_iso()),
            )

        updates = []
        params: list[Any] = []
        for field in ("title", "content", "description", "category"):
            val = getattr(data, field, None)
            if val is not None:
                updates.append(f"{field} = ?")
                params.append(val)

        if data.tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(data.tags))

        if data.favorite is not None:
            updates.append("favorite = ?")
            params.append(1 if data.favorite else 0)

        if updates:
            updates.append("updated_at = ?")
            params.append(_now_iso())
            params.append(prompt_id)
            db.execute(f"UPDATE prompts SET {', '.join(updates)} WHERE id = ?", params)
            db.commit()

        row = db.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        db.close()


@router.delete("/prompts/{prompt_id}")
def delete_prompt(prompt_id: str) -> dict:
    db = _get_db()
    try:
        row = db.execute("SELECT id FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Prompt not found")
        db.execute("DELETE FROM prompt_versions WHERE prompt_id = ?", (prompt_id,))
        db.execute("DELETE FROM prompts WHERE id = ?", (prompt_id,))
        db.commit()
        return {"ok": True, "deleted": prompt_id}
    finally:
        db.close()


@router.post("/prompts/{prompt_id}/run")
def record_run(prompt_id: str) -> dict:
    """Increment run count when a prompt is used."""
    db = _get_db()
    try:
        now = _now_iso()
        db.execute(
            "UPDATE prompts SET run_count = run_count + 1, last_run_at = ? WHERE id = ?",
            (now, prompt_id),
        )
        db.commit()
        row = db.execute("SELECT run_count, last_run_at FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Prompt not found")
        return {"run_count": row["run_count"], "last_run_at": row["last_run_at"]}
    finally:
        db.close()


# --- Versions ---

@router.get("/prompts/{prompt_id}/versions")
def list_versions(prompt_id: str) -> list:
    db = _get_db()
    try:
        row = db.execute("SELECT id FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Prompt not found")
        versions = db.execute(
            "SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC",
            (prompt_id,),
        ).fetchall()
        return [
            {"id": v["id"], "title": v["title"], "content": v["content"],
             "note": v["note"], "created_at": v["created_at"]}
            for v in versions
        ]
    finally:
        db.close()


@router.post("/prompts/{prompt_id}/versions/{version_id}/restore")
def restore_version(prompt_id: str, version_id: str) -> dict:
    db = _get_db()
    try:
        ver = db.execute(
            "SELECT * FROM prompt_versions WHERE id = ? AND prompt_id = ?",
            (version_id, prompt_id),
        ).fetchone()
        if not ver:
            raise HTTPException(404, "Version not found")

        now = _now_iso()

        # Save current as a version before restoring
        current = db.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        if current:
            save_id = str(uuid.uuid4())[:8]
            db.execute(
                """INSERT INTO prompt_versions (id, prompt_id, title, content, note, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (save_id, prompt_id, current["title"], current["content"],
                 f"Before restoring version {version_id}", now),
            )

        # Restore
        db.execute(
            "UPDATE prompts SET title = ?, content = ?, updated_at = ? WHERE id = ?",
            (ver["title"], ver["content"], now, prompt_id),
        )
        db.commit()

        row = db.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        return _row_to_dict(row)
    finally:
        db.close()


@router.delete("/prompts/{prompt_id}/versions/{version_id}")
def delete_version(prompt_id: str, version_id: str) -> dict:
    db = _get_db()
    try:
        db.execute(
            "DELETE FROM prompt_versions WHERE id = ? AND prompt_id = ?",
            (version_id, prompt_id),
        )
        db.commit()
        return {"ok": True}
    finally:
        db.close()


# --- Tags & Categories ---

@router.get("/tags")
def list_tags() -> list:
    db = _get_db()
    try:
        rows = db.execute("SELECT DISTINCT tags FROM prompts WHERE tags != '[]'").fetchall()
        tags = {}
        for r in rows:
            for t in json.loads(r["tags"]):
                tags[t] = tags.get(t, 0) + 1
        return [{"name": k, "count": v} for k, v in sorted(tags.items(), key=lambda x: -x[1])]
    finally:
        db.close()


@router.get("/categories")
def list_categories() -> list:
    db = _get_db()
    try:
        rows = db.execute(
            "SELECT category, COUNT(*) as count FROM prompts WHERE category != '' GROUP BY category ORDER BY count DESC"
        ).fetchall()
        return [{"name": r["category"], "count": r["count"]} for r in rows]
    finally:
        db.close()


# --- Import/Export ---

@router.get("/export")
def export_all() -> dict:
    db = _get_db()
    try:
        rows = db.execute("SELECT * FROM prompts ORDER BY created_at ASC").fetchall()
        return {"prompts": [_row_to_dict(r) for r in rows]}
    finally:
        db.close()


@router.post("/import")
def import_prompts(data: ImportData) -> dict:
    db = _get_db()
    try:
        now = _now_iso()
        imported = 0
        for p in data.prompts:
            prompt_id = str(uuid.uuid4())[:8]
            db.execute(
                """INSERT INTO prompts (id, title, content, description, category, tags, favorite, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (prompt_id, p.title, p.content, p.description, p.category,
                 json.dumps(p.tags), 1 if p.favorite else 0, now, now),
            )
            imported += 1
        db.commit()
        return {"ok": True, "imported": imported}
    finally:
        db.close()


@router.get("/stats")
def get_stats() -> dict:
    db = _get_db()
    try:
        total = db.execute("SELECT COUNT(*) FROM prompts").fetchone()[0]
        favorites = db.execute("SELECT COUNT(*) FROM prompts WHERE favorite = 1").fetchone()[0]
        total_runs = db.execute("SELECT COALESCE(SUM(run_count), 0) FROM prompts").fetchone()[0]
        total_versions = db.execute("SELECT COUNT(*) FROM prompt_versions").fetchone()[0]
        return {
            "total_prompts": total,
            "total_favorites": favorites,
            "total_runs": total_runs,
            "total_versions": total_versions,
        }
    finally:
        db.close()
