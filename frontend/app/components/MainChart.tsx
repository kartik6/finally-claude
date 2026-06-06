"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

interface MainChartProps {
  ticker: string | null;
  /** Accumulated prices since page load, oldest first. */
  priceHistory: number[];
}

const GAIN = "#00ff88";
const LOSS = "#ff4444";

export default function MainChart({ ticker, priceHistory }: MainChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  // Create the chart once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b8ba7",
        fontFamily: "ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: "#2d2d44" },
        horzLines: { color: "#2d2d44" },
      },
      rightPriceScale: { borderColor: "#2d2d44" },
      timeScale: { borderColor: "#2d2d44", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      autoSize: true,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: GAIN,
      topColor: "rgba(0, 255, 136, 0.25)",
      bottomColor: "rgba(0, 255, 136, 0.0)",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Reset the chart when the selected ticker changes.
  useEffect(() => {
    seriesRef.current?.setData([]);
  }, [ticker]);

  // Push price history into the series.
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || priceHistory.length === 0) return;

    // Synthesize one-second-spaced timestamps anchored to now so the newest
    // sample sits at the right edge.
    const now = Math.floor(Date.now() / 1000);
    const start = now - (priceHistory.length - 1);
    const data = priceHistory.map((price, i) => ({
      time: (start + i) as UTCTimestamp,
      value: price,
    }));
    series.setData(data);

    const up = priceHistory[priceHistory.length - 1] >= priceHistory[0];
    series.applyOptions({
      lineColor: up ? GAIN : LOSS,
      topColor: up ? "rgba(0, 255, 136, 0.25)" : "rgba(255, 68, 68, 0.25)",
      bottomColor: up ? "rgba(0, 255, 136, 0.0)" : "rgba(255, 68, 68, 0.0)",
    });
    chart.timeScale().fitContent();
  }, [priceHistory]);

  const current = priceHistory[priceHistory.length - 1];
  const first = priceHistory[0];
  const changePct =
    first && current ? ((current - first) / first) * 100 : 0;
  const up = changePct >= 0;

  return (
    <section className="flex h-full flex-col rounded-lg border border-terminal-border bg-terminal-panel">
      <header className="flex items-center gap-3 border-b border-terminal-border px-3 py-2">
        <h2 className="font-mono text-lg font-bold text-accent-yellow">
          {ticker ?? "—"}
        </h2>
        {ticker && current !== undefined && (
          <>
            <span className="font-mono text-base text-white">
              ${current.toFixed(2)}
            </span>
            <span
              className={`font-mono text-sm ${up ? "text-gain" : "text-loss"}`}
            >
              {up ? "+" : ""}
              {changePct.toFixed(2)}%
            </span>
          </>
        )}
      </header>

      <div className="relative flex-1">
        {!ticker && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
            Select a ticker from the watchlist
          </div>
        )}
        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ visibility: ticker ? "visible" : "hidden" }}
        />
      </div>
    </section>
  );
}
