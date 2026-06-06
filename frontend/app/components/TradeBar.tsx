"use client";

import { useEffect, useState } from "react";
import { executeTrade } from "@/app/lib/api";

interface TradeBarProps {
  /** Pre-fills the ticker field (e.g. from the selected watchlist row). */
  ticker?: string | null;
  onTraded: () => void;
}

type Feedback = { kind: "ok" | "error"; text: string } | null;

export default function TradeBar({ ticker, onTraded }: TradeBarProps) {
  const [symbol, setSymbol] = useState("");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    // Prefill the field when the selected ticker changes; it stays editable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ticker) setSymbol(ticker);
  }, [ticker]);

  const submit = async (side: "buy" | "sell") => {
    const t = symbol.trim().toUpperCase();
    const q = Number(qty);
    if (!t) {
      setFeedback({ kind: "error", text: "Enter a ticker" });
      return;
    }
    if (!Number.isFinite(q) || q <= 0) {
      setFeedback({ kind: "error", text: "Quantity must be positive" });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await executeTrade(t, q, side);
      setFeedback({
        kind: "ok",
        text: `${side === "buy" ? "Bought" : "Sold"} ${q} ${t}`,
      });
      setQty("");
      onTraded();
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Trade failed",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-terminal-border bg-terminal-panel p-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              Ticker
            </span>
            <input
              aria-label="Trade ticker"
              data-testid="trade-ticker"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="AAPL"
              disabled={busy}
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1.5 font-mono text-sm uppercase text-white placeholder:text-gray-600 focus:border-accent-blue focus:outline-none"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              Quantity
            </span>
            <input
              aria-label="Trade quantity"
              data-testid="trade-quantity"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              disabled={busy}
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1.5 font-mono text-sm tabular-nums text-white placeholder:text-gray-600 focus:border-accent-blue focus:outline-none"
            />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="trade-buy-btn"
            onClick={() => submit("buy")}
            disabled={busy}
            className="flex-1 rounded bg-accent-purple px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Buy
          </button>
          <button
            type="button"
            data-testid="trade-sell-btn"
            onClick={() => submit("sell")}
            disabled={busy}
            className="flex-1 rounded border border-loss px-4 py-1.5 text-sm font-semibold text-loss transition-colors hover:bg-loss hover:text-white disabled:opacity-40"
          >
            Sell
          </button>
        </div>
      </div>
      {feedback && (
        <p
          className={`mt-2 rounded px-2 py-1 text-xs ${
            feedback.kind === "ok"
              ? "bg-gain/15 text-gain"
              : "bg-loss/15 text-loss"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}
