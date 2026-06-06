"""Shared application-wide singletons.

The price cache is a single in-memory instance shared across the market data
background task (writer), the SSE stream, portfolio valuation, and the chat
assistant's portfolio context (readers). main.py wires this instance into the
market data source and SSE router on startup.
"""

from __future__ import annotations

from app.market import PriceCache

price_cache = PriceCache()
