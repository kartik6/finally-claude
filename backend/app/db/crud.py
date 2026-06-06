"""Async CRUD operations against the SQLite database."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from .connection import async_db_connection


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Users ---------------------------------------------------------------


async def get_user_profile(user_id: str = "default") -> dict:
    """Return the user profile row as a dict."""
    async with async_db_connection() as conn:
        cursor = await conn.execute(
            "SELECT id, cash_balance, created_at FROM users_profile WHERE id = ?",
            (user_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else {}


async def update_cash(user_id: str, new_balance: float) -> None:
    """Set the user's cash balance."""
    async with async_db_connection() as conn:
        await conn.execute(
            "UPDATE users_profile SET cash_balance = ? WHERE id = ?",
            (new_balance, user_id),
        )


# --- Watchlist -----------------------------------------------------------


async def get_watchlist(user_id: str = "default") -> list[dict]:
    """Return all watchlist entries for the user, ordered by added_at."""
    async with async_db_connection() as conn:
        cursor = await conn.execute(
            "SELECT id, user_id, ticker, added_at FROM watchlist "
            "WHERE user_id = ? ORDER BY added_at ASC",
            (user_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def add_to_watchlist(user_id: str, ticker: str) -> dict:
    """Add a ticker to the watchlist. Raises ValueError if it already exists."""
    ticker = ticker.upper()
    entry = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "ticker": ticker,
        "added_at": _now(),
    }
    async with async_db_connection() as conn:
        cursor = await conn.execute(
            "SELECT 1 FROM watchlist WHERE user_id = ? AND ticker = ?",
            (user_id, ticker),
        )
        if await cursor.fetchone():
            raise ValueError(f"{ticker} is already in the watchlist")
        await conn.execute(
            "INSERT INTO watchlist(id, user_id, ticker, added_at) VALUES(?, ?, ?, ?)",
            (entry["id"], entry["user_id"], entry["ticker"], entry["added_at"]),
        )
    return entry


async def remove_from_watchlist(user_id: str, ticker: str) -> bool:
    """Remove a ticker. Returns True if a row was deleted."""
    ticker = ticker.upper()
    async with async_db_connection() as conn:
        cursor = await conn.execute(
            "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?",
            (user_id, ticker),
        )
        return cursor.rowcount > 0


# --- Positions -----------------------------------------------------------


async def get_positions(user_id: str = "default") -> list[dict]:
    """Return all positions for the user."""
    async with async_db_connection() as conn:
        cursor = await conn.execute(
            "SELECT id, user_id, ticker, quantity, avg_cost, updated_at FROM positions "
            "WHERE user_id = ? ORDER BY ticker ASC",
            (user_id,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def upsert_position(
    user_id: str, ticker: str, quantity: float, avg_cost: float
) -> None:
    """Insert or replace a position for (user_id, ticker)."""
    ticker = ticker.upper()
    async with async_db_connection() as conn:
        cursor = await conn.execute(
            "SELECT id FROM positions WHERE user_id = ? AND ticker = ?",
            (user_id, ticker),
        )
        existing = await cursor.fetchone()
        position_id = existing["id"] if existing else str(uuid.uuid4())
        await conn.execute(
            "INSERT OR REPLACE INTO positions"
            "(id, user_id, ticker, quantity, avg_cost, updated_at) "
            "VALUES(?, ?, ?, ?, ?, ?)",
            (position_id, user_id, ticker, quantity, avg_cost, _now()),
        )


async def delete_position(user_id: str, ticker: str) -> None:
    """Delete a position for (user_id, ticker)."""
    ticker = ticker.upper()
    async with async_db_connection() as conn:
        await conn.execute(
            "DELETE FROM positions WHERE user_id = ? AND ticker = ?",
            (user_id, ticker),
        )


# --- Trades --------------------------------------------------------------


async def add_trade(
    user_id: str, ticker: str, side: str, quantity: float, price: float
) -> dict:
    """Append a trade to the trade log. Returns the created trade row."""
    trade = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "ticker": ticker.upper(),
        "side": side,
        "quantity": quantity,
        "price": price,
        "executed_at": _now(),
    }
    async with async_db_connection() as conn:
        await conn.execute(
            "INSERT INTO trades(id, user_id, ticker, side, quantity, price, executed_at) "
            "VALUES(?, ?, ?, ?, ?, ?, ?)",
            (
                trade["id"],
                trade["user_id"],
                trade["ticker"],
                trade["side"],
                trade["quantity"],
                trade["price"],
                trade["executed_at"],
            ),
        )
    return trade


# --- Portfolio snapshots -------------------------------------------------


async def add_portfolio_snapshot(user_id: str, total_value: float) -> None:
    """Record a portfolio value snapshot."""
    async with async_db_connection() as conn:
        await conn.execute(
            "INSERT INTO portfolio_snapshots(id, user_id, total_value, recorded_at) "
            "VALUES(?, ?, ?, ?)",
            (str(uuid.uuid4()), user_id, total_value, _now()),
        )


async def get_portfolio_history(user_id: str = "default", limit: int = 200) -> list[dict]:
    """Return the most recent snapshots in chronological (ascending) order."""
    async with async_db_connection() as conn:
        cursor = await conn.execute(
            "SELECT id, user_id, total_value, recorded_at FROM portfolio_snapshots "
            "WHERE user_id = ? ORDER BY recorded_at DESC LIMIT ?",
            (user_id, limit),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in reversed(rows)]


async def get_last_snapshot_time(user_id: str = "default") -> str | None:
    """Return the ISO timestamp of the most recent snapshot, or None."""
    async with async_db_connection() as conn:
        cursor = await conn.execute(
            "SELECT recorded_at FROM portfolio_snapshots "
            "WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1",
            (user_id,),
        )
        row = await cursor.fetchone()
        return row["recorded_at"] if row else None


# --- Chat ----------------------------------------------------------------


async def get_chat_messages(user_id: str = "default", limit: int = 20) -> list[dict]:
    """Return the most recent chat messages in chronological (ascending) order.

    The `actions` JSON column is deserialized to a dict (or None).
    """
    async with async_db_connection() as conn:
        cursor = await conn.execute(
            "SELECT id, user_id, role, content, actions, created_at FROM chat_messages "
            "WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        )
        rows = await cursor.fetchall()
        messages = []
        for row in reversed(rows):
            message = dict(row)
            message["actions"] = json.loads(message["actions"]) if message["actions"] else None
            messages.append(message)
        return messages


async def add_chat_message(
    user_id: str, role: str, content: str, actions: dict | None = None
) -> dict:
    """Store a chat message. Returns the created row (with actions as a dict)."""
    message = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "role": role,
        "content": content,
        "actions": actions,
        "created_at": _now(),
    }
    async with async_db_connection() as conn:
        await conn.execute(
            "INSERT INTO chat_messages(id, user_id, role, content, actions, created_at) "
            "VALUES(?, ?, ?, ?, ?, ?)",
            (
                message["id"],
                message["user_id"],
                message["role"],
                message["content"],
                json.dumps(actions) if actions is not None else None,
                message["created_at"],
            ),
        )
    return message
