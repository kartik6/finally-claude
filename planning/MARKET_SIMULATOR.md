# Market Simulator Design

Approach and code structure for simulating realistic stock prices when no `MASSIVE_API_KEY` is configured. Lives in `backend/app/market/simulator.py` and `backend/app/market/seed_prices.py`.

---

## Overview

The simulator uses **Geometric Brownian Motion (GBM)** to generate realistic stock price paths. GBM is the standard model underlying Black-Scholes option pricing — prices evolve multiplicatively with random noise, can never go negative, and exhibit the lognormal distribution observed in real equity markets.

Key properties:
- Updates at 500ms intervals for a continuous, live-feeling stream
- Each ticker has its own calibrated volatility and drift
- Correlated moves across related stocks (tech stocks move together, etc.)
- Occasional random "events" — sudden 2–5% moves for visual drama

---

## GBM Mathematics

At each time step, a stock price evolves as:

```
S(t + dt) = S(t) × exp((μ - σ²/2) × dt + σ × √dt × Z)
```

| Symbol | Meaning |
|--------|---------|
| `S(t)` | Current price |
| `μ` (mu) | Annualized drift (expected return), e.g. `0.05` = 5%/year |
| `σ` (sigma) | Annualized volatility, e.g. `0.20` = 20%/year |
| `dt` | Time step as fraction of a trading year |
| `Z` | Standard normal random variable drawn from N(0,1) |

The `exp()` ensures prices remain strictly positive. The `(μ - σ²/2)` term is Itô's correction — without it, the expected log-return would be biased upward.

### Computing dt

A 500ms update interval expressed as a fraction of a trading year:

```
trading_seconds_per_year = 252 days × 6.5 hours/day × 3600 s/hour = 5,896,800 s
dt = 0.5 / 5,896,800 ≈ 8.48e-8
```

This tiny `dt` produces sub-cent moves per tick. At `σ=0.20` and `dt=8.48e-8`, the standard deviation of a single step is:

```
σ × √dt × S = 0.20 × √(8.48e-8) × 190 ≈ $0.011 per tick for AAPL
```

Over a simulated trading day (~47,000 ticks at 500ms), these accumulate to realistic intraday ranges.

---

## Correlated Moves

Real stocks don't move independently — tech stocks tend to move together, financial stocks correlate, etc. The simulator uses a **Cholesky decomposition** of a sector-based correlation matrix to generate correlated random draws.

### How Cholesky Correlation Works

Given a symmetric positive-definite correlation matrix `C`, compute `L` such that `C = L × Lᵀ` (Cholesky factorization). Then for a vector of independent standard normals `Z_independent`:

```python
Z_correlated = L @ Z_independent
```

The result `Z_correlated` has the desired pairwise correlations. Each `Z_correlated[i]` is used as the `Z` for ticker `i` in the GBM formula.

### Correlation Structure

```python
# backend/app/market/seed_prices.py

CORRELATION_GROUPS = {
    "tech":    {"AAPL", "GOOGL", "MSFT", "AMZN", "META", "NVDA", "NFLX"},
    "finance": {"JPM", "V"},
}

INTRA_TECH_CORR    = 0.6   # Within tech sector
INTRA_FINANCE_CORR = 0.5   # Within finance sector
CROSS_GROUP_CORR   = 0.3   # Cross-sector or unknown tickers
TSLA_CORR          = 0.3   # TSLA is in tech set but does its own thing
```

Correlation lookup for any pair `(t1, t2)`:

```python
@staticmethod
def _pairwise_correlation(t1: str, t2: str) -> float:
    tech    = CORRELATION_GROUPS["tech"]
    finance = CORRELATION_GROUPS["finance"]

    if t1 == "TSLA" or t2 == "TSLA":
        return TSLA_CORR

    if t1 in tech and t2 in tech:
        return INTRA_TECH_CORR
    if t1 in finance and t2 in finance:
        return INTRA_FINANCE_CORR

    return CROSS_GROUP_CORR   # Cross-sector or both unknown
```

### Rebuilding the Cholesky Matrix

Whenever a ticker is added or removed, `_rebuild_cholesky()` reconstructs the `n×n` correlation matrix and recomputes the Cholesky factor:

```python
def _rebuild_cholesky(self) -> None:
    n = len(self._tickers)
    if n <= 1:
        self._cholesky = None   # No correlation needed for a single ticker
        return

    corr = np.eye(n)
    for i in range(n):
        for j in range(i + 1, n):
            rho = self._pairwise_correlation(self._tickers[i], self._tickers[j])
            corr[i, j] = rho
            corr[j, i] = rho

    self._cholesky = np.linalg.cholesky(corr)
```

This is O(n²) but `n` is always small (< 50 tickers), so it completes in microseconds. The Cholesky decomposition is only valid for positive semi-definite matrices — our correlation values (all ≥ 0, diagonal = 1) guarantee this.

---

## Random Events

Every step, each ticker has a small independent probability of a sudden shock — a 2–5% move up or down. This adds drama and makes the dashboard visually interesting.

```python
EVENT_PROBABILITY = 0.001   # 0.1% chance per ticker per tick

if random.random() < self._event_prob:
    shock_magnitude = random.uniform(0.02, 0.05)     # 2%–5%
    shock_sign = random.choice([-1, 1])              # Up or down
    self._prices[ticker] *= 1 + shock_magnitude * shock_sign
```

Expected event frequency:
- **Per ticker**: 0.1% × 2 ticks/second = ~1 event every 500 seconds (~8 minutes)
- **Any ticker in a 10-ticker watchlist**: ~1 event every 50 seconds

---

## Seed Prices and Per-Ticker Parameters

```python
# backend/app/market/seed_prices.py

SEED_PRICES: dict[str, float] = {
    "AAPL":  190.00,
    "GOOGL": 175.00,
    "MSFT":  420.00,
    "AMZN":  185.00,
    "TSLA":  250.00,
    "NVDA":  800.00,
    "META":  500.00,
    "JPM":   195.00,
    "V":     280.00,
    "NFLX":  600.00,
}

TICKER_PARAMS: dict[str, dict[str, float]] = {
    "AAPL":  {"sigma": 0.22, "mu": 0.05},   # Stable large-cap
    "GOOGL": {"sigma": 0.25, "mu": 0.05},
    "MSFT":  {"sigma": 0.20, "mu": 0.05},   # Lowest vol in tech
    "AMZN":  {"sigma": 0.28, "mu": 0.05},
    "TSLA":  {"sigma": 0.50, "mu": 0.03},   # High volatility, lower drift
    "NVDA":  {"sigma": 0.40, "mu": 0.08},   # High vol + strong upward drift
    "META":  {"sigma": 0.30, "mu": 0.05},
    "JPM":   {"sigma": 0.18, "mu": 0.04},   # Low vol (bank)
    "V":     {"sigma": 0.17, "mu": 0.04},   # Lowest vol (stable payments)
    "NFLX":  {"sigma": 0.35, "mu": 0.05},
}

DEFAULT_PARAMS: dict[str, float] = {"sigma": 0.25, "mu": 0.05}
```

Tickers added dynamically (not in `SEED_PRICES`) start at a random price between $50–$300 and use `DEFAULT_PARAMS`.

### Calibration rationale

| Ticker | σ | Rationale |
|--------|---|-----------|
| V, JPM | 0.17–0.18 | Large stable financials; low intraday vol |
| MSFT | 0.20 | Most stable of the megacap tech |
| AAPL | 0.22 | Slightly more volatile than MSFT |
| GOOGL | 0.25 | Mid-range tech vol |
| AMZN | 0.28 | Broader business mix = more uncertainty |
| META | 0.30 | Higher than FAANG average |
| NFLX | 0.35 | Subscription churn risk → higher vol |
| NVDA | 0.40 | AI/semiconductor cycle = high vol |
| TSLA | 0.50 | Most volatile of the defaults; driven by news/Elon |

---

## GBMSimulator Class

Full implementation (in `backend/app/market/simulator.py`):

```python
import math, random, logging
import numpy as np
from .seed_prices import (
    CORRELATION_GROUPS, CROSS_GROUP_CORR, DEFAULT_PARAMS,
    INTRA_FINANCE_CORR, INTRA_TECH_CORR, SEED_PRICES, TICKER_PARAMS, TSLA_CORR,
)

logger = logging.getLogger(__name__)


class GBMSimulator:
    """Generates correlated GBM price paths for multiple tickers.

    Math:
        S(t+dt) = S(t) * exp((mu - sigma^2/2)*dt + sigma*sqrt(dt)*Z)

    Where Z is drawn from a correlated multivariate normal via Cholesky decomposition.
    """

    TRADING_SECONDS_PER_YEAR = 252 * 6.5 * 3600  # 5,896,800
    DEFAULT_DT = 0.5 / TRADING_SECONDS_PER_YEAR   # ~8.48e-8

    def __init__(
        self,
        tickers: list[str],
        dt: float = DEFAULT_DT,
        event_probability: float = 0.001,
    ) -> None:
        self._dt = dt
        self._event_prob = event_probability
        self._tickers: list[str] = []
        self._prices: dict[str, float] = {}
        self._params: dict[str, dict[str, float]] = {}
        self._cholesky: np.ndarray | None = None

        for ticker in tickers:
            self._add_ticker_internal(ticker)   # Batch add without rebuilding Cholesky
        self._rebuild_cholesky()                # Rebuild once after all tickers added

    # --- Public API ---

    def step(self) -> dict[str, float]:
        """Advance all tickers by one time step. Returns {ticker: new_price}.

        Hot path — called every 500ms. O(n) with a numpy matmul for correlation.
        """
        n = len(self._tickers)
        if n == 0:
            return {}

        z_independent = np.random.standard_normal(n)
        z_correlated = self._cholesky @ z_independent if self._cholesky is not None else z_independent

        result: dict[str, float] = {}
        for i, ticker in enumerate(self._tickers):
            mu = self._params[ticker]["mu"]
            sigma = self._params[ticker]["sigma"]

            # GBM step
            drift = (mu - 0.5 * sigma**2) * self._dt
            diffusion = sigma * math.sqrt(self._dt) * z_correlated[i]
            self._prices[ticker] *= math.exp(drift + diffusion)

            # Random event
            if random.random() < self._event_prob:
                shock = random.uniform(0.02, 0.05) * random.choice([-1, 1])
                self._prices[ticker] *= (1 + shock)
                logger.debug("Random event on %s: %.1f%%", ticker, shock * 100)

            result[ticker] = round(self._prices[ticker], 2)

        return result

    def add_ticker(self, ticker: str) -> None:
        """Add a ticker mid-session. Rebuilds the Cholesky matrix."""
        if ticker in self._prices:
            return
        self._add_ticker_internal(ticker)
        self._rebuild_cholesky()

    def remove_ticker(self, ticker: str) -> None:
        """Remove a ticker mid-session. Rebuilds the Cholesky matrix."""
        if ticker not in self._prices:
            return
        self._tickers.remove(ticker)
        del self._prices[ticker]
        del self._params[ticker]
        self._rebuild_cholesky()

    def get_price(self, ticker: str) -> float | None:
        return self._prices.get(ticker)

    def get_tickers(self) -> list[str]:
        return list(self._tickers)

    # --- Internals ---

    def _add_ticker_internal(self, ticker: str) -> None:
        """Add without rebuilding Cholesky (for batch initialization)."""
        if ticker in self._prices:
            return
        self._tickers.append(ticker)
        self._prices[ticker] = SEED_PRICES.get(ticker, random.uniform(50.0, 300.0))
        self._params[ticker] = TICKER_PARAMS.get(ticker, dict(DEFAULT_PARAMS))

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

    @staticmethod
    def _pairwise_correlation(t1: str, t2: str) -> float:
        tech    = CORRELATION_GROUPS["tech"]
        finance = CORRELATION_GROUPS["finance"]
        if t1 == "TSLA" or t2 == "TSLA":
            return TSLA_CORR
        if t1 in tech and t2 in tech:
            return INTRA_TECH_CORR
        if t1 in finance and t2 in finance:
            return INTRA_FINANCE_CORR
        return CROSS_GROUP_CORR
```

---

## SimulatorDataSource Class

Wraps `GBMSimulator` in an asyncio task. Part of the same `simulator.py` module.

```python
class SimulatorDataSource(MarketDataSource):
    """MarketDataSource implementation backed by GBMSimulator.

    Runs an asyncio background task that calls GBMSimulator.step() every
    `update_interval` seconds and writes all results to PriceCache.
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
        # Seed cache immediately so SSE clients see data on first connection
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

## File Structure

```
backend/app/market/
├── simulator.py      # GBMSimulator class + SimulatorDataSource class
└── seed_prices.py    # SEED_PRICES, TICKER_PARAMS, DEFAULT_PARAMS, correlation constants
```

`seed_prices.py` contains only constants. `simulator.py` contains both classes. The split makes it easy to adjust prices and parameters without touching simulation logic.

---

## Behavior Notes

### Price Floors
Prices can never go negative — `exp()` is always strictly positive. However, a prolonged sequence of large negative shocks could drive a price toward zero over a very long simulation. In practice, `GBM + realistic σ` keeps prices in plausible ranges.

### dt Calibration
The `DEFAULT_DT = 8.48e-8` is calibrated so that annualized volatility parameters translate correctly to per-tick moves. Using a larger `dt` would produce jumpy, unrealistic moves; using a smaller `dt` would produce almost no movement per tick.

To verify: the daily standard deviation of AAPL (`σ=0.22`) should be approximately:
```
σ_daily = 0.22 / sqrt(252) ≈ 1.39% per trading day
```
With 47,000 ticks per day at `dt=8.48e-8`, the accumulated variance equals `σ² × (47000 × dt) = 0.22² × (1/252) ≈ 1.92e-4`, giving `σ_daily ≈ 1.39%`. ✓

### Cholesky Validity
The correlation matrix must be positive semi-definite for Cholesky to succeed. Our correlation values (all positive, between 0 and 1, diagonal = 1) guarantee this. `np.linalg.cholesky` will raise `LinAlgError` for invalid matrices — this would indicate a bug in correlation value construction, not a runtime condition.

### Tick-Level Independence
`GBMSimulator.step()` uses `np.random.standard_normal(n)` to draw all `n` independent normals in one vectorized call, then applies the `n×n` Cholesky matrix via `@` (matmul). This is significantly faster than n separate Python `random.gauss()` calls, which matters at 2 ticks/second.

### Adding Tickers Mid-Session
When `add_ticker()` is called (e.g., user adds a ticker to their watchlist), the simulator:
1. Sets the starting price from `SEED_PRICES` (or random $50–$300 for unknown tickers)
2. Seeds the `PriceCache` immediately so the SSE stream shows a price right away
3. Rebuilds the Cholesky matrix to include the new ticker's correlations

The rebuild is O(n²) but runs on the asyncio event loop (not in a thread), completing in microseconds.

### Random Event Rate Tuning
`event_probability=0.001` is the default. To make the simulation more dramatic (more frequent sudden moves), increase this. To make it calmer (purely smooth GBM), set it to `0.0`. This can be adjusted without changing any math — it's just a per-step Bernoulli draw.

---

## Demo

A Rich terminal dashboard demonstrates the simulator in isolation:

```bash
cd backend
uv run market_data_demo.py
```

Displays all 10 default tickers with live-updating prices, sparklines, color-coded direction arrows, and an event log for notable moves. Runs for 60 seconds or until Ctrl+C.
