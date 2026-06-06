"""Async SQLite connection management."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import aiosqlite


def get_db_path() -> Path:
    """Resolve the SQLite database path.

    Reads the DB_PATH env var; defaults to <project_root>/db/finally.db.
    Project root is 3 levels up from this file (app/db/connection.py -> backend -> root).
    """
    env_path = os.getenv("DB_PATH")
    if env_path:
        return Path(env_path)
    project_root = Path(__file__).resolve().parents[3]
    return project_root / "db" / "finally.db"


@asynccontextmanager
async def async_db_connection() -> AsyncIterator[aiosqlite.Connection]:
    """Async context manager yielding an aiosqlite connection.

    Sets row_factory to aiosqlite.Row and enables WAL mode. Commits on
    successful exit, rolls back on exception.
    """
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = await aiosqlite.connect(db_path)
    conn.row_factory = aiosqlite.Row
    try:
        await conn.execute("PRAGMA journal_mode=WAL")
        yield conn
        await conn.commit()
    except Exception:
        await conn.rollback()
        raise
    finally:
        await conn.close()
