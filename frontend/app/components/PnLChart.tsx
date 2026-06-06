"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchPortfolioHistory } from "@/app/lib/api";

const STARTING_VALUE = 10_000;
const POLL_MS = 30_000;

interface PnLChartProps {
  /** Bumping this refetches history (e.g. after a trade). */
  refreshKey: number;
}

interface Point {
  t: number;
  value: number;
}

export default function PnLChart({ refreshKey }: PnLChartProps) {
  const [points, setPoints] = useState<Point[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const history = await fetchPortfolioHistory();
        if (cancelled) return;
        const sorted = history
          .map((s) => ({
            t: new Date(s.recorded_at).getTime(),
            value: s.total_value,
          }))
          .sort((a, b) => a.t - b.t);
        setPoints(sorted);
      } catch {
        // keep last good data on transient failures
      }
    };

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshKey]);

  const last = points[points.length - 1]?.value ?? STARTING_VALUE;
  const up = last >= STARTING_VALUE;
  const lineColor = up ? "#00ff88" : "#ff4444";

  return (
    <section className="flex h-full flex-col rounded-lg border border-terminal-border bg-terminal-panel">
      <header className="border-b border-terminal-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Portfolio Value
        </h2>
      </header>

      <div className="relative flex-1 p-2">
        {points.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
            Collecting data…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 8, right: 8, bottom: 4, left: 4 }}
            >
              <CartesianGrid stroke="#2d2d44" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t) =>
                  new Date(t).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                }
                stroke="#8b8ba7"
                tick={{ fontSize: 10 }}
                minTickGap={40}
              />
              <YAxis
                domain={["auto", "auto"]}
                stroke="#8b8ba7"
                tick={{ fontSize: 10 }}
                width={56}
                tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
              />
              <Tooltip
                contentStyle={{
                  background: "#1a1a2e",
                  border: "1px solid #2d2d44",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#8b8ba7" }}
                labelFormatter={(t) => new Date(t).toLocaleTimeString()}
                formatter={(v) => [`$${Number(v).toFixed(2)}`, "Value"]}
              />
              <ReferenceLine
                y={STARTING_VALUE}
                stroke="#ecad0a"
                strokeDasharray="4 4"
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
