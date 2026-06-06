export interface Position {
  ticker: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  unrealized_pnl: number;
  pnl_pct: number;
}

export interface Portfolio {
  cash_balance: number;
  positions: Position[];
  total_value: number;
  unrealized_pnl: number;
}

export interface WatchlistItem {
  ticker: string;
  current_price: number;
  prev_price: number;
  change_pct: number;
  added_at: string;
}

export interface Trade {
  id?: string;
  ticker: string;
  side: string;
  quantity: number;
  price?: number;
  executed_at?: string;
  status?: string;
  reason?: string;
}

export interface WatchlistChange {
  ticker: string;
  action: "add" | "remove";
  status?: string;
  reason?: string;
}

export interface ChatActions {
  trades: Trade[];
  watchlist_changes: WatchlistChange[];
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  actions?: ChatActions;
}

export interface ChatResponse {
  message: string;
  trades: Trade[];
  watchlist_changes: WatchlistChange[];
}

export interface PriceUpdate {
  ticker: string;
  price: number;
  prev_price: number;
  change_direction: "up" | "down" | "flat";
  timestamp: string;
}

export interface PortfolioSnapshot {
  total_value: number;
  recorded_at: string;
}
