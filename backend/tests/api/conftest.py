"""Fixtures for API and DB-backed tests: isolated DB and a clean price cache."""

from __future__ import annotations

import pytest
import pytest_asyncio


@pytest_asyncio.fixture
async def db(tmp_path, monkeypatch):
    """Point the app at a fresh, seeded SQLite file for the duration of a test."""
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    from app.db.init import init_db

    await init_db()
    yield


@pytest.fixture
def cache():
    """Reset and expose the shared price cache singleton, seeded per test."""
    from app.state import price_cache

    for ticker in list(price_cache.get_all().keys()):
        price_cache.remove(ticker)
    return price_cache
