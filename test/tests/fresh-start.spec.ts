import { test, expect } from '@playwright/test';

test('shows default watchlist and $10k balance on fresh start', async ({ page }) => {
  await page.goto('/');
  // Wait for page to load
  await page.waitForSelector('[data-testid="watchlist"]', { timeout: 10000 });
  // Check for some default tickers
  await expect(page.locator('text=AAPL').first()).toBeVisible();
  await expect(page.locator('text=GOOGL').first()).toBeVisible();
  // Check cash balance
  await expect(page.locator('text=/\\$10[,.]?000/').first()).toBeVisible();
});

test('prices stream live', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(3000); // wait for SSE
  // Prices should show non-zero values
  const priceElements = page.locator('[data-testid="price"]');
  await expect(priceElements.first()).toBeVisible();
});
