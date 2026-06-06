import { render, screen } from "@testing-library/react";
import PriceCell from "@/app/components/PriceCell";

describe("PriceCell", () => {
  it("renders a placeholder when price is undefined", () => {
    render(<PriceCell price={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("formats the price with two decimals", () => {
    render(<PriceCell price={191.5} />);
    expect(screen.getByText("191.50")).toBeInTheDocument();
  });

  it("flashes green on an uptick", () => {
    const { rerender } = render(<PriceCell price={100} />);
    rerender(<PriceCell price={101} />);
    expect(screen.getByText("101.00")).toHaveClass("flash-up");
  });

  it("flashes red on a downtick", () => {
    const { rerender } = render(<PriceCell price={100} />);
    rerender(<PriceCell price={99} />);
    expect(screen.getByText("99.00")).toHaveClass("flash-down");
  });

  it("does not flash when the price is unchanged", () => {
    const { rerender } = render(<PriceCell price={100} />);
    rerender(<PriceCell price={100} />);
    const el = screen.getByText("100.00");
    expect(el).not.toHaveClass("flash-up");
    expect(el).not.toHaveClass("flash-down");
  });
});
