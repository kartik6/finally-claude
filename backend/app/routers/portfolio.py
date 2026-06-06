"""Portfolio REST routes and shared trade-execution logic."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from app.db import crud
from app.state import price_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

USER_ID = "default"
SNAPSHOT_DEBOUNCE_SECONDS = 5.0


class TradeRequest(BaseModel):
    ticker: str
    quantity: float
    side: str

    @field_validator("ticker")
    @classmethod
    def _norm_ticker(cls, v: str) -> str:
        v = v.strip().upper()
        if not v:
            raise ValueError("ticker must not be empty")
        return v

    @field_validator("side")
    @classmethod
    def _norm_side(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ("buy", "sell"):
            raise ValueError("side must be 'buy' or 'sell'")
        return v

    @field_validator("quantity")
    @classmethod
    def _check_qty(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("quantity must be positive")
        return v


class TradeError(Exception):
    """Raised when a trade fails validation (e.g., insufficient cash/shares)."""


async def _total_value(user_id: str = USER_ID) -> float:
    profile = await crud.get_user_profile(user_id)
    cash = profile.get("cash_balance", 0.0)
    total = cash
    for pos in await crud.get_positions(user_id):
        price = price_cache.get_price(pos["ticker"])
        if price is not None:
            total += pos["quantity"] * price
    return total


async def _maybe_snapshot(user_id: str = USER_ID) -> None:
    """Record a portfolio snapshot unless one was taken within the debounce window."""
    last = await crud.get_last_snapshot_time(user_id)
    if last is not None:
        try:
            last_dt = datetime.fromisoformat(last)
            elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
            if elapsed < SNAPSHOT_DEBOUNCE_SECONDS:
                return
        except ValueError:
            pass
    await crud.add_portfolio_snapshot(user_id, await _total_value(user_id))


async def execute_trade(
    ticker: str, quantity: float, side: str, user_id: str = USER_ID
) -> dict:
    """Execute a market trade against the current cached price.

    Shared by the REST trade endpoint and the chat auto-execution flow.
    Raises TradeError on validation failure (no price, insufficient cash/shares).
    Returns {"trade", "cash_balance", "position"}.
    """
    ticker = ticker.upper()
    side = side.lower()

    price = price_cache.get_price(ticker)
    if price is None:
        raise TradeError(f"no price available for {ticker}")

    profile = await crud.get_user_profile(user_id)
    cash = profile.get("cash_balance", 0.0)

    positions = {p["ticker"]: p for p in await crud.get_positions(user_id)}
    existing = positions.get(ticker)

    if side == "buy":
        cost = quantity * price
        if cost > cash:
            raise TradeError(
                f"insufficient cash: need ${cost:.2f}, have ${cash:.2f}"
            )
        old_qty = existing["quantity"] if existing else 0.0
        old_avg = existing["avg_cost"] if existing else 0.0
        new_qty = old_qty + quantity
        new_avg = (old_qty * old_avg + quantity * price) / new_qty
        new_cash = cash - cost
        await crud.update_cash(user_id, new_cash)
        await crud.upsert_position(user_id, ticker, new_qty, new_avg)
        position = {"ticker": ticker, "quantity": new_qty, "avg_cost": round(new_avg, 6)}
    else:  # sell
        if existing is None:
            raise TradeError(f"no position in {ticker} to sell")
        if quantity > existing["quantity"]:
            raise TradeError(
                f"insufficient shares: have {existing['quantity']}, tried to sell {quantity}"
            )
        proceeds = quantity * price
        new_qty = existing["quantity"] - quantity
        new_cash = cash + proceeds
        await crud.update_cash(user_id, new_cash)
        if new_qty <= 1e-9:
            await crud.delete_position(user_id, ticker)
            position = None
        else:
            await crud.upsert_position(user_id, ticker, new_qty, existing["avg_cost"])
            position = {
                "ticker": ticker,
                "quantity": new_qty,
                "avg_cost": existing["avg_cost"],
            }

    trade = await crud.add_trade(user_id, ticker, side, quantity, price)
    await _maybe_snapshot(user_id)

    return {"trade": trade, "cash_balance": new_cash, "position": position}


@router.get("")
async def get_portfolio() -> dict:
    profile = await crud.get_user_profile(USER_ID)
    cash = profile.get("cash_balance", 0.0)

    positions_out = []
    positions_value = 0.0
    total_unrealized = 0.0
    for pos in await crud.get_positions(USER_ID):
        ticker = pos["ticker"]
        qty = pos["quantity"]
        avg_cost = pos["avg_cost"]
        current_price = price_cache.get_price(ticker)
        if current_price is not None:
            market_value = qty * current_price
            unrealized = (current_price - avg_cost) * qty
            pnl_pct = ((current_price - avg_cost) / avg_cost * 100) if avg_cost else 0.0
            positions_value += market_value
            total_unrealized += unrealized
        else:
            unrealized = 0.0
            pnl_pct = 0.0
        positions_out.append(
            {
                "ticker": ticker,
                "quantity": qty,
                "avg_cost": avg_cost,
                "current_price": current_price,
                "unrealized_pnl": round(unrealized, 2),
                "pnl_pct": round(pnl_pct, 2),
            }
        )

    return {
        "cash_balance": round(cash, 2),
        "positions": positions_out,
        "total_value": round(cash + positions_value, 2),
        "unrealized_pnl": round(total_unrealized, 2),
    }


@router.post("/trade")
async def post_trade(body: TradeRequest) -> dict:
    try:
        result = await execute_trade(body.ticker, body.quantity, body.side)
    except TradeError as exc:
        raise HTTPException(
            status_code=400, detail={"success": False, "error": str(exc)}
        ) from exc
    return {
        "success": True,
        "trade": result["trade"],
        "cash_balance": round(result["cash_balance"], 2),
        "position": result["position"],
    }


@router.get("/history")
async def get_history() -> list[dict]:
    snapshots = await crud.get_portfolio_history(USER_ID, limit=200)
    return [
        {"total_value": s["total_value"], "recorded_at": s["recorded_at"]}
        for s in snapshots
    ]
