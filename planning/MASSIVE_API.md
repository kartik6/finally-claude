# Massive API Reference (formerly Polygon.io)

Reference documentation for the Massive (formerly Polygon.io) REST API as used in FinAlly.

## Overview

- **Base URL**: `https://api.massive.com` (legacy `https://api.polygon.io` still supported — both resolve to the same service)
- **Python package**: `massive` (install via `uv add massive` or `pip install -U massive`)
- **Min Python version**: 3.9+
- **Auth**: API key passed via `RESTClient(api_key=...)` or read from `MASSIVE_API_KEY` env var
- **Auth header**: `Authorization: Bearer <API_KEY>` (the client handles this automatically)

## Installation

```bash
uv add massive
# or
pip install -U massive
```

## Client Initialization

```python
from massive import RESTClient

# Reads MASSIVE_API_KEY from environment automatically
client = RESTClient()

# Or pass explicitly
client = RESTClient(api_key="your_key_here")
```

The `RESTClient` is **synchronous**. In an async FastAPI application, wrap calls in `asyncio.to_thread()` to avoid blocking the event loop (see the FinAlly integration example below).

## Rate Limits

| Tier | Limit | Recommended Poll Interval |
|------|-------|--------------------------|
| Free | 5 requests/minute | 15 seconds |
| Paid (Starter+) | Unlimited (stay under ~100 req/s) | 2–5 seconds |

The snapshot endpoint fetches **all tickers in a single API call**, so FinAlly stays within the free tier limit regardless of watchlist size.

---

## Endpoints Used in FinAlly

### 1. Multi-Ticker Snapshot (Primary Endpoint)

Gets current prices for multiple tickers in **one API call**. This is the main polling endpoint.

**REST**: `GET /v2/snapshot/locale/us/markets/stocks/tickers`

**Query parameters**:
- `tickers` — comma-separated list of ticker symbols (e.g., `AAPL,GOOGL,MSFT`)
- `include_otc` — boolean, default `false`; set to `true` to include OTC securities

**Python client**:
```python
from massive import RESTClient
from massive.rest.models import SnapshotMarketType

client = RESTClient()

snapshots = client.get_snapshot_all(
    market_type=SnapshotMarketType.STOCKS,
    tickers=["AAPL", "GOOGL", "MSFT", "AMZN", "TSLA"],
)

for snap in snapshots:
    print(f"{snap.ticker}: ${snap.last_trade.price}")
    print(f"  Today's change: {snap.todays_change_perc:.2f}%")
    print(f"  Day OHLC: O={snap.day.open} H={snap.day.high} L={snap.day.low} C={snap.day.close}")
    print(f"  Volume: {snap.day.volume}")
    print(f"  Last trade timestamp: {snap.last_trade.timestamp}")  # Unix milliseconds
```

**Raw JSON response** (per ticker in `tickers` array):
```json
{
  "ticker": "AAPL",
  "updated": 1675190399000,
  "todaysChange": -4.54,
  "todaysChangePerc": -3.50,
  "day": {
    "o": 129.61,
    "h": 130.15,
    "l": 125.07,
    "c": 125.07,
    "v": 111237700,
    "vw": 127.35
  },
  "prevDay": {
    "o": 132.00,
    "h": 132.40,
    "l": 129.20,
    "c": 129.61,
    "v": 98000000,
    "vw": 130.50
  },
  "lastTrade": {
    "p": 125.07,
    "s": 100,
    "x": 4,
    "t": 1675190399000000
  },
  "lastQuote": {
    "P": 125.08,
    "S": 1000,
    "p": 125.06,
    "s": 500,
    "t": 1675190399500000
  },
  "min": {
    "o": 124.80,
    "h": 125.20,
    "l": 124.70,
    "c": 125.07,
    "v": 250000,
    "vw": 124.95
  }
}
```

**Python client attribute names** (snake_case vs raw JSON camelCase):
| Python attribute | Raw JSON field | Description |
|---|---|---|
| `snap.ticker` | `ticker` | Ticker symbol |
| `snap.last_trade.price` | `lastTrade.p` | Last traded price |
| `snap.last_trade.timestamp` | `lastTrade.t` | Unix **nanoseconds** (divide by 1e6 for ms, 1e9 for seconds) |
| `snap.last_quote.bid_price` | `lastQuote.p` | Best bid |
| `snap.last_quote.ask_price` | `lastQuote.P` | Best ask |
| `snap.day.open` | `day.o` | Day open |
| `snap.day.high` | `day.h` | Day high |
| `snap.day.low` | `day.l` | Day low |
| `snap.day.close` | `day.c` | Day close (current last) |
| `snap.day.volume` | `day.v` | Day volume |
| `snap.prev_day.close` | `prevDay.c` | Previous day close |
| `snap.todays_change` | `todaysChange` | Absolute change from prev close |
| `snap.todays_change_perc` | `todaysChangePerc` | Percentage change from prev close |
| `snap.updated` | `updated` | Last update Unix ms |

> **Note on timestamps**: `lastTrade.t` in the raw JSON is in Unix **nanoseconds**. The Python client's `snap.last_trade.timestamp` may already convert this — verify in practice. The `updated` field is in milliseconds. Always divide by 1000 to get seconds for `PriceCache.update()`.

### 2. Single Ticker Snapshot

Detailed snapshot for one ticker. Useful for a drill-down detail view.

**REST**: `GET /v2/snapshot/locale/us/markets/stocks/tickers/{ticker}`

**Python client**:
```python
snapshot = client.get_snapshot_ticker(
    market_type=SnapshotMarketType.STOCKS,
    ticker="AAPL",
)

print(f"Price: ${snapshot.last_trade.price}")
print(f"Bid/Ask: ${snapshot.last_quote.bid_price} / ${snapshot.last_quote.ask_price}")
print(f"Day range: ${snapshot.day.low} - ${snapshot.day.high}")
print(f"Change: {snapshot.todays_change_perc:.2f}%")
```

### 3. Previous Close (OHLC)

Gets the previous trading day's OHLC. Useful for seeding realistic starting prices.

**REST**: `GET /v2/aggs/ticker/{stocksTicker}/prev`

**Query parameters**:
- `adjusted` — boolean, default `true`; adjusts for stock splits

**Python client**:
```python
prev = client.get_previous_close_agg(ticker="AAPL")

for agg in prev:  # Typically one result
    print(f"Previous close: ${agg.close}")
    print(f"OHLC: O={agg.open} H={agg.high} L={agg.low} C={agg.close}")
    print(f"Volume: {agg.volume}")
    print(f"Timestamp: {agg.timestamp}")  # Unix milliseconds
```

**Raw JSON**:
```json
{
  "ticker": "AAPL",
  "adjusted": true,
  "queryCount": 1,
  "resultsCount": 1,
  "results": [
    {
      "o": 150.0,
      "h": 155.0,
      "l": 149.0,
      "c": 154.5,
      "v": 1000000,
      "vw": 152.3,
      "t": 1672531200000
    }
  ],
  "status": "OK"
}
```

### 4. Aggregate Bars (Historical OHLCV)

Historical bars over a date range. Not used in the core polling loop but available for future historical chart features.

**REST**: `GET /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}`

**Python client**:
```python
aggs = []
for a in client.list_aggs(
    ticker="AAPL",
    multiplier=1,
    timespan="day",       # "minute", "hour", "day", "week", "month", "quarter", "year"
    from_="2024-01-01",   # YYYY-MM-DD
    to="2024-01-31",
    adjusted=True,
    sort="asc",
    limit=50000,
):
    aggs.append(a)

for a in aggs:
    print(f"t={a.timestamp} O={a.open} H={a.high} L={a.low} C={a.close} V={a.volume}")
```

### 5. Last Trade / Last Quote

Individual endpoints for the most recent trade or NBBO quote for a single ticker.

```python
# Last trade
trade = client.get_last_trade(ticker="AAPL")
print(f"Last trade: ${trade.price} x {trade.size} shares")

# Last NBBO quote
quote = client.get_last_quote(ticker="AAPL")
print(f"Bid: ${quote.bid} x {quote.bid_size}")
print(f"Ask: ${quote.ask} x {quote.ask_size}")
```

---

## How FinAlly Uses the API

The `MassiveDataSource` runs a background asyncio polling loop:

1. Collect all tickers from the active watchlist
2. Call `get_snapshot_all()` — **one API call** for all tickers
3. Extract `last_trade.price` and `last_trade.timestamp` from each snapshot
4. Write to the shared `PriceCache`
5. Sleep for the poll interval, then repeat

The synchronous `RESTClient` is wrapped with `asyncio.to_thread()` to avoid blocking the FastAPI event loop.

```python
import asyncio
from massive import RESTClient
from massive.rest.models import SnapshotMarketType

async def poll_once(client: RESTClient, tickers: list[str], price_cache) -> None:
    """Fetch snapshots and update cache. Runs Massive client in a thread."""
    snapshots = await asyncio.to_thread(
        client.get_snapshot_all,
        market_type=SnapshotMarketType.STOCKS,
        tickers=tickers,
    )
    for snap in snapshots:
        try:
            price = snap.last_trade.price
            # last_trade.timestamp is in nanoseconds from the raw API;
            # divide by 1e9 to get Unix seconds
            timestamp = snap.last_trade.timestamp / 1e9
            price_cache.update(ticker=snap.ticker, price=price, timestamp=timestamp)
        except (AttributeError, TypeError):
            pass  # Ticker had no recent trade data
```

---

## Error Handling

The `RESTClient` raises exceptions for HTTP errors:

| HTTP Status | Meaning | Action |
|---|---|---|
| 401 | Invalid API key | Check `MASSIVE_API_KEY` |
| 403 | Plan doesn't include this endpoint | Upgrade tier |
| 429 | Rate limit exceeded | Increase poll interval |
| 5xx | Server error | Client retries 3× by default; log and continue |

In `MassiveDataSource._poll_once()`, all exceptions are caught and logged without re-raising, so a transient failure won't crash the poller — it will retry on the next interval.

```python
try:
    snapshots = await asyncio.to_thread(self._fetch_snapshots)
    # process...
except Exception as e:
    logger.error("Massive poll failed: %s", e)
    # Don't re-raise — retry on next interval
```

---

## Market Hours Behavior

- **During market hours**: `last_trade.price` reflects real-time last trade
- **After hours / pre-market**: `last_trade.price` reflects the last traded price (may include extended-hours trades)
- **Market closed (weekend/holiday)**: Returns last available trade price; `day` fields may reflect the last trading session
- **`day` object**: Resets at market open each day; during pre-market, may still show prior day's values

---

## Notes for FinAlly

- **One call for all tickers**: The snapshot endpoint handles the entire watchlist in a single request — critical for staying within the free tier's 5 req/min limit
- **Timestamps**: Be careful with units. `lastTrade.t` in raw JSON is nanoseconds; `updated` is milliseconds. The Python client may normalize these — verify when processing `snap.last_trade.timestamp`
- **Missing data**: Some tickers (e.g., newly listed, low-volume OTC) may return snapshots with `null` last trade. Always guard with `try/except AttributeError`
- **Default poll interval**: 15 seconds for free tier. Set `POLL_INTERVAL` to 2–5 seconds for paid tiers
- **Thread safety**: `RESTClient` is not async-native. Always use `asyncio.to_thread()` when calling from async code
