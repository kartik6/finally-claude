"""Lazy database initialization and seeding."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from .connection import async_db_connection
from .schema import SCHEMA_SQL

DEFAULT_WATCHLIST = [
    "AAPL",
    "GOOGL",
    "MSFT",
    "AMZN",
    "TSLA",
    "NVDA",
    "META",
    "JPM",
    "V",
    "NFLX",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def init_db() -> None:
    """Create tables and seed default data if missing.

    Idempotent: safe to call on every startup.
    """
    async with async_db_connection() as conn:
        await conn.executescript(SCHEMA_SQL)

        await conn.execute(
            "INSERT OR IGNORE INTO users_profile(id, cash_balance, created_at) "
            "VALUES('default', 10000.0, ?)",
            (_now(),),
        )

        cursor = await conn.execute(
            "SELECT COUNT(*) AS c FROM watchlist WHERE user_id = 'default'"
        )
        row = await cursor.fetchone()
        if row["c"] == 0:
            now = _now()
            await conn.executemany(
                "INSERT INTO watchlist(id, user_id, ticker, added_at) "
                "VALUES(?, 'default', ?, ?)",
                [(str(uuid.uuid4()), ticker, now) for ticker in DEFAULT_WATCHLIST],
            )
