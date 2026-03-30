"""Tests for SSE streaming endpoint."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from app.market.cache import PriceCache
from app.market.stream import _generate_events, create_stream_router

# ---------------------------------------------------------------------------
# Router structure tests
# ---------------------------------------------------------------------------


class TestCreateStreamRouter:
    def test_returns_fresh_router_each_call(self):
        """Each call must return a distinct router instance — no shared module-level state."""
        cache = PriceCache()
        router1 = create_stream_router(cache)
        router2 = create_stream_router(cache)
        assert router1 is not router2

    def test_router_has_prices_route(self):
        """Router must register the /api/stream/prices route (prefix included)."""
        cache = PriceCache()
        router = create_stream_router(cache)
        paths = [route.path for route in router.routes]
        assert "/api/stream/prices" in paths

    def test_prices_route_accepts_get(self):
        """The /api/stream/prices route must respond to GET."""
        cache = PriceCache()
        router = create_stream_router(cache)
        for route in router.routes:
            if route.path == "/api/stream/prices":
                assert "GET" in route.methods
                return
        pytest.fail("No /api/stream/prices route found")

    def test_two_independent_routers_do_not_share_routes(self):
        """Calling the factory twice must not register duplicate routes on either router."""
        cache = PriceCache()
        router1 = create_stream_router(cache)
        router2 = create_stream_router(cache)
        assert sum(1 for r in router1.routes if r.path == "/api/stream/prices") == 1
        assert sum(1 for r in router2.routes if r.path == "/api/stream/prices") == 1


# ---------------------------------------------------------------------------
# Generator unit tests (mock Request — no ASGI server needed)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestGenerateEvents:
    """Unit tests for _generate_events using a mock Request."""

    def _make_request(self, disconnect_after: int) -> AsyncMock:
        """Return a mock Request that reports disconnected after N is_disconnected() calls."""
        request = AsyncMock()
        request.client = None
        call_count = 0

        async def is_disconnected() -> bool:
            nonlocal call_count
            call_count += 1
            return call_count > disconnect_after

        request.is_disconnected = is_disconnected
        return request

    async def test_yields_retry_preamble_first(self):
        """First yielded chunk must be the SSE retry directive."""
        cache = PriceCache()
        request = self._make_request(disconnect_after=0)

        events = []
        async for chunk in _generate_events(cache, request, interval=0.01):
            events.append(chunk)

        assert events[0] == "retry: 1000\n\n"

    async def test_emits_data_event_when_cache_has_prices(self):
        """A data event is emitted on the first loop iteration when cache is non-empty."""
        cache = PriceCache()
        cache.update("AAPL", 190.50)

        request = self._make_request(disconnect_after=1)

        events = []
        async for chunk in _generate_events(cache, request, interval=0.01):
            events.append(chunk)

        data_events = [e for e in events if e.startswith("data:")]
        assert len(data_events) == 1

        payload = json.loads(data_events[0].removeprefix("data: ").strip())
        assert "AAPL" in payload
        assert payload["AAPL"]["price"] == 190.50
        assert payload["AAPL"]["direction"] == "flat"

    async def test_no_data_event_when_cache_empty(self):
        """No data event is emitted when the cache is empty."""
        cache = PriceCache()
        request = self._make_request(disconnect_after=1)

        events = []
        async for chunk in _generate_events(cache, request, interval=0.01):
            events.append(chunk)

        data_events = [e for e in events if e.startswith("data:")]
        assert len(data_events) == 0

    async def test_version_change_detection_suppresses_duplicate_events(self):
        """When the cache version has not changed, no second data event is sent."""
        cache = PriceCache()
        cache.update("AAPL", 190.50)

        request = self._make_request(disconnect_after=3)

        events = []
        async for chunk in _generate_events(cache, request, interval=0.01):
            events.append(chunk)

        data_events = [e for e in events if e.startswith("data:")]
        assert len(data_events) == 1

    async def test_cache_update_between_iterations_triggers_second_event(self):
        """A cache update between iterations produces a second data event."""
        cache = PriceCache()
        cache.update("AAPL", 190.50)

        call_count = 0

        async def is_disconnected() -> bool:
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                cache.update("AAPL", 191.00)  # bump version mid-stream
            return call_count > 3

        request = AsyncMock()
        request.client = None
        request.is_disconnected = is_disconnected

        events = []
        async for chunk in _generate_events(cache, request, interval=0.01):
            events.append(chunk)

        data_events = [e for e in events if e.startswith("data:")]
        assert len(data_events) == 2

    async def test_data_event_contains_all_cached_tickers(self):
        """A single data event must contain every ticker currently in the cache."""
        cache = PriceCache()
        cache.update("AAPL", 190.50)
        cache.update("GOOGL", 175.25)
        cache.update("MSFT", 420.00)

        request = self._make_request(disconnect_after=1)

        events = []
        async for chunk in _generate_events(cache, request, interval=0.01):
            events.append(chunk)

        data_events = [e for e in events if e.startswith("data:")]
        payload = json.loads(data_events[0].removeprefix("data: ").strip())
        assert set(payload.keys()) == {"AAPL", "GOOGL", "MSFT"}

    async def test_payload_shape_matches_price_update_schema(self):
        """Each ticker entry in the payload must include all required fields."""
        cache = PriceCache()
        cache.update("AAPL", 190.00)
        cache.update("AAPL", 191.00)  # second update so direction is 'up'

        request = self._make_request(disconnect_after=1)

        events = []
        async for chunk in _generate_events(cache, request, interval=0.01):
            events.append(chunk)

        data_events = [e for e in events if e.startswith("data:")]
        payload = json.loads(data_events[0].removeprefix("data: ").strip())
        entry = payload["AAPL"]

        for field in ("ticker", "price", "previous_price", "timestamp", "change", "change_percent", "direction"):
            assert field in entry, f"Missing field: {field}"

        assert entry["direction"] == "up"
        assert entry["change"] == 1.0


# ---------------------------------------------------------------------------
# Endpoint response construction tests
#
# SSE endpoints produce an infinite stream, so standard ASGI test clients
# (ASGITransport, TestClient) hang waiting for http.response.complete which
# never arrives. Instead we invoke the route handler directly to inspect the
# StreamingResponse object — headers, media_type — without iterating the
# generator. Generator behaviour is fully covered by TestGenerateEvents above.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestStreamEndpointResponse:
    """Tests for the StreamingResponse returned by the /prices route handler."""

    async def _invoke_handler(self, cache: PriceCache):
        """Call the stream_prices handler directly and return its StreamingResponse."""
        router = create_stream_router(cache)
        request = AsyncMock()
        request.client = None
        request.is_disconnected = AsyncMock(return_value=True)

        for route in router.routes:
            if route.path == "/api/stream/prices":
                return await route.endpoint(request)
        pytest.fail("Route /api/stream/prices not found")

    async def test_media_type_is_text_event_stream(self):
        """Response media_type must be text/event-stream."""
        cache = PriceCache()
        response = await self._invoke_handler(cache)
        try:
            assert response.media_type == "text/event-stream"
        finally:
            await response.body_iterator.aclose()

    async def test_has_cache_control_no_cache(self):
        """Response must include Cache-Control: no-cache."""
        cache = PriceCache()
        response = await self._invoke_handler(cache)
        try:
            assert response.headers.get("cache-control") == "no-cache"
        finally:
            await response.body_iterator.aclose()

    async def test_has_connection_keep_alive(self):
        """Response must include Connection: keep-alive."""
        cache = PriceCache()
        response = await self._invoke_handler(cache)
        try:
            assert response.headers.get("connection") == "keep-alive"
        finally:
            await response.body_iterator.aclose()

    async def test_has_x_accel_buffering_no(self):
        """Response must include X-Accel-Buffering: no (disables nginx buffering)."""
        cache = PriceCache()
        response = await self._invoke_handler(cache)
        try:
            assert response.headers.get("x-accel-buffering") == "no"
        finally:
            await response.body_iterator.aclose()
