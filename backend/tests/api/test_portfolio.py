"""Tests for portfolio trade execution and the portfolio routes."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.db import crud
from app.routers.portfolio import TradeError, execute_trade


def _client():
    from app.main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_buy_deducts_cash_and_creates_position(db, cache):
    cache.update("AAPL", 200.0)
    result = await execute_trade("AAPL", 10, "buy")
    assert result["cash_balance"] == pytest.approx(8000.0)
    assert result["position"]["quantity"] == 10
    assert result["position"]["avg_cost"] == pytest.approx(200.0)
    assert (await crud.get_user_profile())["cash_balance"] == pytest.approx(8000.0)


async def test_buy_weighted_average_cost(db, cache):
    cache.update("AAPL", 100.0)
    await execute_trade("AAPL", 10, "buy")
    cache.update("AAPL", 200.0)
    result = await execute_trade("AAPL", 10, "buy")
    assert result["position"]["quantity"] == 20
    assert result["position"]["avg_cost"] == pytest.approx(150.0)


async def test_buy_insufficient_cash(db, cache):
    cache.update("AAPL", 200.0)
    with pytest.raises(TradeError, match="insufficient cash"):
        await execute_trade("AAPL", 1000, "buy")


async def test_buy_no_price(db, cache):
    with pytest.raises(TradeError, match="no price"):
        await execute_trade("AAPL", 1, "buy")


async def test_sell_reduces_position_and_adds_cash(db, cache):
    cache.update("AAPL", 100.0)
    await execute_trade("AAPL", 10, "buy")
    cache.update("AAPL", 120.0)
    result = await execute_trade("AAPL", 4, "sell")
    assert result["position"]["quantity"] == 6
    assert result["cash_balance"] == pytest.approx(10000.0 - 1000.0 + 480.0)


async def test_sell_entire_position_deletes_it(db, cache):
    cache.update("AAPL", 100.0)
    await execute_trade("AAPL", 10, "buy")
    result = await execute_trade("AAPL", 10, "sell")
    assert result["position"] is None
    assert not await crud.get_positions()


async def test_sell_more_than_owned(db, cache):
    cache.update("AAPL", 100.0)
    await execute_trade("AAPL", 5, "buy")
    with pytest.raises(TradeError, match="insufficient shares"):
        await execute_trade("AAPL", 10, "sell")


async def test_sell_without_position(db, cache):
    cache.update("AAPL", 100.0)
    with pytest.raises(TradeError, match="no position"):
        await execute_trade("AAPL", 1, "sell")


async def test_get_portfolio_route_pnl(db, cache):
    cache.update("AAPL", 100.0)
    await execute_trade("AAPL", 10, "buy")
    cache.update("AAPL", 150.0)
    async with _client() as c:
        resp = await c.get("/api/portfolio")
    body = resp.json()
    assert resp.status_code == 200
    pos = body["positions"][0]
    assert pos["unrealized_pnl"] == pytest.approx(500.0)
    assert pos["pnl_pct"] == pytest.approx(50.0)
    assert body["total_value"] == pytest.approx(9000.0 + 1500.0)
    assert body["unrealized_pnl"] == pytest.approx(500.0)


async def test_trade_route_buy_and_validation_error(db, cache):
    cache.update("AAPL", 100.0)
    async with _client() as c:
        ok = await c.post(
            "/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 5, "side": "buy"}
        )
        assert ok.status_code == 200
        assert ok.json()["success"] is True
        bad = await c.post(
            "/api/portfolio/trade",
            json={"ticker": "AAPL", "quantity": 9999, "side": "buy"},
        )
        assert bad.status_code == 400
        assert bad.json()["detail"]["success"] is False


async def test_trade_route_rejects_bad_side(db, cache):
    cache.update("AAPL", 100.0)
    async with _client() as c:
        resp = await c.post(
            "/api/portfolio/trade",
            json={"ticker": "AAPL", "quantity": 1, "side": "hold"},
        )
    assert resp.status_code == 422


async def test_history_route(db, cache):
    cache.update("AAPL", 100.0)
    await execute_trade("AAPL", 1, "buy")
    async with _client() as c:
        resp = await c.get("/api/portfolio/history")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1
