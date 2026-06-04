# FinAlly — AI Trading Workstation

An AI-powered trading workstation with live market data streaming, simulated portfolio trading, and an LLM chat assistant that can analyze positions and execute trades through natural language.

Built entirely by coding agents as a capstone project for an agentic AI coding course.

## Features

- **Live price streaming** — SSE-powered updates with green/red flash animations
- **Simulated portfolio** — $10k virtual cash, market orders, instant fills
- **Portfolio visualizations** — heatmap (treemap), P&L chart, positions table
- **AI chat assistant** — analyzes holdings, suggests trades, and auto-executes them
- **Watchlist management** — add/remove tickers manually or via the AI
- **Dark terminal aesthetic** — Bloomberg-inspired, data-dense layout

## Architecture

A single Docker container serves everything on port 8000:

- **Frontend**: Next.js (static export) with TypeScript and Tailwind CSS
- **Backend**: FastAPI (Python/uv) with SSE streaming
- **Database**: SQLite with lazy initialization
- **AI**: LiteLLM → OpenRouter (Cerebras inference) with structured outputs
- **Market data**: Built-in GBM simulator (default) or Massive API (real data, optional)

## Quick Start

```bash
# Clone and configure
cp .env.example .env
# Edit .env and add your OPENROUTER_API_KEY

# Build and run
docker build -t finally .
docker run -v finally-data:/app/db -p 8000:8000 --env-file .env finally

# Open http://localhost:8000
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key for AI chat |
| `MASSIVE_API_KEY` | No | Massive (Polygon.io) key for real market data; omit to use the built-in simulator |
| `LLM_MOCK` | No | Set to `true` for deterministic mock LLM responses (for testing) |

## Project Structure

```
finally/
├── frontend/    # Next.js static export
├── backend/     # FastAPI uv project
├── planning/    # Project documentation and agent contracts
├── test/        # Playwright E2E tests
├── db/          # SQLite volume mount (runtime)
└── scripts/     # Start/stop helpers
```

## License

See [LICENSE](LICENSE).


