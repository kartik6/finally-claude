"""LLM integration for the FinAlly chat assistant.

Public API:
    get_llm_response       - Call the assistant (mock-aware) for a structured reply
    build_portfolio_context - Format the user's portfolio for the prompt
    LLMResponse, TradeIntent, WatchlistChange - Structured output schemas
"""

from .client import get_llm_response
from .context import build_portfolio_context
from .schemas import LLMResponse, TradeIntent, WatchlistChange

__all__ = [
    "get_llm_response",
    "build_portfolio_context",
    "LLMResponse",
    "TradeIntent",
    "WatchlistChange",
]
