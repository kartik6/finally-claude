import { test, expect } from '@playwright/test';

test('can add and remove a ticker from watchlist', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="watchlist"]', { timeout: 10000 });

  // Add PYPL
  await page.fill('[data-testid="add-ticker-input"]', 'PYPL');
  await page.click('[data-testid="add-ticker-btn"]');
  await expect(page.locator('text=PYPL').first()).toBeVisible({ timeout: 5000 });

  // Remove PYPL
  await page.click('[data-testid="remove-ticker-PYPL"]');
  await expect(page.locator('[data-testid="remove-ticker-PYPL"]')).not.toBeVisible({ timeout: 5000 });
});
