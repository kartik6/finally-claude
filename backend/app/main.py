"""FinAlly FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.db.crud import get_watchlist
    from app.db.init import init_db
    from app.market.factory import create_market_data_source
    from app.state import price_cache

    await init_db()

    source = create_market_data_source(price_cache)
    tickers = [row["ticker"] for row in await get_watchlist()]
    await source.start(tickers)

    app.state.market_source = source
    logger.info("FinAlly startup complete (%d tickers)", len(tickers))

    try:
        yield
    finally:
        await source.stop()
        logger.info("FinAlly shutdown complete")


app = FastAPI(title="FinAlly", lifespan=lifespan, docs_url="/api/docs")

from app.routers import chat, market, portfolio, watchlist  # noqa: E402

app.include_router(market.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")
app.include_router(watchlist.router, prefix="/api")
app.include_router(chat.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


static_dir = Path(__file__).resolve().parent.parent.parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
