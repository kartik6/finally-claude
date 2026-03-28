# Market Data Backend Design

Implementation-ready design for FinAlly's market data backend. This document consolidates the current planning docs, the archived design/review notes, and the existing `backend/app/market/` package into one concrete backend plan.

The design covers:
- A unified market data interface used by the rest of the backend
- The in-memory `PriceCache` as the single source of truth for live prices
- The GBM-based simulator used by default
- The Massive REST poller used when `MASSIVE_API_KEY` is configured
- SSE streaming for the frontend
- FastAPI lifecycle and watchlist coordination

Everything in this design maps to `backend/app/market/`.

---

## 1. Goals And Constraints

From the planning docs, the market data backend must satisfy these constraints:

- Default to a built-in simulator so the app works with zero external setup
- Switch to real data automatically when `MASSIVE_API_KEY` is present
- Expose one unified API so portfolio, trading, and streaming code do not care which data source is active
- Keep the latest price for each tracked ticker in memory for fast reads
- Support watchlist add/remove during runtime
- Stream updates over SSE rather than WebSockets
- Stay simple enough for a single-process FastAPI app inside one container

That leads to this architecture:

```text
                      +----------------------+
                      |   MarketDataSource   |
                      |      (ABC)           |
                      +----------+-----------+
                                 |
                  +--------------+--------------+
                  |                             |
      +-----------v-----------+     +-----------v-----------+
      | SimulatorDataSource   |     | MassiveDataSource     |
      | GBM + correlation      |     | REST snapshot poller  |
      +-----------+-----------+     +-----------+-----------+
                  |                             |
                  +--------------+--------------+
                                 |
                        writes PriceUpdate
                                 |
                      +----------v-----------+
                      |      PriceCache      |
                      | latest prices only   |
                      | version counter      |
                      +-----+-----------+----+
                            |           |
                      +-----v----+  +---v------------------+
                      | SSE      |  | Portfolio / Trading  |
                      | stream   |  | current price reads  |
                      +----------+  +----------------------+
```

---

## 2. Package Layout

Use the current module split in `backend/app/market/`:

```text
backend/app/market/
├── __init__.py
├── models.py
├── cache.py
├── interface.py
├── factory.py
├── seed_prices.py
├── simulator.py
├── massive_client.py
└── stream.py
```

Recommended responsibilities:

- `models.py`: immutable `PriceUpdate`
- `cache.py`: thread-safe `PriceCache`
- `interface.py`: `MarketDataSource` abstract contract
- `factory.py`: environment-based source selection
- `seed_prices.py`: simulator constants and correlation groups
- `simulator.py`: `GBMSimulator` and `SimulatorDataSource`
- `massive_client.py`: `MassiveDataSource`
- `stream.py`: SSE router factory and event generator

Public imports should stay centralized in `__init__.py`:

```python
from app.market import (
    PriceCache,
    PriceUpdate,
    MarketDataSource,
    create_market_data_source,
    create_stream_router,
)
```

---

## 3. Unified Data Contract

### 3.1 `PriceUpdate`

`PriceUpdate` is the only market data object that leaves the market subsystem. It represents the latest known price for one ticker.

```python
# backend/app/market/models.py
from dataclasses import dataclass, field
import time


@dataclass(frozen=True, slots=True)
class PriceUpdate:
    ticker: str
    price: float
    previous_price: float
    timestamp: float = field(default_factory=time.time)

    @property
    def change(self) -> float:
        return round(self.price - self.previous_price, 4)

    @property
    def change_percent(self) -> float:
        if self.previous_price == 0:
            return 0.0
        return round((self.price - self.previous_price) / self.previous_price * 100, 4)

    @property
    def direction(self) -> str:
        if self.price > self.previous_price:
            return "up"
        if self.price < self.previous_price:
            return "down"
        return "flat"

    def to_dict(self) -> dict:
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

Why this shape:

- `frozen=True`: safe to share across tasks and threads
- `slots=True`: lower memory overhead
- Computed fields avoid stale derived values
- `to_dict()` gives one serialization path for SSE and REST

### 3.2 `PriceCache`

`PriceCache` is the central read model for market data. Producers push into it. Consumers read from it.

```python
# backend/app/market/cache.py
import time
from threading import Lock


class PriceCache:
    def __init__(self) -> None:
        self._prices: dict[str, PriceUpdate] = {}
        self._lock = Lock()
        self._version = 0

    def update(self, ticker: str, price: float, timestamp: float | None = None) -> PriceUpdate:
        with self._lock:
            ts = timestamp or time.time()
            previous = self._prices.get(ticker)
            previous_price = previous.price if previous else price

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
        with self._lock:
            return self._prices.get(ticker)

    def get_price(self, ticker: str) -> float | None:
        update = self.get(ticker)
        return update.price if update else None

    def get_all(self) -> dict[str, PriceUpdate]:
        with self._lock:
            return dict(self._prices)

    def remove(self, ticker: str) -> None:
        with self._lock:
            self._prices.pop(ticker, None)

    @property
    def version(self) -> int:
        return self._version
```

Important behavior:

- The first update for a ticker sets `previous_price == price`, so direction starts as `flat`
- The cache only stores the latest price per ticker, so memory use is bounded
- The version counter lets the SSE layer skip redundant sends when no prices changed

### 3.3 `MarketDataSource`

Every market data provider must implement the same async lifecycle:

```python
# backend/app/market/interface.py
from abc import ABC, abstractmethod


class MarketDataSource(ABC):
    @abstractmethod
    async def start(self, tickers: list[str]) -> None:
        pass

    @abstractmethod
    async def stop(self) -> None:
        pass

    @abstractmethod
    async def add_ticker(self, ticker: str) -> None:
        pass

    @abstractmethod
    async def remove_ticker(self, ticker: str) -> None:
        pass

    @abstractmethod
    def get_tickers(self) -> list[str]:
        pass
```

Design rule: downstream code must never call the provider directly for a price. It always reads from `PriceCache`.

---

## 4. Source Selection

Use a factory so the rest of the app never branches on environment variables:

```python
# backend/app/market/factory.py
import os


def create_market_data_source(price_cache: PriceCache) -> MarketDataSource:
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()

    if api_key:
        return MassiveDataSource(api_key=api_key, price_cache=price_cache)
    return SimulatorDataSource(price_cache=price_cache)
```

Selection behavior:

- `MASSIVE_API_KEY` empty or missing: use simulator
- `MASSIVE_API_KEY` set: use Massive REST polling

This keeps the rest of the backend source-agnostic.

---

## 5. Simulator Design

The simulator is the default source because it gives immediate, dependency-free live data.

### 5.1 Constants And Seed Data

Keep these in `seed_prices.py`:

```python
SEED_PRICES = {
    "AAPL": 190.00,
    "GOOGL": 175.00,
    "MSFT": 420.00,
    "AMZN": 185.00,
    "TSLA": 250.00,
    "NVDA": 800.00,
    "META": 500.00,
    "JPM": 195.00,
    "V": 280.00,
    "NFLX": 600.00,
}

TICKER_PARAMS = {
    "AAPL": {"sigma": 0.22, "mu": 0.05},
    "GOOGL": {"sigma": 0.25, "mu": 0.05},
    "MSFT": {"sigma": 0.20, "mu": 0.05},
    "AMZN": {"sigma": 0.28, "mu": 0.05},
    "TSLA": {"sigma": 0.50, "mu": 0.03},
    "NVDA": {"sigma": 0.40, "mu": 0.08},
    "META": {"sigma": 0.30, "mu": 0.05},
    "JPM": {"sigma": 0.18, "mu": 0.04},
    "V": {"sigma": 0.17, "mu": 0.04},
    "NFLX": {"sigma": 0.35, "mu": 0.05},
}

DEFAULT_PARAMS = {"sigma": 0.25, "mu": 0.05}

CORRELATION_GROUPS = {
    "tech": {"AAPL", "GOOGL", "MSFT", "AMZN", "META", "NVDA", "NFLX"},
    "finance": {"JPM", "V"},
}

INTRA_TECH_CORR = 0.6
INTRA_FINANCE_CORR = 0.5
CROSS_GROUP_CORR = 0.3
TSLA_CORR = 0.3
```

Behavior for unknown tickers:

- Start at a random price between `$50` and `$300`
- Use `DEFAULT_PARAMS`
- Correlate at `CROSS_GROUP_CORR`

### 5.2 GBM Math

Use Geometric Brownian Motion:

```text
S(t + dt) = S(t) * exp((mu - sigma^2 / 2) * dt + sigma * sqrt(dt) * Z)
```

Where:

- `mu`: annualized drift
- `sigma`: annualized volatility
- `dt`: step size as a fraction of one trading year
- `Z`: standard normal random draw

For a 500ms update interval:

```python
TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600
DEFAULT_DT = 0.5 / TRADING_SECONDS_PER_YEAR
```

This gives small tick-level moves that accumulate realistically over time.

### 5.3 Correlated Moves

Do not simulate each ticker independently. Use a correlation matrix and Cholesky decomposition so related names move together.

```python
import numpy as np


def _rebuild_cholesky(self) -> None:
    n = len(self._tickers)
    if n <= 1:
        self._cholesky = None
        return

    corr = np.eye(n)
    for i in range(n):
        for j in range(i + 1, n):
            rho = self._pairwise_correlation(self._tickers[i], self._tickers[j])
            corr[i, j] = rho
            corr[j, i] = rho

    self._cholesky = np.linalg.cholesky(corr)
```

Pairwise correlation rule:

```python
@staticmethod
def _pairwise_correlation(t1: str, t2: str) -> float:
    tech = CORRELATION_GROUPS["tech"]
    finance = CORRELATION_GROUPS["finance"]

    if t1 == "TSLA" or t2 == "TSLA":
        return TSLA_CORR
    if t1 in tech and t2 in tech:
        return INTRA_TECH_CORR
    if t1 in finance and t2 in finance:
        return INTRA_FINANCE_CORR
    return CROSS_GROUP_CORR
```

### 5.4 Random Event Shocks

Pure GBM is mathematically clean but visually a bit too smooth for a dashboard. Add occasional shocks:

```python
if random.random() < self._event_prob:
    shock_magnitude = random.uniform(0.02, 0.05)
    shock_sign = random.choice([-1, 1])
    self._prices[ticker] *= 1 + shock_magnitude * shock_sign
```

Default:

- `event_probability = 0.001`
- Roughly one visible shock every few minutes per ticker, or about every minute across a 10-name watchlist

### 5.5 `GBMSimulator`

Recommended implementation:

```python
class GBMSimulator:
    TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600
    DEFAULT_DT = 0.5 / TRADING_SECONDS_PER_YEAR

    def __init__(self, tickers: list[str], dt: float = DEFAULT_DT, event_probability: float = 0.001) -> None:
        self._dt = dt
        self._event_prob = event_probability
        self._tickers: list[str] = []
        self._prices: dict[str, float] = {}
        self._params: dict[str, dict[str, float]] = {}
        self._cholesky: np.ndarray | None = None

        for ticker in tickers:
            self._add_ticker_internal(ticker)
        self._rebuild_cholesky()

    def step(self) -> dict[str, float]:
        n = len(self._tickers)
        if n == 0:
            return {}

        z_independent = np.random.standard_normal(n)
        z_correlated = self._cholesky @ z_independent if self._cholesky is not None else z_independent

        result: dict[str, float] = {}
        for i, ticker in enumerate(self._tickers):
            mu = self._params[ticker]["mu"]
            sigma = self._params[ticker]["sigma"]

            drift = (mu - 0.5 * sigma**2) * self._dt
            diffusion = sigma * math.sqrt(self._dt) * z_correlated[i]
            self._prices[ticker] *= math.exp(drift + diffusion)

            if random.random() < self._event_prob:
                shock = random.uniform(0.02, 0.05) * random.choice([-1, 1])
                self._prices[ticker] *= 1 + shock

            result[ticker] = round(self._prices[ticker], 2)

        return result

    def add_ticker(self, ticker: str) -> None:
        if ticker in self._prices:
            return
        self._add_ticker_internal(ticker)
        self._rebuild_cholesky()

    def remove_ticker(self, ticker: str) -> None:
        if ticker not in self._prices:
            return
        self._tickers.remove(ticker)
        del self._prices[ticker]
        del self._params[ticker]
        self._rebuild_cholesky()
```

### 5.6 `SimulatorDataSource`

Wrap the simulator in an async loop that writes into `PriceCache`:

```python
class SimulatorDataSource(MarketDataSource):
    def __init__(self, price_cache: PriceCache, update_interval: float = 0.5, event_probability: float = 0.001) -> None:
        self._cache = price_cache
        self._interval = update_interval
        self._event_prob = event_probability
        self._sim: GBMSimulator | None = None
        self._task: asyncio.Task | None = None

    async def start(self, tickers: list[str]) -> None:
        self._sim = GBMSimulator(tickers=tickers, event_probability=self._event_prob)

        for ticker in tickers:
            price = self._sim.get_price(ticker)
            if price is not None:
                self._cache.update(ticker=ticker, price=price)

        self._task = asyncio.create_task(self._run_loop(), name="simulator-loop")

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

Critical behavior:

- Seed the cache immediately in `start()` so the frontend sees prices on first connect
- On watchlist add, create a price immediately rather than waiting for the next tick
- On watchlist remove, delete from both simulator state and cache
- Keep the loop resilient by logging exceptions and continuing

---

## 6. Massive API Design

When `MASSIVE_API_KEY` exists, FinAlly should use real stock snapshots from Massive.

### 6.1 Polling Strategy

Use the multi-ticker snapshot endpoint so the whole watchlist is fetched in one request:

- Endpoint: `GET /v2/snapshot/locale/us/markets/stocks/tickers`
- Python SDK: `RESTClient.get_snapshot_all(...)`

This keeps the free tier viable because one poll covers the full watchlist.

Recommended defaults:

- Free tier: `poll_interval = 15.0`
- Paid tiers: `2.0` to `5.0`

### 6.2 `MassiveDataSource`

Use a background async loop, but execute the SDK call in a worker thread because the SDK client is synchronous:

```python
from massive import RESTClient
from massive.rest.models import SnapshotMarketType


class MassiveDataSource(MarketDataSource):
    def __init__(self, api_key: str, price_cache: PriceCache, poll_interval: float = 15.0) -> None:
        self._api_key = api_key
        self._cache = price_cache
        self._interval = poll_interval
        self._tickers: list[str] = []
        self._task: asyncio.Task | None = None
        self._client: RESTClient | None = None

    async def start(self, tickers: list[str]) -> None:
        self._client = RESTClient(api_key=self._api_key)
        self._tickers = list(tickers)
        await self._poll_once()
        self._task = asyncio.create_task(self._poll_loop(), name="massive-poller")

    async def add_ticker(self, ticker: str) -> None:
        ticker = ticker.upper().strip()
        if ticker not in self._tickers:
            self._tickers.append(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        ticker = ticker.upper().strip()
        self._tickers = [t for t in self._tickers if t != ticker]
        self._cache.remove(ticker)

    async def _poll_once(self) -> None:
        if not self._tickers or not self._client:
            return

        try:
            snapshots = await asyncio.to_thread(self._fetch_snapshots)
            for snap in snapshots:
                try:
                    price = snap.last_trade.price
                    timestamp = normalize_massive_timestamp(snap.last_trade.timestamp)
                    self._cache.update(ticker=snap.ticker, price=price, timestamp=timestamp)
                except (AttributeError, TypeError, ValueError) as exc:
                    logger.warning("Skipping snapshot for %s: %s", getattr(snap, "ticker", "?"), exc)
        except Exception as exc:
            logger.error("Massive poll failed: %s", exc)
```

### 6.3 Timestamp Normalization

The planning docs disagree on whether the SDK exposes milliseconds or nanoseconds for `last_trade.timestamp`. The safest design is to normalize by magnitude rather than assume one unit forever.

```python
def normalize_massive_timestamp(raw: int | float | None) -> float:
    if raw is None:
        return time.time()

    value = float(raw)

    # nanoseconds
    if value >= 1e17:
        return value / 1e9

    # milliseconds
    if value >= 1e12:
        return value / 1e3

    # seconds
    if value >= 1e9:
        return value

    raise ValueError(f"Unexpected Massive timestamp: {raw}")
```

This is worth documenting even if the current implementation uses milliseconds directly, because it hardens the integration against SDK differences.

### 6.4 Snapshot Fetch Helper

Keep the external call isolated in one method so it is easy to mock in tests:

```python
def _fetch_snapshots(self) -> list:
    return self._client.get_snapshot_all(
        market_type=SnapshotMarketType.STOCKS,
        tickers=self._tickers,
    )
```

### 6.5 Error Handling

The poller must never crash the app.

Expected failure cases:

- `401`: invalid API key
- `429`: rate limit exceeded
- `5xx`: upstream issue
- missing `last_trade`: malformed or illiquid snapshot

Policy:

- Log and continue
- Do not clear existing cache entries on temporary upstream errors
- Retry on the next scheduled interval

### 6.6 Massive-Specific Behavior

When a ticker is added:

- Add it to the active ticker list immediately
- Do not block the request waiting for a dedicated fetch
- Let it appear on the next scheduled poll

When a ticker is removed:

- Remove from the active list immediately
- Remove from `PriceCache` immediately so SSE payloads stop including it

---

## 7. SSE Streaming Design

The frontend should receive live updates from `GET /api/stream/prices` via native `EventSource`.

### 7.1 Router Factory

Create the router with dependency injection rather than using globals:

```python
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse


def create_stream_router(price_cache: PriceCache) -> APIRouter:
    router = APIRouter(prefix="/api/stream", tags=["streaming"])

    @router.get("/prices")
    async def stream_prices(request: Request) -> StreamingResponse:
        return StreamingResponse(
            _generate_events(price_cache, request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return router
```

Note: the current code uses a module-level router object. For a pure design, prefer creating a fresh router inside the factory to avoid duplicate route registration in tests.

### 7.2 Event Generator

Push only when data changed:

```python
from collections.abc import AsyncGenerator
import asyncio
import json


async def _generate_events(
    price_cache: PriceCache,
    request: Request,
    interval: float = 0.5,
) -> AsyncGenerator[str, None]:
    yield "retry: 1000\n\n"

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

Why version-based push is important:

- Massive may only update every 15 seconds
- Without change detection, the server would resend identical payloads every 500ms
- This reduces CPU, serialization work, and frontend churn

### 7.3 SSE Payload Shape

Each event should contain the full latest snapshot for all tracked tickers:

```json
{
  "AAPL": {
    "ticker": "AAPL",
    "price": 190.5,
    "previous_price": 190.35,
    "timestamp": 1711000000.0,
    "change": 0.15,
    "change_percent": 0.0789,
    "direction": "up"
  },
  "GOOGL": {
    "ticker": "GOOGL",
    "price": 175.25,
    "previous_price": 175.25,
    "timestamp": 1711000000.0,
    "change": 0.0,
    "change_percent": 0.0,
    "direction": "flat"
  }
}
```

The frontend can then:

- update watchlist rows
- flash green/red based on `direction`
- append price points for sparklines
- update portfolio value from cached current prices

### 7.4 Frontend Usage Example

```ts
const source = new EventSource("/api/stream/prices");

source.onmessage = (event) => {
  const payload = JSON.parse(event.data) as Record<string, PriceUpdate>;

  for (const [ticker, update] of Object.entries(payload)) {
    store.upsertPrice(ticker, update);
  }
};

source.onerror = () => {
  store.setConnectionState("reconnecting");
};
```

---

## 8. FastAPI Lifecycle And Coordination

The market source should be created once at app startup and shut down once at app shutdown.

### 8.1 App Startup

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

from app.market import PriceCache, create_market_data_source, create_stream_router


INITIAL_TICKERS = [
    "AAPL", "GOOGL", "MSFT", "AMZN", "TSLA",
    "NVDA", "META", "JPM", "V", "NFLX",
]

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

In the full app, `INITIAL_TICKERS` should come from the database watchlist seed, not a duplicated constant.

### 8.2 Watchlist Add/Remove

Keep the database and market source in sync from the watchlist API:

```python
@router.post("/api/watchlist")
async def add_watchlist_ticker(body: AddTickerRequest):
    ticker = body.ticker.upper().strip()
    db.add_to_watchlist(user_id="default", ticker=ticker)
    await market_source.add_ticker(ticker)
    return {"ticker": ticker}


@router.delete("/api/watchlist/{ticker}")
async def remove_watchlist_ticker(ticker: str):
    ticker = ticker.upper().strip()
    db.remove_from_watchlist(user_id="default", ticker=ticker)
    await market_source.remove_ticker(ticker)
    return {"ticker": ticker}
```

Ordering matters:

- Persist the watchlist change first
- Then update the live market source
- On remove, clear cache immediately so the frontend stops receiving that ticker

### 8.3 Trade Execution Reads

Trading logic should read the current price from `PriceCache`:

```python
@router.post("/api/portfolio/trade")
async def execute_trade(body: TradeRequest):
    ticker = body.ticker.upper().strip()
    current_price = price_cache.get_price(ticker)
    if current_price is None:
        raise HTTPException(status_code=400, detail=f"No live price for {ticker}")

    result = portfolio_service.execute_market_order(
        ticker=ticker,
        side=body.side,
        quantity=body.quantity,
        execution_price=current_price,
    )
    return result
```

This is the key payoff of the design: portfolio and trade code do not know whether the price came from a simulator or the Massive API.

---

## 9. End-To-End Flow

### 9.1 Simulator Mode

1. App starts.
2. `create_market_data_source()` returns `SimulatorDataSource`.
3. `start()` builds a `GBMSimulator` and seeds cache prices immediately.
4. Background loop updates prices every 500ms.
5. `PriceCache.version` increments on every update.
6. SSE clients receive only changed payloads.
7. Trades and portfolio valuation read from the cache.

### 9.2 Massive Mode

1. App starts with `MASSIVE_API_KEY`.
2. `create_market_data_source()` returns `MassiveDataSource`.
3. `start()` creates `RESTClient`, stores watchlist tickers, and performs an immediate poll.
4. Background loop polls snapshots every 15 seconds by default.
5. Snapshot prices are normalized into `PriceUpdate` objects and written to the cache.
6. SSE clients receive updated payloads only when the cache version changes.
7. Trades execute against the latest cached real price.

---

## 10. Testing Strategy

The existing tests already cover most of this package. Keep that split and expand it as the app grows.

### 10.1 Unit Tests

- `test_models.py`: `PriceUpdate` behavior and derived fields
- `test_cache.py`: update/remove/version/rounding behavior
- `test_factory.py`: source selection by environment
- `test_simulator.py`: GBM stepping, ticker add/remove, correlation helpers
- `test_simulator_source.py`: async loop integration and cache population
- `test_massive.py`: polling, malformed snapshot handling, ticker normalization

### 10.2 Additional Tests Worth Adding

- SSE integration test with an ASGI client
- Thread-safety test that writes to `PriceCache` from multiple threads
- Timestamp normalization test that covers seconds, milliseconds, and nanoseconds
- Full default-watchlist simulator initialization test to catch correlation matrix regressions

Example Massive test pattern:

```python
with patch.object(source, "_fetch_snapshots", return_value=[mock_snapshot]):
    await source._poll_once()

assert cache.get_price("AAPL") == 190.50
```

---

## 11. Implementation Notes And Edge Cases

### 11.1 Keep `PriceCache` As The Only Live Price Store

Do not add parallel caches in trade or portfolio code. Any duplicated price state will drift.

### 11.2 Seed Immediately

Both data sources should populate cache state before the frontend opens its first SSE stream:

- simulator: seed from `SEED_PRICES`
- Massive: immediate first poll in `start()`

### 11.3 Normalize Ticker Symbols

At API boundaries:

- `upper()`
- `strip()`

This avoids duplicates like `"aapl"` and `" AAPL "`.

### 11.4 Handle Missing Real Data Gracefully

If Massive returns a ticker without `last_trade`:

- skip that ticker for that poll
- keep the previous cache entry if it exists
- log a warning

### 11.5 Stop Is Idempotent

`stop()` should be safe to call multiple times in both sources. This matters for clean shutdown in tests and app lifespan cleanup.

### 11.6 Prefer Fresh Router Instances

The current code keeps a module-level `router` in `stream.py`. That works in the app, but a fresh router created inside `create_stream_router()` is cleaner and more test-friendly.

---

## 12. Minimal Integration Example

This is the smallest end-to-end example showing how the rest of the backend should consume the market package:

```python
from fastapi import FastAPI
from contextlib import asynccontextmanager

from app.market import PriceCache, create_market_data_source, create_stream_router


WATCHLIST = ["AAPL", "GOOGL", "MSFT"]

price_cache = PriceCache()
market_source = create_market_data_source(price_cache)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await market_source.start(WATCHLIST)
    yield
    await market_source.stop()


app = FastAPI(lifespan=lifespan)
app.include_router(create_stream_router(price_cache))


@app.get("/api/watchlist")
async def get_watchlist():
    prices = price_cache.get_all()
    return [
        {
            "ticker": ticker,
            "price": prices[ticker].price if ticker in prices else None,
            "direction": prices[ticker].direction if ticker in prices else "flat",
        }
        for ticker in market_source.get_tickers()
    ]
```

---

## 13. Recommended Final Shape

The market data backend should keep these boundaries:

- `MarketDataSource` owns production of live prices
- `PriceCache` owns the latest normalized price state
- `stream.py` owns SSE serialization and connection handling
- Portfolio and trade code only read from `PriceCache`
- Watchlist routes coordinate database state with the active source

That gives FinAlly one clean contract for both fake and real market data, while keeping the implementation simple enough for a single-process FastAPI backend.
