"""Prompt Vault — slash commands for managing prompts from any Hermes platform.

Registers /vault with subcommands: list, search, use, save, delete, stats.

Works with the same SQLite database the dashboard plugin uses.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import os

_DB_DIR = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")) / "plugins" / "prompt-vault"
_DB_PATH = _DB_DIR / "prompts.db"

_HELP_TEXT = """Usage: /vault <subcommand>

Subcommands:
  list [category]        List recent prompts (optionally filter by category)
  search <query>         Search prompts by title, content, or description
  use <id>               Show a prompt's full content (ready to paste)
  save <title> | <content>   Save a new prompt with title and content
  save <title>           Save a placeholder (edit content in dashboard)
  delete <id>            Delete a prompt
  stats                  Show prompt vault statistics
  help                   Show this help message

Examples:
  /vault list
  /vault list Coding
  /vault search code review
  /vault use a1b2c3d4
  /vault save Code Review | Review this PR for bugs, style issues...
  /vault save My Workflow
  /vault stats
"""


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
    """)
    conn.commit()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["tags"] = json.loads(d.get("tags") or "[]")
    d["favorite"] = bool(d.get("favorite", 0))
    return d


# ---------------------------------------------------------------------------
# Slash command handler
# ---------------------------------------------------------------------------

def _handle_vault(raw_args: str, *, conversation_history: list = None) -> Optional[str]:
    """Handle /vault slash commands."""
    argv = raw_args.strip().split()
    if not argv or argv[0] in ("help", "-h", "--help"):
        return _HELP_TEXT

    sub = argv[0].lower()

    if sub == "list":
        return _cmd_list(argv[1:])
    elif sub == "search":
        return _cmd_search(" ".join(argv[1:]))
    elif sub == "use":
        return _cmd_use(argv[1] if len(argv) > 1 else None)
    elif sub == "save":
        return _cmd_save(argv[1:], conversation_history)
    elif sub == "delete":
        return _cmd_delete(argv[1] if len(argv) > 1 else None)
    elif sub == "stats":
        return _cmd_stats()
    else:
        return f"Unknown subcommand: {sub}\n\nType /vault help for available commands."


def _cmd_list(args: list) -> str:
    """List recent prompts, optionally filtered by category."""
    category = args[0] if args else None
    db = _get_db()
    try:
        if category:
            rows = db.execute(
                "SELECT * FROM prompts WHERE category = ? ORDER BY favorite DESC, updated_at DESC LIMIT 20",
                (category,),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM prompts ORDER BY favorite DESC, updated_at DESC LIMIT 20"
            ).fetchall()

        if not rows:
            return "No prompts found." + (f" (category: {category})" if category else "")

        lines = [f"{'ID':<10} {'★':<2} {'Title':<30} {'Category':<15} {'Used'}"]
        lines.append("─" * 75)
        for r in rows:
            d = _row_to_dict(r)
            fav = "★" if d["favorite"] else " "
            cat = d["category"] or "-"
            title = d["title"][:28]
            used = f"{d['run_count']}x" if d["run_count"] else "-"
            lines.append(f"{d['id']:<10} {fav:<2} {title:<30} {cat:<15} {used}")

        total = db.execute("SELECT COUNT(*) FROM prompts").fetchone()[0]
        shown = len(rows)
        suffix = f" (showing {shown}/{total})" if shown < total else f" ({total} total)"
        return "\n".join(lines) + suffix
    finally:
        db.close()


def _cmd_search(query: str) -> str:
    """Search prompts by title, content, or description."""
    if not query.strip():
        return "Usage: /vault search <query>"

    db = _get_db()
    try:
        q = f"%{query}%"
        rows = db.execute(
            """SELECT * FROM prompts
               WHERE title LIKE ? OR content LIKE ? OR description LIKE ?
               ORDER BY favorite DESC, updated_at DESC LIMIT 10""",
            (q, q, q),
        ).fetchall()

        if not rows:
            return f'No prompts matching "{query}".'

        lines = [f"Found {len(rows)} result(s):", ""]
        for r in rows:
            d = _row_to_dict(r)
            preview = d["content"][:100].replace("\n", " ")
            fav = "★ " if d["favorite"] else ""
            cat = f" [{d['category']}]" if d["category"] else ""
            lines.append(f"  {d['id']}  {fav}{d['title']}{cat}")
            lines.append(f"         {preview}...")
            lines.append("")

        return "\n".join(lines)
    finally:
        db.close()


def _cmd_use(prompt_id: Optional[str]) -> str:
    """Show a prompt's full content for copying."""
    if not prompt_id:
        return "Usage: /vault use <id>"

    db = _get_db()
    try:
        # Try exact ID match first
        row = db.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()

        # Try prefix match
        if not row:
            row = db.execute("SELECT * FROM prompts WHERE id LIKE ?", (f"{prompt_id}%",)).fetchone()

        # Try title match
        if not row:
            row = db.execute("SELECT * FROM prompts WHERE title LIKE ?", (f"%{prompt_id}%",)).fetchone()

        if not row:
            return f'No prompt found matching "{prompt_id}".'

        d = _row_to_dict(row)

        # Increment run count
        db.execute(
            "UPDATE prompts SET run_count = run_count + 1, last_run_at = ? WHERE id = ?",
            (_now_iso(), d["id"]),
        )
        db.commit()

        lines = [
            f"📋 {d['title']}",
            f"   ID: {d['id']}  Category: {d['category'] or '-'}  Used: {d['run_count']}x",
            "",
            d["content"],
        ]
        return "\n".join(lines)
    finally:
        db.close()


def _cmd_save(args: list, conversation_history: Optional[list]) -> str:
    """Save a prompt. Title from args, content provided inline or via pipe.

    Usage:
      /vault save My Title | The prompt content goes here
      /vault save My Title    (saves a placeholder you can edit in the dashboard)
    """
    if not args:
        return "Usage: /vault save <title> | <content>\n       /vault save <title>"

    raw = " ".join(args)

    # Check for pipe separator: "title | content"
    if "|" in raw:
        parts = raw.split("|", 1)
        title = parts[0].strip()
        content = parts[1].strip()
    else:
        title = raw.strip()
        content = f"[Edit this prompt in the Prompt Vault dashboard]"

    if not title:
        return "Usage: /vault save <title> | <content>"

    db = _get_db()
    try:
        prompt_id = str(uuid.uuid4())[:8]
        now = _now_iso()
        db.execute(
            """INSERT INTO prompts (id, title, content, description, category, tags, created_at, updated_at)
               VALUES (?, ?, ?, '', '', '[]', ?, ?)""",
            (prompt_id, title, content, now, now),
        )
        db.commit()
        return f'Prompt saved! ID: {prompt_id}\nTitle: {title}\n\nUse /vault use {prompt_id} to view it.'
    finally:
        db.close()


def _cmd_delete(prompt_id: Optional[str]) -> str:
    """Delete a prompt by ID."""
    if not prompt_id:
        return "Usage: /vault delete <id>"

    db = _get_db()
    try:
        row = db.execute("SELECT id, title FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        if not row:
            # Try prefix match
            row = db.execute("SELECT id, title FROM prompts WHERE id LIKE ?", (f"{prompt_id}%",)).fetchone()
        if not row:
            return f'No prompt found matching "{prompt_id}".'

        db.execute("DELETE FROM prompt_versions WHERE prompt_id = ?", (row["id"],))
        db.execute("DELETE FROM prompts WHERE id = ?", (row["id"],))
        db.commit()
        return f'Deleted "{row["title"]}" ({row["id"]})'
    finally:
        db.close()


def _cmd_stats() -> str:
    """Show vault statistics."""
    db = _get_db()
    try:
        total = db.execute("SELECT COUNT(*) FROM prompts").fetchone()[0]
        favorites = db.execute("SELECT COUNT(*) FROM prompts WHERE favorite = 1").fetchone()[0]
        total_runs = db.execute("SELECT COALESCE(SUM(run_count), 0) FROM prompts").fetchone()[0]
        total_versions = db.execute("SELECT COUNT(*) FROM prompt_versions").fetchone()[0]

        # Top categories
        cats = db.execute(
            "SELECT category, COUNT(*) as cnt FROM prompts WHERE category != '' GROUP BY category ORDER BY cnt DESC LIMIT 5"
        ).fetchall()

        lines = [
            "📊 Prompt Vault Stats",
            f"   Total prompts:  {total}",
            f"   Favorites:      {favorites}",
            f"   Total uses:     {total_runs}",
            f"   Versions saved: {total_versions}",
        ]

        if cats:
            lines.append("")
            lines.append("   Top categories:")
            for c in cats:
                lines.append(f"     {c['category']}: {c['cnt']}")

        return "\n".join(lines)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Plugin registration
# ---------------------------------------------------------------------------

def register(ctx) -> None:
    """Register the /vault slash command with Hermes."""
    ctx.register_command(
        "vault",
        handler=_handle_vault,
        description="Save, search, and reuse prompts from your Prompt Vault. Try /vault help",
    )
