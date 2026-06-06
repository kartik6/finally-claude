"""Chat router: LLM assistant with trade and watchlist auto-execution."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, field_validator

from app.db import crud
from app.llm import LLMResponse, build_portfolio_context, get_llm_response
from app.routers.portfolio import TradeError, execute_trade

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])

USER_ID = "default"
HISTORY_LIMIT = 20


class ChatRequest(BaseModel):
    message: str

    @field_validator("message")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message must not be empty")
        return v


async def _execute_trades(llm_response: LLMResponse) -> list[dict]:
    results: list[dict] = []
    for trade in llm_response.trades:
        result = {
            "ticker": trade.ticker.upper(),
            "side": trade.side,
            "quantity": trade.quantity,
        }
        try:
            executed = await execute_trade(trade.ticker, trade.quantity, trade.side)
            result["price"] = executed["trade"]["price"]
            result["status"] = "ok"
        except TradeError as exc:
            result["status"] = "error"
            result["reason"] = str(exc)
        results.append(result)
    return results


async def _execute_watchlist_changes(
    llm_response: LLMResponse, request: Request
) -> list[dict]:
    source = getattr(request.app.state, "market_source", None)
    results: list[dict] = []
    for change in llm_response.watchlist_changes:
        ticker = change.ticker.upper()
        result: dict = {"ticker": ticker, "action": change.action}
        try:
            if change.action == "add":
                await crud.add_to_watchlist(USER_ID, ticker)
                if source is not None:
                    await source.add_ticker(ticker)
            else:  # remove
                removed = await crud.remove_from_watchlist(USER_ID, ticker)
                if not removed:
                    raise ValueError(f"{ticker} is not in the watchlist")
                if source is not None:
                    await source.remove_ticker(ticker)
            result["status"] = "ok"
        except ValueError as exc:
            result["status"] = "error"
            result["reason"] = str(exc)
        results.append(result)
    return results


@router.post("")
async def post_chat(body: ChatRequest, request: Request) -> dict:
    portfolio_context = await build_portfolio_context(USER_ID)

    history_rows = await crud.get_chat_messages(USER_ID, limit=HISTORY_LIMIT)
    history = [{"role": row["role"], "content": row["content"]} for row in history_rows]

    llm_response = await get_llm_response(body.message, portfolio_context, history)

    await crud.add_chat_message(USER_ID, "user", body.message)

    trade_results = await _execute_trades(llm_response)
    watchlist_results = await _execute_watchlist_changes(llm_response, request)

    actions = {"trades": trade_results, "watchlist_changes": watchlist_results}
    await crud.add_chat_message(USER_ID, "assistant", llm_response.message, actions)

    return {
        "message": llm_response.message,
        "trades": trade_results,
        "watchlist_changes": watchlist_results,
    }
