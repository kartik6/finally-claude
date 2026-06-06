import "@testing-library/jest-dom";

// jsdom does not implement the canvas API; stub it so canvas-based components
// (e.g. Sparkline) render without throwing in tests.
HTMLCanvasElement.prototype.getContext = jest.fn(() => null) as never;
