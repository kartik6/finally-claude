import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WatchlistPanel, {
  type LivePrice,
} from "@/app/components/WatchlistPanel";
import type { WatchlistItem } from "@/app/types/api";
import * as api from "@/app/lib/api";

jest.mock("@/app/lib/api");
const mockedApi = api as jest.Mocked<typeof api>;

const items: WatchlistItem[] = [
  {
    ticker: "AAPL",
    current_price: 190,
    prev_price: 189,
    change_pct: 0.5,
    added_at: "2026-01-01T00:00:00Z",
  },
  {
    ticker: "GOOGL",
    current_price: 175,
    prev_price: 176,
    change_pct: -0.6,
    added_at: "2026-01-01T00:00:00Z",
  },
];

function renderPanel(overrides: Partial<Parameters<typeof WatchlistPanel>[0]> = {}) {
  const props = {
    items,
    livePrices: new Map<string, LivePrice>(),
    history: new Map<string, number[]>(),
    selectedTicker: null,
    onSelect: jest.fn(),
    onWatchlistChange: jest.fn(),
    ...overrides,
  };
  render(<WatchlistPanel {...props} />);
  return props;
}

describe("WatchlistPanel", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders all tickers", () => {
    renderPanel();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("GOOGL")).toBeInTheDocument();
  });

  it("prefers the live price over the REST snapshot", () => {
    const livePrices = new Map<string, LivePrice>([
      ["AAPL", { price: 195.25, change_pct: 2.0 }],
    ]);
    renderPanel({ livePrices });
    expect(screen.getByText("195.25")).toBeInTheDocument();
  });

  it("calls onSelect when a row is clicked", async () => {
    const props = renderPanel();
    await userEvent.click(screen.getByText("AAPL"));
    expect(props.onSelect).toHaveBeenCalledWith("AAPL");
  });

  it("removes a ticker and notifies the parent", async () => {
    mockedApi.removeFromWatchlist.mockResolvedValue({});
    const props = renderPanel();
    await userEvent.click(screen.getByLabelText("Remove GOOGL"));
    expect(mockedApi.removeFromWatchlist).toHaveBeenCalledWith("GOOGL");
    expect(props.onWatchlistChange).toHaveBeenCalled();
  });

  it("adds a ticker via the input", async () => {
    mockedApi.addToWatchlist.mockResolvedValue({});
    const props = renderPanel();
    await userEvent.type(screen.getByLabelText("Add ticker"), "nvda");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(mockedApi.addToWatchlist).toHaveBeenCalledWith("NVDA");
    expect(props.onWatchlistChange).toHaveBeenCalled();
  });
});
