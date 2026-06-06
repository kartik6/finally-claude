"""Structured output schemas for the LLM chat assistant."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class TradeIntent(BaseModel):
    ticker: str
    side: Literal["buy", "sell"]
    quantity: float


class WatchlistChange(BaseModel):
    ticker: str
    action: Literal["add", "remove"]


class LLMResponse(BaseModel):
    message: str
    trades: list[TradeIntent] = []
    watchlist_changes: list[WatchlistChange] = []
