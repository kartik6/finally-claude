"""Build a readable portfolio context string for the LLM prompt."""

from __future__ import annotations

from app.db.crud import get_positions, get_user_profile, get_watchlist
from app.state import price_cache


async def build_portfolio_context(user_id: str = "default") -> str:
    """Assemble a human-readable snapshot of the user's portfolio for the LLM.

    Includes cash, each position with live price and unrealized P&L, current
    watchlist prices, and the total portfolio value.
    """
    profile = await get_user_profile(user_id)
    positions = await get_positions(user_id)
    watchlist = await get_watchlist(user_id)

    cash = profile.get("cash_balance", 0.0)

    lines = [f"Cash: ${cash:,.2f}"]

    positions_value = 0.0
    if positions:
        lines.append("Positions:")
        for pos in positions:
            ticker = pos["ticker"]
            qty = pos["quantity"]
            avg_cost = pos["avg_cost"]
            current = price_cache.get_price(ticker)
            if current is None:
                lines.append(
                    f"  {ticker}: {qty:g} shares @ avg ${avg_cost:,.2f}, "
                    f"current price unavailable"
                )
                continue
            positions_value += qty * current
            pnl = (current - avg_cost) * qty
            pnl_pct = ((current - avg_cost) / avg_cost * 100) if avg_cost else 0.0
            sign = "+" if pnl >= 0 else "-"
            lines.append(
                f"  {ticker}: {qty:g} shares @ avg ${avg_cost:,.2f}, "
                f"current ${current:,.2f}, "
                f"P&L: {sign}${abs(pnl):,.2f} ({sign}{abs(pnl_pct):.1f}%)"
            )
    else:
        lines.append("Positions: none")

    if watchlist:
        prices = []
        for entry in watchlist:
            ticker = entry["ticker"]
            price = price_cache.get_price(ticker)
            prices.append(f"{ticker}=${price:,.2f}" if price is not None else f"{ticker}=N/A")
        lines.append("Watchlist prices: " + ", ".join(prices))

    total_value = cash + positions_value
    lines.append(f"Total portfolio value: ${total_value:,.2f}")

    return "\n".join(lines)
