"use client";

import type { WatchlistItem } from "@/app/types/api";
import { removeFromWatchlist } from "@/app/lib/api";
import PriceCell from "./PriceCell";
import Sparkline from "./Sparkline";
import AddTickerInput from "./AddTickerInput";

export interface LivePrice {
  price: number;
  change_pct: number;
}

interface WatchlistPanelProps {
  items: WatchlistItem[];
  /** Latest streamed price keyed by ticker; overrides the REST snapshot. */
  livePrices: Map<string, LivePrice>;
  /** Accumulated price history per ticker since page load. */
  history: Map<string, number[]>;
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
  onWatchlistChange: () => void;
}

function pct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export default function WatchlistPanel({
  items,
  livePrices,
  history,
  selectedTicker,
  onSelect,
  onWatchlistChange,
}: WatchlistPanelProps) {
  const remove = async (ticker: string) => {
    try {
      await removeFromWatchlist(ticker);
      onWatchlistChange();
    } catch {
      // surfaced elsewhere; keep the row if removal fails
    }
  };

  return (
    <section
      data-testid="watchlist"
      className="flex h-full flex-col rounded-lg border border-terminal-border bg-terminal-panel"
    >
      <header className="flex items-center justify-between border-b border-terminal-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Watchlist
        </h2>
        <span className="text-xs text-gray-500">{items.length}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-terminal-panel text-left text-[10px] uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-1.5 font-medium">Symbol</th>
              <th className="px-2 py-1.5 text-right font-medium">Price</th>
              <th className="px-2 py-1.5 text-right font-medium">Chg %</th>
              <th className="px-2 py-1.5 text-right font-medium">Trend</th>
              <th className="px-1 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const live = livePrices.get(item.ticker);
              const price = live?.price ?? item.current_price;
              const change = live?.change_pct ?? item.change_pct;
              const selected = item.ticker === selectedTicker;
              return (
                <tr
                  key={item.ticker}
                  onClick={() => onSelect(item.ticker)}
                  className={`group cursor-pointer border-b border-terminal-border/50 transition-colors hover:bg-white/5 ${
                    selected ? "bg-accent-blue/10" : ""
                  }`}
                >
                  <td className="px-3 py-1.5 font-mono font-semibold text-accent-yellow">
                    {item.ticker}
                  </td>
                  <td className="px-2 py-1.5 text-right text-white">
                    <PriceCell price={price} />
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono tabular-nums ${
                      change >= 0 ? "text-gain" : "text-loss"
                    }`}
                  >
                    {pct(change)}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end">
                      <Sparkline history={history.get(item.ticker) ?? []} />
                    </div>
                  </td>
                  <td className="px-1 py-1.5 text-right">
                    <button
                      aria-label={`Remove ${item.ticker}`}
                      data-testid={`remove-ticker-${item.ticker}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(item.ticker);
                      }}
                      className="text-gray-600 opacity-0 transition-opacity hover:text-loss group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  No tickers. Add one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="border-t border-terminal-border p-2">
        <AddTickerInput onAdded={onWatchlistChange} />
      </footer>
    </section>
  );
}
