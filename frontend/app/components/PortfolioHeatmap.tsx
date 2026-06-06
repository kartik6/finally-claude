"use client";

import { ResponsiveContainer, Treemap } from "recharts";
import type { Portfolio } from "@/app/types/api";

interface PortfolioHeatmapProps {
  portfolio: Portfolio | null;
}

interface Node {
  name: string;
  size: number;
  pnlPct: number;
  [key: string]: string | number;
}

// Maps a P&L percentage to a green/red fill, saturating around +/-10%.
function colorFor(pnlPct: number): string {
  const clamped = Math.max(-10, Math.min(10, pnlPct));
  const intensity = Math.abs(clamped) / 10; // 0..1
  const alpha = 0.25 + intensity * 0.6;
  return clamped >= 0
    ? `rgba(0, 255, 136, ${alpha.toFixed(2)})`
    : `rgba(255, 68, 68, ${alpha.toFixed(2)})`;
}

interface ContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  pnlPct?: number;
  depth?: number;
}

function HeatCell(props: ContentProps) {
  const { x = 0, y = 0, width = 0, height = 0, name, pnlPct, depth = 0 } = props;
  // depth === 0 is the internal root wrapper Recharts creates; skip it.
  if (width <= 0 || height <= 0 || !name || depth === 0) return null;
  const showLabel = width > 30 && height > 18;
  const sign = (pnlPct ?? 0) >= 0 ? "+" : "";
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={colorFor(pnlPct ?? 0)}
        stroke="#1a1a2e"
        strokeWidth={2}
      />
      {showLabel && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 4}
            textAnchor="middle"
            fill="#ffffff"
            fontSize={13}
            fontWeight={700}
            fontFamily="ui-monospace, monospace"
          >
            {name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 12}
            textAnchor="middle"
            fill="#e6e6e6"
            fontSize={11}
            fontFamily="ui-monospace, monospace"
          >
            {sign}
            {(pnlPct ?? 0).toFixed(1)}%
          </text>
        </>
      )}
    </g>
  );
}

export default function PortfolioHeatmap({ portfolio }: PortfolioHeatmapProps) {
  const positions = portfolio?.positions ?? [];
  const data: Node[] = positions
    .map((p) => ({
      name: p.ticker,
      size:
        p.current_price != null ? p.current_price * p.quantity : p.avg_cost * p.quantity,
      pnlPct: p.pnl_pct,
    }))
    .filter((n) => n.size > 0);

  return (
    <section
      data-testid="heatmap"
      className="flex h-full flex-col rounded-lg border border-terminal-border bg-terminal-panel"
    >
      <header className="border-b border-terminal-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Allocation
        </h2>
      </header>

      <div className="relative flex-1 p-1">
        {data.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
            No positions to display.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={data}
              dataKey="size"
              isAnimationActive={false}
              content={(props: Record<string, unknown>) => {
                // Recharts v3 Treemap does not reliably forward custom data
                // fields to the content renderer, so we look up pnlPct from
                // the data array directly using the node's name.
                const item = data.find((d) => d.name === props.name);
                return (
                  <HeatCell
                    {...(props as ContentProps)}
                    pnlPct={item?.pnlPct ?? 0}
                  />
                );
              }}
            />
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
