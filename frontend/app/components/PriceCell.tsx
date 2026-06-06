"use client";

import { useEffect, useRef, useState } from "react";

interface PriceCellProps {
  price: number | undefined;
  className?: string;
}

function format(price: number): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function PriceCell({ price, className = "" }: PriceCellProps) {
  const prevRef = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<"flash-up" | "flash-down" | "">("");

  useEffect(() => {
    if (price === undefined) return;
    const prev = prevRef.current;
    if (prev !== undefined && price !== prev) {
      const dir = price > prev ? "flash-up" : "flash-down";
      setFlash(dir);
      const t = setTimeout(() => setFlash(""), 500);
      prevRef.current = price;
      return () => clearTimeout(t);
    }
    prevRef.current = price;
  }, [price]);

  return (
    <span
      data-testid="price"
      className={`inline-block rounded px-1 font-mono tabular-nums ${flash} ${className}`}
    >
      {price === undefined ? "—" : format(price)}
    </span>
  );
}
