"""Tests for the LLM client (mock mode and structured parsing)."""

from __future__ import annotations

import pytest

from app.llm import LLMResponse, get_llm_response
from app.llm.schemas import TradeIntent, WatchlistChange


async def test_mock_response(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")
    resp = await get_llm_response("hi", "Cash: $10,000", [])
    assert isinstance(resp, LLMResponse)
    assert resp.trades[0].ticker == "AAPL"
    assert resp.trades[0].side == "buy"
    assert resp.trades[0].quantity == 5


async def test_mock_response_is_isolated_copy(monkeypatch):
    monkeypatch.setenv("LLM_MOCK", "true")
    first = await get_llm_response("hi", "", [])
    first.trades.clear()
    second = await get_llm_response("hi", "", [])
    assert len(second.trades) == 1


def test_schema_parses_valid_json():
    raw = (
        '{"message": "ok", "trades": [{"ticker": "AAPL", "side": "buy", '
        '"quantity": 3}], "watchlist_changes": [{"ticker": "PYPL", "action": "add"}]}'
    )
    resp = LLMResponse.model_validate_json(raw)
    assert resp.message == "ok"
    assert resp.trades == [TradeIntent(ticker="AAPL", side="buy", quantity=3)]
    assert resp.watchlist_changes == [WatchlistChange(ticker="PYPL", action="add")]


def test_schema_defaults_empty_actions():
    resp = LLMResponse.model_validate_json('{"message": "just chatting"}')
    assert resp.trades == []
    assert resp.watchlist_changes == []


def test_schema_rejects_invalid_side():
    with pytest.raises(ValueError):
        LLMResponse.model_validate_json(
            '{"message": "x", "trades": [{"ticker": "AAPL", "side": "hold", "quantity": 1}]}'
        )
