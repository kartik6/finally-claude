"use client";

import type { ChatMessage as ChatMessageType } from "@/app/types/api";

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const trades = message.actions?.trades ?? [];
  const watchlistChanges = message.actions?.watchlist_changes ?? [];

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
            isUser
              ? "bg-accent-purple text-white"
              : "border border-terminal-border bg-terminal-bg text-gray-200"
          }`}
        >
          {message.content}
        </div>

        {(trades.length > 0 || watchlistChanges.length > 0) && (
          <div className="mt-1.5 flex flex-col gap-1">
            {trades.map((t, i) => {
              const ok = t.status !== "error";
              return (
                <div
                  key={`t-${i}`}
                  className={`rounded border px-2 py-1 font-mono text-xs ${
                    ok
                      ? "border-gain/40 bg-gain/10 text-gain"
                      : "border-loss/40 bg-loss/10 text-loss"
                  }`}
                >
                  {ok ? (
                    <>
                      {t.side === "buy" ? "Bought" : "Sold"} {t.quantity}{" "}
                      {t.ticker}
                      {t.price != null ? ` @ $${t.price.toFixed(2)}` : ""} ✓
                    </>
                  ) : (
                    <>
                      {t.side} {t.quantity} {t.ticker} — {t.reason}
                    </>
                  )}
                </div>
              );
            })}
            {watchlistChanges.map((w, i) => {
              const ok = w.status !== "error";
              return (
                <div
                  key={`w-${i}`}
                  className={`rounded border px-2 py-1 font-mono text-xs ${
                    ok
                      ? "border-accent-blue/40 bg-accent-blue/10 text-accent-blue"
                      : "border-loss/40 bg-loss/10 text-loss"
                  }`}
                >
                  {ok ? (
                    <>
                      {w.action === "add" ? "Added" : "Removed"} {w.ticker} ✓
                    </>
                  ) : (
                    <>
                      {w.action} {w.ticker} — {w.reason}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
