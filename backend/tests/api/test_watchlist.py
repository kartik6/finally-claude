"""Tests for the watchlist routes."""

from __future__ import annotations

from httpx import ASGITransport, AsyncClient


def _client():
    from app.main import app

    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_get_watchlist_with_prices(db, cache):
    cache.update("AAPL", 190.0)
    cache.update("AAPL", 191.0)
    async with _client() as c:
        resp = await c.get("/api/watchlist")
    body = resp.json()
    assert resp.status_code == 200
    assert len(body) == 10
    aapl = next(item for item in body if item["ticker"] == "AAPL")
    assert aapl["current_price"] == 191.0
    assert aapl["prev_price"] == 190.0
    assert aapl["change_pct"] > 0


async def test_get_watchlist_missing_price_is_null(db, cache):
    async with _client() as c:
        resp = await c.get("/api/watchlist")
    aapl = next(item for item in resp.json() if item["ticker"] == "AAPL")
    assert aapl["current_price"] is None
    assert aapl["change_pct"] == 0.0


async def test_add_ticker(db, cache):
    async with _client() as c:
        resp = await c.post("/api/watchlist", json={"ticker": "pypl"})
    assert resp.status_code == 201
    assert resp.json()["ticker"] == "PYPL"
    assert "added_at" in resp.json()


async def test_add_duplicate_returns_409(db, cache):
    async with _client() as c:
        resp = await c.post("/api/watchlist", json={"ticker": "AAPL"})
    assert resp.status_code == 409


async def test_add_empty_ticker_rejected(db, cache):
    async with _client() as c:
        resp = await c.post("/api/watchlist", json={"ticker": "  "})
    assert resp.status_code == 422


async def test_remove_ticker(db, cache):
    async with _client() as c:
        resp = await c.delete("/api/watchlist/AAPL")
        assert resp.status_code == 200
        assert resp.json() == {"removed": True}
        again = await c.delete("/api/watchlist/AAPL")
        assert again.status_code == 404
