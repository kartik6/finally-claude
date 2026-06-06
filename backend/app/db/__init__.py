"""Database subsystem for FinAlly.

Owns SQLite connection management, schema, lazy initialization, and async CRUD.
"""

from .connection import async_db_connection, get_db_path
from .crud import (
    add_chat_message,
    add_portfolio_snapshot,
    add_to_watchlist,
    add_trade,
    delete_position,
    get_chat_messages,
    get_last_snapshot_time,
    get_portfolio_history,
    get_positions,
    get_user_profile,
    get_watchlist,
    remove_from_watchlist,
    update_cash,
    upsert_position,
)
from .init import init_db

__all__ = [
    "init_db",
    "get_db_path",
    "async_db_connection",
    "get_user_profile",
    "update_cash",
    "get_watchlist",
    "add_to_watchlist",
    "remove_from_watchlist",
    "get_positions",
    "upsert_position",
    "delete_position",
    "add_trade",
    "add_portfolio_snapshot",
    "get_portfolio_history",
    "get_last_snapshot_time",
    "get_chat_messages",
    "add_chat_message",
]
