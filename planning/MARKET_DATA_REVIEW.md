# Market Data Backend — Code Review

**Date:** 2026-03-30
**Scope:** `backend/app/market/` (8 source files) and `backend/tests/market/` (6 test files)
**Reviewer:** Claude (Sonnet 4.6)
**Prior review:** `planning/archive/MARKET_DATA_REVIEW.md` (2026-02-10)

---

## 1. Test Results

**73 tests, 73 passed. 0 failures.**

```
platform linux -- Python 3.13.7, pytest-9.0.2
plugins: cov-7.0.0, anyio-4.12.1, asyncio-1.3.0
73 passed in 2.84s
```

**Lint:** `ruff check app/ tests/` — all checks passed, no warnings.

---

## 2. Coverage

```
Name                           Stmts   Miss  Cover   Missing
------------------------------------------------------------
app/market/__init__.py             6      0   100%
app/market/cache.py               39      0   100%
app/market/factory.py             15      0   100%
app/market/interface.py           13      0   100%
app/market/massive_client.py      67      4    94%   85-87, 125
app/market/models.py              26      0   100%
app/market/seed_prices.py          8      0   100%
app/market/simulator.py          139      3    98%   149, 268-269
app/market/stream.py              36     24    33%   26-48, 62-87
------------------------------------------------------------
TOTAL                            349     31    91%
```

**91% overall.** The two uncovered areas are expected given the test scope:

- `stream.py` (33%): The route handler and `_generate_events` generator require a running ASGI server to exercise. No SSE integration tests exist — this is the primary gap.
- `massive_client.py` (94%): Lines 85-87 are the `_poll_loop` sleep-and-poll body; line 125 is `_fetch_snapshots`. The loop test (`test_stop_cancels_task`) covers task lifecycle but doesn't actually run a full poll cycle through the loop. Minor.
- `simulator.py` (98%): Line 149 is the `_add_ticker_internal` early-return guard for duplicates (only reachable if `add_ticker` is bypassed, which doesn't happen in normal use). Lines 268-269 are the exception log in `_run_loop`, which requires injecting a failure into the simulator step.

---

## 3. Previous Issues — Resolution Status

The February 2026 review identified 7 issues. All have been resolved:

| # | Issue | Status |
|---|-------|--------|
| 1 | `pyproject.toml` missing hatchling build config | **Fixed** — `[tool.hatch.build.targets.wheel] packages = ["app"]` added |
| 2 | Lazy imports of `massive` inside methods broke module-level patches | **Fixed** — `from massive import RESTClient` and `from massive.rest.models import SnapshotMarketType` are now at module top level |
| 3 | `_generate_events` annotated `-> None` despite being an async generator | **Fixed** — now annotated `-> AsyncGenerator[str, None]` |
| 4 | `SimulatorDataSource.get_tickers()` accessed private `self._sim._tickers` | **Fixed** — `GBMSimulator` now exposes a public `get_tickers()` method |
| 5 | `DEFAULT_CORR` constant defined but unused alongside `CROSS_GROUP_CORR` | **Fixed** — `DEFAULT_CORR` removed from `seed_prices.py`; only `CROSS_GROUP_CORR` remains |
| 6 | Unused imports in 4 test files (`pytest`, `math`, `asyncio`) | **Fixed** — all clean per ruff |
| 7 | Massive test mocks failed without `massive` installed | **Fixed** — imports at module level; all 13 Massive tests now pass |

---

## 4. Architecture Assessment

The subsystem follows a clean strategy pattern with clear separation of concerns:

```
MarketDataSource (ABC)
├── SimulatorDataSource  → GBM + Cholesky correlated moves, async loop
└── MassiveDataSource    → Polygon.io REST poller, asyncio.to_thread
        │
        ▼ writes PriceUpdate
   PriceCache (thread-safe, version-counted)
        │
        ├── SSE stream (/api/stream/prices)
        ├── Portfolio valuation
        └── Trade execution
```

**Strengths:**

- **GBM math is correct.** `S(t+dt) = S(t) * exp((mu - 0.5*sigma²)*dt + sigma*sqrt(dt)*Z)` produces log-normal paths. The tiny dt (~8.5e-8 for 500ms ticks) generates realistic sub-cent moves per step.
- **Cholesky-correlated moves** are the mathematically appropriate approach. The sector groupings (tech 0.6, finance 0.5, cross 0.3) are reasonable and TSLA's special-case treatment is defensible.
- **Shock events** (~0.1% per tick, 2-5% move) add visible drama. At 10 tickers × 2 ticks/sec, expect ~one shock every 50 seconds across the watchlist — appropriate frequency for a demo.
- **`PriceCache` as single point of truth** decouples producers from all consumers. Downstream code never needs to know which source is active.
- **Thread-safe via `Lock`** — correct, since `MassiveDataSource` runs SDK calls via `asyncio.to_thread` which uses a thread-pool executor.
- **Immutable `PriceUpdate` with `frozen=True, slots=True`** — safe to share across tasks and threads, memory-efficient.
- **Immediate seeding on start** — both sources populate the cache before the background loop begins, so the frontend gets prices on its very first SSE connection.
- **SSE version-based change detection** — the version counter avoids resending identical payloads on the Massive 15s poll cycle.
- **All background tasks properly cancellable** — `stop()` is idempotent on both sources.

---

## 5. Remaining Issues

### 5.1 Module-Level Router in `stream.py` (Low)

`stream.py:17` creates a module-level `router` object:

```python
router = APIRouter(prefix="/api/stream", tags=["streaming"])
```

`create_stream_router()` then registers the `/prices` route on this shared instance. If `create_stream_router()` were called a second time (e.g., multiple test fixtures creating independent apps), the route would be registered twice on the same router, causing a duplicate route error or silently shadowing.

In production this is called once at startup, so it won't cause a real bug. But it's fragile for testing, and the design doc explicitly calls this out as a known issue recommending a fresh router be created inside the factory. No fix was applied.

### 5.2 `version` Property Not Under Lock (Low, CPython-safe)

```python
@property
def version(self) -> int:
    return self._version  # No lock acquired
```

All other reads in `PriceCache` go through `self._lock`. On CPython, reading a single integer is atomic due to the GIL, so this is safe in practice. On a no-GIL Python build (PEP 703, Python 3.13t), this could be a data race. Acceptable for now but worth noting as Python's no-GIL path matures.

### 5.3 Missing SSE Integration Tests (Gap)

`stream.py` is at 33% coverage. The route handler (lines 26-48) and the event generator (lines 62-87) have zero test coverage. These are core to the frontend's live data feed.

A basic test using `httpx.AsyncClient` + `ASGITransport` could verify:
- The endpoint returns `text/event-stream` content type
- It emits a `retry: 1000\n\n` preamble
- It sends a `data:` event with the expected JSON shape when the cache has prices
- It respects version-based change detection (no duplicate events)

The design doc notes this as a recommended addition. It remains unimplemented.

### 5.4 No Thread-Safety Regression Test (Gap)

The `PriceCache` lock usage looks correct from inspection. A concurrent-write test (e.g., `threading.Thread` spawning 10 writers simultaneously) would verify empirically that the lock prevents corruption. Low priority — the implementation is straightforward — but absent.

### 5.5 No Full Default-Watchlist Simulator Test (Gap)

Tests use 1-2 tickers. No test initialises `GBMSimulator` with all 10 default tickers. The Cholesky decomposition of a 10×10 correlation matrix could silently fail (or produce a non-positive-definite matrix) if correlation constants were ever misconfigured. A smoke test for the full 10-ticker set would catch this category of regression.

---

## 6. Minor Observations

- **`conftest.py` fixture is unused.** The `event_loop_policy` fixture defined in `conftest.py` is not referenced by any test. `pytest-asyncio` in `auto` mode manages the event loop automatically. The fixture has no effect.
- **`SimulatorDataSource` normalises tickers inconsistently.** `add_ticker` and `remove_ticker` do not apply `.upper().strip()` normalisation (unlike `MassiveDataSource`). The simulator inherits whatever case the caller passes. This is fine for the current app because the watchlist API should normalise before calling, but the interface contract doesn't enforce it.
- **Massive `_poll_loop` sleeps before first iteration.** `start()` does an immediate first poll, then `_poll_loop` sleeps before polling again. This is intentional and correct — the comment on line 84 confirms it. The pattern is slightly non-obvious but works.

---

## 7. Verdict

The market data backend is production-ready for its stated scope. All previously identified issues have been resolved. The 91% coverage figure is accurate and the uncovered lines are genuinely hard to exercise without integration infrastructure (ASGI server for SSE, injected failures for the resilience path).

**No blocking issues.** The subsystem is ready for integration with the rest of the backend (portfolio, trade execution, watchlist API, app lifespan).

**Recommended before shipping the full app:**

1. Add at least one SSE integration test using `httpx.AsyncClient` — this is the only critical data path with no coverage.
2. Fix the module-level router in `stream.py` to use a fresh `APIRouter` inside the factory — low effort, removes a latent testing footgun.

**Nice to have:**

3. Add a 10-ticker Cholesky smoke test.
4. Add `upper()`/`strip()` normalisation to `SimulatorDataSource.add_ticker` / `remove_ticker` for consistency with `MassiveDataSource`.
