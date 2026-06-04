# Market Data Interface Design

Unified Python interface for market data in FinAlly. Two implementations (`SimulatorDataSource` and `MassiveDataSource`) sit behind one abstract interface (`MarketDataSource`). All downstream code — SSE streaming, portfolio valuation, trade execution — is source-agnostic and reads exclusively from the `PriceCache`.

---

## Module Layout

```
backend/app/market/
├── __init__.py          # Public re-exports
├── models.py            # PriceUpdate dataclass
├── interface.py         # MarketDataSource ABC
├── cache.py             # PriceCache (thread-safe in-memory store)
├── factory.py           # create_market_data_source() factory function
├── massive_client.py    # MassiveDataSource (Polygon.io REST poller)
├── simulator.py         # GBMSimulator + SimulatorDataSource
├── seed_prices.py       # SEED_PRICES, TICKER_PARAMS, correlation constants
└── stream.py            # FastAPI SSE endpoint factory
```

Public API (re-exported from `__init__.py`):
```python
from app.market import (
    PriceUpdate,
    PriceCache,
    MarketDataSource,
    create_market_data_source,
    create_stream_router,
)
```

---

## Core Data Model: PriceUpdate

The only data structure that leaves the market data layer. Everything downstream works with `PriceUpdate` objects.

```python
# backend/app/market/models.py
from dataclasses import dataclass, field
import time

@dataclass(frozen=True, slots=True)
class PriceUpdate:
    """Immutable snapshot of a single ticker's price at a point in time."""

    ticker: str
    price: float               # Current price, rounded to 2 decimal places
    previous_price: float      # Price from the prior update
    timestamp: float = field(default_factory=time.time)  # Unix seconds

    @property
    def change(self) -> float:
        """Absolute price change: price - previous_price (4 dp)."""
        return round(self.price - self.previous_price, 4)

    @property
    def change_percent(self) -> float:
        """Percentage change from previous price (4 dp)."""
        if self.previous_price == 0:
            return 0.0
        return round((self.price - self.previous_price) / self.previous_price * 100, 4)

    @property
    def direction(self) -> str:
        """'up', 'down', or 'flat'."""
        if self.price > self.previous_price:
            return "up"
        elif self.price < self.previous_price:
            return "down"
        return "flat"

    def to_dict(self) -> dict:
        """Serialize for JSON / SSE transmission."""
        return {
            "ticker": self.ticker,
            "price": self.price,
            "previous_price": self.previous_price,
            "timestamp": self.timestamp,
            "change": self.change,
            "change_percent": self.change_percent,
            "direction": self.direction,
        }
```

`frozen=True` and `slots=True` make `PriceUpdate` immutable and memory-efficient — safe to share across threads without copying.

---

## Abstract Interface: MarketDataSource

```python
# backend/app/market/interface.py
from abc import ABC, abstractmethod

class MarketDataSource(ABC):
    """Contract for market data providers.

    Implementations push price updates into a shared PriceCache on their own
    schedule. Downstream code never calls the data source directly for prices —
    it reads from the cache.
    """

    @abstractmethod
    async def start(self, tickers: list[str]) -> None:
        """Begin producing price updates. Starts a background asyncio task.
        Call exactly once at app startup."""

    @abstractmethod
    async def stop(self) -> None:
        """Stop the background task and release resources.
        Safe to call multiple times."""

    @abstractmethod
    async def add_ticker(self, ticker: str) -> None:
        """Add a ticker to the active set. No-op if already present."""

    @abstractmethod
    async def remove_ticker(self, ticker: str) -> None:
        """Remove a ticker from the active set and from the PriceCache."""

    @abstractmethod
    def get_tickers(self) -> list[str]:
        """Return the current list of actively tracked tickers."""
```

Both implementations write to a `PriceCache`. The interface does **not** return prices directly — producers push to the cache on their own schedule, consumers pull from the cache on demand.

---

## PriceCache

Shared in-memory store. Producers write; consumers read. Thread-safe via `threading.Lock`.

```python
# backend/app/market/cache.py
import time
from threading import Lock
from .models import PriceUpdate

class PriceCache:
    """Thread-safe cache of latest price per ticker.

    Writers: SimulatorDataSource or MassiveDataSource (one at a time, from asyncio tasks).
    Readers: SSE endpoint, portfolio valuation, trade execution (may be concurrent).
    """

    def __init__(self) -> None:
        self._prices: dict[str, PriceUpdate] = {}
        self._lock = Lock()
        self._version: int = 0   # Monotonically increasing; bumped on every update

    def update(self, ticker: str, price: float, timestamp: float | None = None) -> PriceUpdate:
        """Record a new price for a ticker. Returns the created PriceUpdate.

        On the first update for a ticker, previous_price == price (direction='flat').
        """
        with self._lock:
            ts = timestamp or time.time()
            prev = self._prices.get(ticker)
            previous_price = prev.price if prev else price
            update = PriceUpdate(
                ticker=ticker,
                price=round(price, 2),
                previous_price=round(previous_price, 2),
                timestamp=ts,
            )
            self._prices[ticker] = update
            self._version += 1
            return update

    def get(self, ticker: str) -> PriceUpdate | None:
        """Latest price for one ticker, or None if not yet seen."""
        with self._lock:
            return self._prices.get(ticker)

    def get_price(self, ticker: str) -> float | None:
        """Convenience: just the price float, or None."""
        update = self.get(ticker)
        return update.price if update else None

    def get_all(self) -> dict[str, PriceUpdate]:
        """Shallow copy of all current prices."""
        with self._lock:
            return dict(self._prices)

    def remove(self, ticker: str) -> None:
        """Remove a ticker from the cache (called when removed from watchlist)."""
        with self._lock:
            self._prices.pop(ticker, None)

    @property
    def version(self) -> int:
        """Monotonic counter incremented on every update.
        SSE endpoint uses this for change detection to avoid redundant pushes."""
        return self._version
```

### Why a version counter?

The SSE generator checks `price_cache.version` each iteration. It only serializes and sends an event when the version has changed since the last send. This avoids pushing unchanged data to clients and keeps CPU usage low when the data source is slow (e.g., Massive free tier at 15s intervals).

---

## Factory Function

Selects the data source at app startup based on environment:

```python
# backend/app/market/factory.py
import logging, os
from .cache import PriceCache
from .interface import MarketDataSource
from .massive_client import MassiveDataSource
from .simulator import SimulatorDataSource

logger = logging.getLogger(__name__)

def create_market_data_source(price_cache: PriceCache) -> MarketDataSource:
    """Return MassiveDataSource if MASSIVE_API_KEY is set, else SimulatorDataSource.

    Returns an unstarted source. Caller must await source.start(tickers).
    """
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if api_key:
        logger.info("Market data source: Massive API (real data)")
        return MassiveDataSource(api_key=api_key, price_cache=price_cache)
    else:
        logger.info("Market data source: GBM Simulator")
        return SimulatorDataSource(price_cache=price_cache)
```

---

## MassiveDataSource Implementation

Polls `GET /v2/snapshot/locale/us/markets/stocks/tickers` for all watched tickers in a single API call, then writes to `PriceCache`.

```python
# backend/app/market/massive_client.py
import asyncio, logging
from massive import RESTClient
from massive.rest.models import SnapshotMarketType
from .cache import PriceCache
from .interface import MarketDataSource

logger = logging.getLogger(__name__)

class MassiveDataSource(MarketDataSource):
    """Real market data via Massive (Polygon.io) REST API.

    Free tier:  5 req/min → poll_interval=15.0 (default)
    Paid tiers: unlimited → poll_interval=2.0–5.0
    """

    def __init__(self, api_key: str, price_cache: PriceCache, poll_interval: float = 15.0):
        self._api_key = api_key
        self._cache = price_cache
        self._interval = poll_interval
        self._tickers: list[str] = []
        self._task: asyncio.Task | None = None
        self._client: RESTClient | None = None

    async def start(self, tickers: list[str]) -> None:
        self._client = RESTClient(api_key=self._api_key)
        self._tickers = list(tickers)
        await self._poll_once()   # Immediate first poll so cache has data right away
        self._task = asyncio.create_task(self._poll_loop(), name="massive-poller")

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        self._client = None

    async def add_ticker(self, ticker: str) -> None:
        ticker = ticker.upper().strip()
        if ticker not in self._tickers:
            self._tickers.append(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        ticker = ticker.upper().strip()
        self._tickers = [t for t in self._tickers if t != ticker]
        self._cache.remove(ticker)

    def get_tickers(self) -> list[str]:
        return list(self._tickers)

    async def _poll_loop(self) -> None:
        """Sleep first (immediate poll already happened in start()), then loop."""
        while True:
            await asyncio.sleep(self._interval)
            await self._poll_once()

    async def _poll_once(self) -> None:
        if not self._tickers or not self._client:
            return
        try:
            # RESTClient is synchronous — run in thread to avoid blocking event loop
            snapshots = await asyncio.to_thread(self._fetch_snapshots)
            for snap in snapshots:
                try:
                    price = snap.last_trade.price
                    timestamp = snap.last_trade.timestamp / 1000.0  # ms → seconds
                    self._cache.update(ticker=snap.ticker, price=price, timestamp=timestamp)
                except (AttributeError, TypeError) as e:
                    logger.warning("Skipping snapshot for %s: %s", getattr(snap, "ticker", "?"), e)
        except Exception as e:
            logger.error("Massive poll failed: %s", e)
            # Don't re-raise — retry on next interval

    def _fetch_snapshots(self) -> list:
        """Synchronous Massive API call. Runs in a thread pool."""
        return self._client.get_snapshot_all(
            market_type=SnapshotMarketType.STOCKS,
            tickers=self._tickers,
        )
```

---

## SimulatorDataSource Implementation

Wraps `GBMSimulator` in an asyncio loop. See `MARKET_SIMULATOR.md` for the GBM math and simulator internals.

```python
# Part of backend/app/market/simulator.py
import asyncio, logging
from .cache import PriceCache
from .interface import MarketDataSource

logger = logging.getLogger(__name__)

class SimulatorDataSource(MarketDataSource):
    """MarketDataSource backed by GBM price simulation.

    Calls GBMSimulator.step() every `update_interval` seconds (default 500ms)
    and writes results to the PriceCache.
    """

    def __init__(self, price_cache: PriceCache, update_interval: float = 0.5,
                 event_probability: float = 0.001):
        self._cache = price_cache
        self._interval = update_interval
        self._event_prob = event_probability
        self._sim: GBMSimulator | None = None
        self._task: asyncio.Task | None = None

    async def start(self, tickers: list[str]) -> None:
        self._sim = GBMSimulator(tickers=tickers, event_probability=self._event_prob)
        # Seed cache with initial prices immediately
        for ticker in tickers:
            price = self._sim.get_price(ticker)
            if price is not None:
                self._cache.update(ticker=ticker, price=price)
        self._task = asyncio.create_task(self._run_loop(), name="simulator-loop")

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def add_ticker(self, ticker: str) -> None:
        if self._sim:
            self._sim.add_ticker(ticker)
            price = self._sim.get_price(ticker)
            if price is not None:
                self._cache.update(ticker=ticker, price=price)

    async def remove_ticker(self, ticker: str) -> None:
        if self._sim:
            self._sim.remove_ticker(ticker)
        self._cache.remove(ticker)

    def get_tickers(self) -> list[str]:
        return self._sim.get_tickers() if self._sim else []

    async def _run_loop(self) -> None:
        while True:
            try:
                if self._sim:
                    prices = self._sim.step()
                    for ticker, price in prices.items():
                        self._cache.update(ticker=ticker, price=price)
            except Exception:
                logger.exception("Simulator step failed")
            await asyncio.sleep(self._interval)
```

---

## SSE Streaming Endpoint

Reads from `PriceCache` and pushes updates to all connected `EventSource` clients.

```python
# backend/app/market/stream.py
import asyncio, json, logging
from collections.abc import AsyncGenerator
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from .cache import PriceCache

logger = logging.getLogger(__name__)

def create_stream_router(price_cache: PriceCache) -> APIRouter:
    """Factory: returns an APIRouter with the SSE endpoint bound to price_cache."""
    router = APIRouter(prefix="/api/stream", tags=["streaming"])

    @router.get("/prices")
    async def stream_prices(request: Request) -> StreamingResponse:
        return StreamingResponse(
            _generate_events(price_cache, request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # Disable nginx buffering if proxied
            },
        )

    return router


async def _generate_events(
    price_cache: PriceCache,
    request: Request,
    interval: float = 0.5,
) -> AsyncGenerator[str, None]:
    yield "retry: 1000\n\n"   # Tell browser to reconnect after 1s on disconnect

    last_version = -1
    while True:
        if await request.is_disconnected():
            break

        current_version = price_cache.version
        if current_version != last_version:
            last_version = current_version
            prices = price_cache.get_all()
            if prices:
                data = {ticker: update.to_dict() for ticker, update in prices.items()}
                yield f"data: {json.dumps(data)}\n\n"

        await asyncio.sleep(interval)
```

**SSE event format**:
```
data: {"AAPL": {"ticker": "AAPL", "price": 190.50, "previous_price": 190.35, "timestamp": 1711000000.0, "change": 0.15, "change_percent": 0.0789, "direction": "up"}, ...}

```
(Each event ends with a blank line `\n\n` per the SSE spec.)

**Frontend consumption**:
```javascript
const es = new EventSource('/api/stream/prices');
es.onmessage = (event) => {
  const prices = JSON.parse(event.data);  // { AAPL: {...}, GOOGL: {...}, ... }
  Object.entries(prices).forEach(([ticker, update]) => {
    updateTickerDisplay(ticker, update);
  });
};
```

---

## Application Lifecycle

### Startup (FastAPI lifespan)

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.market import PriceCache, create_market_data_source, create_stream_router

INITIAL_TICKERS = ["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX"]

price_cache = PriceCache()
market_source = create_market_data_source(price_cache)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await market_source.start(INITIAL_TICKERS)
    yield
    await market_source.stop()

app = FastAPI(lifespan=lifespan)
app.include_router(create_stream_router(price_cache))
```

### Watchlist Changes (API routes)

```python
@router.post("/api/watchlist")
async def add_ticker(body: AddTickerRequest):
    db.add_to_watchlist(body.ticker)
    await market_source.add_ticker(body.ticker)   # Updates live immediately
    return {"ticker": body.ticker}

@router.delete("/api/watchlist/{ticker}")
async def remove_ticker(ticker: str):
    db.remove_from_watchlist(ticker)
    await market_source.remove_ticker(ticker)     # Removes from cache too
    return {"ticker": ticker}
```

### Trade Execution (current price lookup)

```python
@router.post("/api/portfolio/trade")
async def execute_trade(body: TradeRequest):
    current_price = price_cache.get_price(body.ticker)
    if current_price is None:
        raise HTTPException(404, "No price data for ticker")
    # ... execute trade at current_price ...
```

### Portfolio Valuation

```python
def calculate_portfolio_value(positions: list[Position]) -> float:
    total = cash_balance
    for pos in positions:
        price = price_cache.get_price(pos.ticker) or pos.avg_cost
        total += pos.quantity * price
    return total
```

---

## Design Notes

| Decision | Rationale |
|---|---|
| Strategy pattern (ABC) | Swap simulator ↔ real data with zero downstream changes |
| Cache as intermediary | Decouples producers (polling/simulation) from consumers (SSE, trading); no direct coupling |
| Version counter in cache | Lets SSE skip iterations when no prices have changed — reduces CPU usage on slow poll intervals |
| `frozen=True` on PriceUpdate | Safe to share across threads without copying; computed properties are deterministic |
| `asyncio.to_thread()` for Massive | RESTClient is synchronous; running it in a thread pool keeps the event loop unblocked |
| Immediate first poll/seed | Both sources populate the cache before the first SSE client connects, so there's never a blank state |
| `remove_ticker` clears cache | Prevents stale data from appearing in SSE events for tickers no longer on the watchlist |
