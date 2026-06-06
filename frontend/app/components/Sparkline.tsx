"use client";

import { useEffect, useRef } from "react";

interface SparklineProps {
  history: number[];
  width?: number;
  height?: number;
}

const GAIN = "#00ff88";
const LOSS = "#ff4444";

export default function Sparkline({
  history,
  width = 72,
  height = 30,
}: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (history.length < 2) return;

    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = max - min || 1;
    const pad = 2;
    const usableH = height - pad * 2;
    const stepX = width / (history.length - 1);

    const y = (v: number) => pad + usableH - ((v - min) / range) * usableH;

    const up = history[history.length - 1] >= history[0];
    ctx.beginPath();
    ctx.moveTo(0, y(history[0]));
    for (let i = 1; i < history.length; i++) {
      ctx.lineTo(i * stepX, y(history[i]));
    }
    ctx.strokeStyle = up ? GAIN : LOSS;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = "round";
    ctx.stroke();
  }, [history, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
