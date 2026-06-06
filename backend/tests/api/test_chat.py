"""Tests for the chat route with mocked LLM auto-execution."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.db import crud


def _client():
    from app.main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
def mock_llm(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")


async def test_chat_executes_mock_trade(db, cache, mock_llm):
    cache.update("AAPL", 100.0)
    async with _client() as c:
        resp = await c.post("/api/chat", json={"message": "help me start"})
    body = resp.json()
    assert resp.status_code == 200
    assert "message" in body
    assert body["trades"][0]["ticker"] == "AAPL"
    assert body["trades"][0]["status"] == "ok"
    assert body["trades"][0]["price"] == 100.0

    positions = {p["ticker"]: p for p in await crud.get_positions()}
    assert positions["AAPL"]["quantity"] == 5
    assert (await crud.get_user_profile())["cash_balance"] == pytest.approx(9500.0)


async def test_chat_persists_messages_and_actions(db, cache, mock_llm):
    cache.update("AAPL", 100.0)
    async with _client() as c:
        await c.post("/api/chat", json={"message": "hello there"})
    messages = await crud.get_chat_messages(limit=20)
    roles = [m["role"] for m in messages]
    assert roles == ["user", "assistant"]
    assert messages[0]["content"] == "hello there"
    assert messages[1]["actions"]["trades"][0]["ticker"] == "AAPL"


async def test_chat_trade_failure_recorded(db, cache, mock_llm):
    cache.update("AAPL", 100.0)
    await crud.update_cash("default", 10.0)  # not enough for 5 shares @ $100
    async with _client() as c:
        resp = await c.post("/api/chat", json={"message": "go"})
    trade = resp.json()["trades"][0]
    assert trade["status"] == "error"
    assert "insufficient cash" in trade["reason"]
    assert not await crud.get_positions()


async def test_chat_rejects_empty_message(db, cache, mock_llm):
    async with _client() as c:
        resp = await c.post("/api/chat", json={"message": "   "})
    assert resp.status_code == 422
