import { test, expect } from '@playwright/test';

test('AI chat responds and executes mock trade', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="chat-input"]', { timeout: 10000 });

  await page.fill('[data-testid="chat-input"]', 'analyze my portfolio');
  await page.click('[data-testid="chat-send-btn"]');

  // Wait for response (mock LLM is fast)
  await expect(
    page.locator('[data-testid="chat-messages"]').locator('text=AAPL').first()
  ).toBeVisible({ timeout: 15000 });
  // Mock response buys 5 AAPL — check position
  await expect(
    page.locator('[data-testid="positions-table"]').locator('text=AAPL').first()
  ).toBeVisible({ timeout: 5000 });
});
