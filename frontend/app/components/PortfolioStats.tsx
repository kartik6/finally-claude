"use client";

import type { Portfolio } from "@/app/types/api";

interface PortfolioStatsProps {
  portfolio: Portfolio | null;
}

function money(v: number): string {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function Stat({
  label,
  value,
  tone = "white",
}: {
  label: string;
  value: string;
  tone?: "white" | "gain" | "loss" | "blue";
}) {
  const color =
    tone === "gain"
      ? "text-gain"
      : tone === "loss"
        ? "text-loss"
        : tone === "blue"
          ? "text-accent-blue"
          : "text-white";
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <span className={`font-mono text-lg font-semibold tabular-nums ${color}`}>
        {value}
      </span>
    </div>
  );
}

export default function PortfolioStats({ portfolio }: PortfolioStatsProps) {
  const totalValue = portfolio?.total_value ?? 0;
  const pnl = portfolio?.unrealized_pnl ?? 0;
  const cash = portfolio?.cash_balance ?? 0;
  const gain = pnl >= 0;

  return (
    <div className="flex items-center gap-6 rounded-lg border border-terminal-border bg-terminal-panel px-4 py-2">
      <Stat label="Total Value" value={`$${money(totalValue)}`} tone="blue" />
      <Stat
        label="Unrealized P&L"
        value={`${gain ? "+" : "-"}$${money(Math.abs(pnl))}`}
        tone={gain ? "gain" : "loss"}
      />
      <Stat label="Cash" value={`$${money(cash)}`} />
    </div>
  );
}
