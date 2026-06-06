"""Watchlist REST routes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from app.db import crud
from app.state import price_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/watchlist", tags=["watchlist"])

USER_ID = "default"


class AddTickerRequest(BaseModel):
    ticker: str

    @field_validator("ticker")
    @classmethod
    def _normalize(cls, v: str) -> str:
        v = v.strip().upper()
        if not v:
            raise ValueError("ticker must not be empty")
        return v


class WatchlistItem(BaseModel):
    ticker: str
    current_price: float | None
    prev_price: float | None
    change_pct: float
    added_at: str


@router.get("")
async def list_watchlist() -> list[WatchlistItem]:
    rows = await crud.get_watchlist(USER_ID)
    items: list[WatchlistItem] = []
    for row in rows:
        update = price_cache.get(row["ticker"])
        current = update.price if update else None
        prev = update.previous_price if update else None
        change_pct = 0.0
        if current is not None and prev:
            change_pct = (current - prev) / prev * 100
        items.append(
            WatchlistItem(
                ticker=row["ticker"],
                current_price=current,
                prev_price=prev,
                change_pct=round(change_pct, 4),
                added_at=row["added_at"],
            )
        )
    return items


@router.post("", status_code=201)
async def add_ticker(body: AddTickerRequest, request: Request) -> dict:
    try:
        entry = await crud.add_to_watchlist(USER_ID, body.ticker)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    source = getattr(request.app.state, "market_source", None)
    if source is not None:
        await source.add_ticker(entry["ticker"])

    return {"ticker": entry["ticker"], "added_at": entry["added_at"]}


@router.delete("/{ticker}")
async def remove_ticker(ticker: str, request: Request) -> dict:
    removed = await crud.remove_from_watchlist(USER_ID, ticker)
    if not removed:
        raise HTTPException(status_code=404, detail=f"{ticker.upper()} not in watchlist")

    source = getattr(request.app.state, "market_source", None)
    if source is not None:
        await source.remove_ticker(ticker.upper())

    return {"removed": True}
