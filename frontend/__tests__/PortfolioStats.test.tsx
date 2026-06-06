import { render, screen } from "@testing-library/react";
import PortfolioStats from "@/app/components/PortfolioStats";
import type { Portfolio } from "@/app/types/api";

describe("PortfolioStats", () => {
  it("renders zeros when there is no portfolio", () => {
    render(<PortfolioStats portfolio={null} />);
    expect(screen.getByText("Total Value")).toBeInTheDocument();
    expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
  });

  it("shows a positive P&L in the gain style", () => {
    const portfolio: Portfolio = {
      cash_balance: 5000,
      positions: [],
      total_value: 10500,
      unrealized_pnl: 500,
    };
    render(<PortfolioStats portfolio={portfolio} />);
    expect(screen.getByText("$10,500.00")).toBeInTheDocument();
    expect(screen.getByText("+$500.00")).toBeInTheDocument();
    expect(screen.getByText("$5,000.00")).toBeInTheDocument();
  });

  it("formats a negative P&L with a minus sign", () => {
    const portfolio: Portfolio = {
      cash_balance: 2000,
      positions: [],
      total_value: 9000,
      unrealized_pnl: -1000,
    };
    render(<PortfolioStats portfolio={portfolio} />);
    expect(screen.getByText("-$1,000.00")).toBeInTheDocument();
  });
});
