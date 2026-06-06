"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Portfolio, PriceUpdate, WatchlistItem } from "@/app/types/api";
import { fetchPortfolio, fetchWatchlist } from "@/app/lib/api";
import { usePriceStream } from "@/app/lib/sse";
import WatchlistPanel, { type LivePrice } from "@/app/components/WatchlistPanel";
import MainChart from "@/app/components/MainChart";
import PortfolioHeatmap from "@/app/components/PortfolioHeatmap";
import PnLChart from "@/app/components/PnLChart";
import PositionsTable from "@/app/components/PositionsTable";
import PortfolioStats from "@/app/components/PortfolioStats";
import TradeBar from "@/app/components/TradeBar";
import ChatPanel from "@/app/components/ChatPanel";

const MAX_HISTORY = 240;

export default function Home() {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Map<string, LivePrice>>(
    new Map()
  );
  const [history, setHistory] = useState<Map<string, number[]>>(new Map());
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const sessionOpenRef = useRef<Map<string, number>>(new Map());

  const loadWatchlist = useCallback(async () => {
    try {
      const items = await fetchWatchlist();
      setWatchlist(items);
      setSelectedTicker((cur) => cur ?? items[0]?.ticker ?? null);
    } catch {
      /* transient */
    }
  }, []);

  const loadPortfolio = useCallback(async () => {
    try {
      setPortfolio(await fetchPortfolio());
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    loadWatchlist();
    loadPortfolio();
  }, [loadWatchlist, loadPortfolio]);

  // Keep portfolio in sync even without a trade
  useEffect(() => {
    const id = setInterval(loadPortfolio, 10_000);
    return () => clearInterval(id);
  }, [loadPortfolio]);

  const onPrice = useCallback((u: PriceUpdate) => {
    const open = sessionOpenRef.current;
    if (!open.has(u.ticker)) open.set(u.ticker, u.price);
    const base = open.get(u.ticker)!;
    const changePct = base ? ((u.price - base) / base) * 100 : 0;

    setLivePrices((prev) => {
      const next = new Map(prev);
      next.set(u.ticker, { price: u.price, change_pct: changePct });
      return next;
    });

    setHistory((prev) => {
      const next = new Map(prev);
      const arr = next.get(u.ticker) ?? [];
      const updated = [...arr, u.price];
      if (updated.length > MAX_HISTORY) updated.shift();
      next.set(u.ticker, updated);
      return next;
    });
  }, []);

  const status = usePriceStream(onPrice);

  // Enrich stored portfolio with live SSE prices so P&L ticks in real time
  const enrichedPortfolio = useMemo((): Portfolio | null => {
    if (!portfolio) return null;
    const positions = portfolio.positions.map((p) => {
      const livePrice =
        livePrices.get(p.ticker)?.price ??
        (p.current_price as number | null) ??
        p.avg_cost;
      const unrealizedPnl = (livePrice - p.avg_cost) * p.quantity;
      const pnlPct = p.avg_cost
        ? ((livePrice - p.avg_cost) / p.avg_cost) * 100
        : 0;
      return {
        ...p,
        current_price: livePrice,
        unrealized_pnl: Math.round(unrealizedPnl * 100) / 100,
        pnl_pct: Math.round(pnlPct * 100) / 100,
      };
    });
    const posValue = positions.reduce(
      (s, p) => s + p.current_price * p.quantity,
      0
    );
    const totalValue = portfolio.cash_balance + posValue;
    const totalUnrealized = positions.reduce((s, p) => s + p.unrealized_pnl, 0);
    return {
      ...portfolio,
      positions,
      total_value: Math.round(totalValue * 100) / 100,
      unrealized_pnl: Math.round(totalUnrealized * 100) / 100,
    };
  }, [portfolio, livePrices]);

  const onTradeOrAction = useCallback(() => {
    loadPortfolio();
    loadWatchlist();
    setHistoryRefresh((n) => n + 1);
  }, [loadPortfolio, loadWatchlist]);

  const onWatchlistChange = useCallback(() => {
    loadWatchlist();
  }, [loadWatchlist]);

  const totalValue = enrichedPortfolio?.total_value ?? 0;
  const cash = enrichedPortfolio?.cash_balance ?? 0;

  const dotColor = status.connected
    ? "bg-gain"
    : status.reconnecting
      ? "bg-accent-yellow"
      : "bg-loss";
  const dotLabel = status.connected
    ? "Connected"
    : status.reconnecting
      ? "Reconnecting"
      : "Disconnected";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-terminal-bg text-white">

      {/* ── Header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-terminal-border px-4 py-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tracking-tight text-accent-yellow">
            FinAlly
          </span>
          <span className="text-xs text-gray-500">AI Trading Workstation</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              Total Value
            </span>
            <span className="font-mono text-base font-semibold tabular-nums text-accent-blue">
              ${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              Cash
            </span>
            <span className="font-mono text-base font-semibold tabular-nums text-white">
              ${cash.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center gap-2" title={dotLabel}>
            <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
            <span className="text-xs text-gray-400">{dotLabel}</span>
          </div>
        </div>
      </header>

      {/*
        ── Body: explicit CSS grid, 4 columns ──
        CSS grid column boundaries are immovable — the chat column
        (rightmost) can never overlap any column to its left.

        Column breakdown:
          1. Watchlist      — 195px
          2. Charts         — flex (1fr): live ticker chart + heatmap + P&L chart
          3. Portfolio data — 240px: stats, positions table, trade bar
          4. AI Assistant   — 285px: chat panel, full height
      */}
      <div
        className="min-h-0 flex-1 overflow-hidden"
        style={{ display: "grid", gridTemplateColumns: "195px 1fr 240px 285px" }}
      >

        {/* ── Col 1: Watchlist ── */}
        <div className="flex min-h-0 flex-col overflow-hidden border-r border-terminal-border p-2">
          <WatchlistPanel
            items={watchlist}
            livePrices={livePrices}
            history={history}
            selectedTicker={selectedTicker}
            onSelect={setSelectedTicker}
            onWatchlistChange={onWatchlistChange}
          />
        </div>

        {/* ── Col 2: Charts (live price, allocation, portfolio P&L) ── */}
        <div className="flex flex-col overflow-hidden border-r border-terminal-border p-2 gap-2">

          {/* Live ticker chart — slightly smaller at 38% */}
          <div className="min-h-0" style={{ flex: "1.9" }}>
            <MainChart
              ticker={selectedTicker}
              priceHistory={
                selectedTicker ? (history.get(selectedTicker) ?? []) : []
              }
            />
          </div>

          {/* Allocation heatmap — 32% */}
          <div className="min-h-0" style={{ flex: "1.6" }}>
            <PortfolioHeatmap portfolio={enrichedPortfolio} />
          </div>

          {/* Portfolio P&L over time — 30% */}
          <div className="min-h-0" style={{ flex: "1.5" }}>
            <PnLChart refreshKey={historyRefresh} />
          </div>

        </div>

        {/* ── Col 3: Portfolio data ── */}
        <div className="flex flex-col overflow-hidden border-r border-terminal-border p-2 gap-2">

          {/* Summary stats: total value, unrealized P&L, cash */}
          <PortfolioStats portfolio={enrichedPortfolio} />

          {/* Positions table — takes remaining space */}
          <div className="min-h-0 flex-1">
            <PositionsTable portfolio={enrichedPortfolio} />
          </div>

          {/* Trade bar — buy / sell */}
          <TradeBar ticker={selectedTicker} onTraded={onTradeOrAction} />

        </div>

        {/* ── Col 4: AI Assistant ── own grid column, cannot overlap cols 1-3 ── */}
        <div className="flex flex-col overflow-hidden">
          <ChatPanel onActions={onTradeOrAction} />
        </div>

      </div>
    </div>
  );
}
