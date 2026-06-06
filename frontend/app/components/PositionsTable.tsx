"use client";

import type { Portfolio } from "@/app/types/api";

interface PositionsTableProps {
  portfolio: Portfolio | null;
}

function money(v: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PositionsTable({ portfolio }: PositionsTableProps) {
  const positions = portfolio?.positions ?? [];

  return (
    <section
      data-testid="positions-table"
      className="flex h-full flex-col rounded-lg border border-terminal-border bg-terminal-panel"
    >
      <header className="border-b border-terminal-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Positions
        </h2>
      </header>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-terminal-panel text-left text-[10px] uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-1.5 font-medium">Ticker</th>
              <th className="px-2 py-1.5 text-right font-medium">Qty</th>
              <th className="px-2 py-1.5 text-right font-medium">Avg</th>
              <th className="px-2 py-1.5 text-right font-medium">Last</th>
              <th className="px-2 py-1.5 text-right font-medium">P&L</th>
              <th className="px-3 py-1.5 text-right font-medium">P&L %</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => {
              const gain = p.unrealized_pnl >= 0;
              return (
                <tr
                  key={p.ticker}
                  className="border-b border-terminal-border/50"
                >
                  <td className="px-3 py-1.5 font-mono font-semibold text-accent-yellow">
                    {p.ticker}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                    {p.quantity}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-gray-300">
                    {money(p.avg_cost)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-white">
                    {p.current_price == null ? "—" : money(p.current_price)}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono tabular-nums ${
                      gain ? "text-gain" : "text-loss"
                    }`}
                  >
                    {gain ? "+" : "-"}
                    {money(Math.abs(p.unrealized_pnl))}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right font-mono tabular-nums ${
                      gain ? "text-gain" : "text-loss"
                    }`}
                  >
                    {gain ? "+" : ""}
                    {p.pnl_pct.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
            {positions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                  No open positions.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-terminal-border">
              <td
                colSpan={4}
                className="px-3 py-1.5 text-xs uppercase tracking-wider text-gray-400"
              >
                Cash
              </td>
              <td
                colSpan={2}
                className="px-3 py-1.5 text-right font-mono tabular-nums text-accent-blue"
              >
                ${portfolio ? money(portfolio.cash_balance) : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
