import { test, expect } from '@playwright/test';

test('portfolio heatmap renders after buying', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="trade-ticker"]', { timeout: 10000 });

  // Buy something first
  await page.fill('[data-testid="trade-ticker"]', 'MSFT');
  await page.fill('[data-testid="trade-quantity"]', '3');
  await page.click('[data-testid="trade-buy-btn"]');

  // Heatmap should show the position
  await expect(page.locator('[data-testid="heatmap"]')).toBeVisible({ timeout: 5000 });
  await expect(
    page.locator('[data-testid="heatmap"]').locator('text=MSFT').first()
  ).toBeVisible({ timeout: 5000 });
});
