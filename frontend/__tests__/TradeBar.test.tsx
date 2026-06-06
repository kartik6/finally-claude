import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TradeBar from "@/app/components/TradeBar";
import * as api from "@/app/lib/api";

jest.mock("@/app/lib/api");
const mockedApi = api as jest.Mocked<typeof api>;

describe("TradeBar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls executeTrade with buy and correct params", async () => {
    mockedApi.executeTrade.mockResolvedValue({});
    const onTraded = jest.fn();
    render(<TradeBar onTraded={onTraded} />);

    await userEvent.type(screen.getByLabelText("Trade ticker"), "aapl");
    await userEvent.type(screen.getByLabelText("Trade quantity"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Buy" }));

    expect(mockedApi.executeTrade).toHaveBeenCalledWith("AAPL", 5, "buy");
    expect(await screen.findByText(/Bought 5 AAPL/)).toBeInTheDocument();
    expect(onTraded).toHaveBeenCalled();
  });

  it("calls executeTrade with sell", async () => {
    mockedApi.executeTrade.mockResolvedValue({});
    render(<TradeBar onTraded={jest.fn()} />);

    await userEvent.type(screen.getByLabelText("Trade ticker"), "TSLA");
    await userEvent.type(screen.getByLabelText("Trade quantity"), "2.5");
    await userEvent.click(screen.getByRole("button", { name: "Sell" }));

    expect(mockedApi.executeTrade).toHaveBeenCalledWith("TSLA", 2.5, "sell");
  });

  it("shows the API error message inline", async () => {
    mockedApi.executeTrade.mockRejectedValue(new Error("insufficient cash"));
    render(<TradeBar onTraded={jest.fn()} />);

    await userEvent.type(screen.getByLabelText("Trade ticker"), "AAPL");
    await userEvent.type(screen.getByLabelText("Trade quantity"), "9999");
    await userEvent.click(screen.getByRole("button", { name: "Buy" }));

    expect(await screen.findByText("insufficient cash")).toBeInTheDocument();
  });

  it("rejects non-positive quantity without calling the API", async () => {
    render(<TradeBar onTraded={jest.fn()} />);
    await userEvent.type(screen.getByLabelText("Trade ticker"), "AAPL");
    await userEvent.click(screen.getByRole("button", { name: "Buy" }));

    expect(mockedApi.executeTrade).not.toHaveBeenCalled();
    expect(screen.getByText("Quantity must be positive")).toBeInTheDocument();
  });
});
