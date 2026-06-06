"""LLM client: calls Cerebras via LiteLLM/OpenRouter with structured outputs."""

from __future__ import annotations

import asyncio
import json
import logging
import os

from litellm import completion

from .schemas import LLMResponse, TradeIntent

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "openrouter/openai/gpt-oss-120b"
EXTRA_BODY = {"provider": {"order": ["cerebras"]}}

SYSTEM_PROMPT = (
    "You are FinAlly, an AI trading assistant. Analyze portfolios, suggest "
    "trades, and execute them when asked. Be concise and data-driven. Manage "
    "the watchlist when helpful. Always respond with valid JSON matching the "
    "required schema. If a requested trade cannot be executed (e.g. insufficient "
    "cash or shares), explain why in the message field."
)

MOCK_RESPONSE = LLMResponse(
    message=(
        "I've reviewed your portfolio. You have $10,000 in cash and no open "
        "positions. I'll buy 5 shares of AAPL to get you started."
    ),
    trades=[TradeIntent(ticker="AAPL", side="buy", quantity=5)],
    watchlist_changes=[],
)


def _is_mock() -> bool:
    return os.getenv("LLM_MOCK", "").strip().lower() == "true"


def _model() -> str:
    return os.getenv("LLM_MODEL", DEFAULT_MODEL)


def _build_messages(
    user_message: str,
    portfolio_context: str,
    conversation_history: list[dict],
) -> list[dict]:
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"Current portfolio state:\n{portfolio_context}"},
    ]
    for msg in conversation_history:
        role = msg.get("role")
        content = msg.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})
    return messages


def _call_sync(messages: list[dict]) -> LLMResponse:
    response = completion(
        model=_model(),
        messages=messages,
        response_format=LLMResponse,
        extra_body=EXTRA_BODY,
    )
    content = response.choices[0].message.content
    return LLMResponse.model_validate_json(content)


async def get_llm_response(
    user_message: str,
    portfolio_context: str,
    conversation_history: list[dict],
) -> LLMResponse:
    """Return the assistant's structured response to a user chat message.

    In mock mode returns a fixed deterministic response. Otherwise calls
    Cerebras via LiteLLM with structured outputs. Any error (network, parse,
    validation) is caught and surfaced as a plain message with no actions.
    """
    if _is_mock():
        return MOCK_RESPONSE.model_copy(deep=True)

    messages = _build_messages(user_message, portfolio_context, conversation_history)

    try:
        return await asyncio.to_thread(_call_sync, messages)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Failed to parse LLM response: %s", exc)
        return LLMResponse(
            message=(
                "I had trouble formulating a response just now. Please try "
                "rephrasing your request."
            )
        )
    except Exception as exc:  # noqa: BLE001 - surface any provider error gracefully
        logger.error("LLM call failed: %s", exc)
        return LLMResponse(
            message=(
                "I'm unable to reach the AI service right now. Please try again "
                "in a moment."
            )
        )
