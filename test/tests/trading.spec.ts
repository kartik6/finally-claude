import { test, expect } from '@playwright/test';

test('can buy shares and see position appear', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="trade-ticker"]', { timeout: 10000 });

  await page.fill('[data-testid="trade-ticker"]', 'AAPL');
  await page.fill('[data-testid="trade-quantity"]', '5');
  await page.click('[data-testid="trade-buy-btn"]');

  // Check position appears
  await expect(
    page.locator('[data-testid="positions-table"]').locator('text=AAPL').first()
  ).toBeVisible({ timeout: 5000 });
});
