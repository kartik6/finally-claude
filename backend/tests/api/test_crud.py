"""Tests for the async CRUD layer."""

from __future__ import annotations

import pytest

from app.db import crud


async def test_seed_profile_and_watchlist(db):
    profile = await crud.get_user_profile()
    assert profile["cash_balance"] == 10000.0
    watchlist = await crud.get_watchlist()
    assert {row["ticker"] for row in watchlist} >= {"AAPL", "GOOGL", "NVDA"}
    assert len(watchlist) == 10


async def test_update_cash(db):
    await crud.update_cash("default", 5000.0)
    assert (await crud.get_user_profile())["cash_balance"] == 5000.0


async def test_add_duplicate_watchlist_raises(db):
    with pytest.raises(ValueError):
        await crud.add_to_watchlist("default", "AAPL")


async def test_add_and_remove_watchlist(db):
    entry = await crud.add_to_watchlist("default", "pypl")
    assert entry["ticker"] == "PYPL"
    assert any(r["ticker"] == "PYPL" for r in await crud.get_watchlist())
    assert await crud.remove_from_watchlist("default", "PYPL") is True
    assert await crud.remove_from_watchlist("default", "PYPL") is False


async def test_upsert_and_delete_position(db):
    await crud.upsert_position("default", "AAPL", 10.0, 100.0)
    positions = {p["ticker"]: p for p in await crud.get_positions()}
    assert positions["AAPL"]["quantity"] == 10.0
    assert positions["AAPL"]["avg_cost"] == 100.0
    await crud.upsert_position("default", "AAPL", 20.0, 105.0)
    positions = {p["ticker"]: p for p in await crud.get_positions()}
    assert positions["AAPL"]["quantity"] == 20.0
    await crud.delete_position("default", "AAPL")
    assert not await crud.get_positions()


async def test_trade_log(db):
    trade = await crud.add_trade("default", "AAPL", "buy", 5.0, 190.0)
    assert trade["ticker"] == "AAPL"
    assert trade["side"] == "buy"
    assert trade["price"] == 190.0


async def test_snapshots(db):
    assert await crud.get_last_snapshot_time() is None
    await crud.add_portfolio_snapshot("default", 10000.0)
    await crud.add_portfolio_snapshot("default", 10500.0)
    history = await crud.get_portfolio_history()
    assert [h["total_value"] for h in history] == [10000.0, 10500.0]
    assert await crud.get_last_snapshot_time() is not None


async def test_chat_messages_roundtrip(db):
    await crud.add_chat_message("default", "user", "hello")
    await crud.add_chat_message(
        "default", "assistant", "hi", actions={"trades": [{"ticker": "AAPL"}]}
    )
    messages = await crud.get_chat_messages(limit=20)
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["actions"] == {"trades": [{"ticker": "AAPL"}]}
    assert messages[0]["actions"] is None
