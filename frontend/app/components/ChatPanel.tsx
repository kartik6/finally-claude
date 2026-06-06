"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage as ChatMessageType } from "@/app/types/api";
import { sendChatMessage } from "@/app/lib/api";
import ChatMessage from "./ChatMessage";

interface ChatPanelProps {
  /** Refetch portfolio/watchlist after the assistant executes actions. */
  onActions: () => void;
}

export default function ChatPanel({ onActions }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await sendChatMessage(text);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: res.message,
          actions: {
            trades: res.trades ?? [],
            watchlist_changes: res.watchlist_changes ?? [],
          },
        },
      ]);
      const didActions =
        (res.trades?.length ?? 0) > 0 ||
        (res.watchlist_changes?.length ?? 0) > 0;
      if (didActions) onActions();
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            err instanceof Error
              ? `Sorry, something went wrong: ${err.message}`
              : "Sorry, something went wrong.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex h-full flex-col rounded-lg border border-terminal-border bg-terminal-panel">
      <header className="flex items-center gap-2 border-b border-terminal-border px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-accent-purple" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          FinAlly Assistant
        </h2>
      </header>

      <div
        ref={scrollRef}
        data-testid="chat-messages"
        className="flex-1 space-y-3 overflow-y-auto p-3"
      >
        {messages.length === 0 && (
          <p className="text-sm text-gray-500">
            Ask me to analyze your portfolio, suggest trades, or manage your
            watchlist.
          </p>
        )}
        {messages.map((m, i) => (
          <ChatMessage key={i} message={m} />
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex gap-1 rounded-lg border border-terminal-border bg-terminal-bg px-3 py-2">
              <Dot delay="0ms" />
              <Dot delay="150ms" />
              <Dot delay="300ms" />
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={send}
        className="flex gap-2 border-t border-terminal-border p-2"
      >
        <input
          aria-label="Chat message"
          data-testid="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message FinAlly…"
          disabled={loading}
          className="min-w-0 flex-1 rounded border border-terminal-border bg-terminal-bg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-accent-purple focus:outline-none"
        />
        <button
          type="submit"
          data-testid="chat-send-btn"
          disabled={loading || !input.trim()}
          className="rounded bg-accent-purple px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </section>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
      style={{ animationDelay: delay }}
    />
  );
}
