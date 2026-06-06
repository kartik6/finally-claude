"use client";

import { useState } from "react";
import { addToWatchlist } from "@/app/lib/api";

interface AddTickerInputProps {
  onAdded: () => void;
}

export default function AddTickerInput({ onAdded }: AddTickerInputProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = value.trim().toUpperCase();
    if (!ticker) return;
    setBusy(true);
    setError(null);
    try {
      await addToWatchlist(ticker);
      setValue("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add ticker");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <div className="flex gap-1.5">
        <input
          aria-label="Add ticker"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add ticker…"
          disabled={busy}
          data-testid="add-ticker-input"
          className="min-w-0 flex-1 rounded border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-sm uppercase text-white placeholder:normal-case placeholder:text-gray-500 focus:border-accent-blue focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          data-testid="add-ticker-btn"
          className="rounded bg-accent-blue px-3 py-1 text-sm font-semibold text-terminal-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && <p className="text-xs text-loss">{error}</p>}
    </form>
  );
}
