"""SSE streaming route for live price updates."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.db.crud import get_watchlist
from app.state import price_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stream", tags=["streaming"])

STREAM_INTERVAL = 0.5


async def _price_events(request: Request) -> AsyncGenerator[str, None]:
    """Yield SSE-formatted price events for the user's watchlist tickers.

    Re-reads the watchlist each cycle so tickers added or removed mid-stream
    are reflected without reconnecting. One event per ticker per cycle.
    """
    yield "retry: 1000\n\n"
    client = request.client.host if request.client else "unknown"
    logger.info("SSE client connected: %s", client)

    try:
        while True:
            if await request.is_disconnected():
                break

            tickers = [row["ticker"] for row in await get_watchlist()]
            for ticker in tickers:
                update = price_cache.get(ticker)
                if update is None:
                    continue
                payload = {
                    "ticker": update.ticker,
                    "price": update.price,
                    "prev_price": update.previous_price,
                    "change_direction": update.direction,
                    "timestamp": update.timestamp,
                }
                yield f"data: {json.dumps(payload)}\n\n"

            await asyncio.sleep(STREAM_INTERVAL)
    except asyncio.CancelledError:
        pass
    finally:
        logger.info("SSE client disconnected: %s", client)


@router.get("/prices")
async def stream_prices(request: Request) -> StreamingResponse:
    """SSE endpoint streaming live prices for the watchlist."""
    return StreamingResponse(
        _price_events(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
