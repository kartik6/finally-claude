import { test, expect } from '@playwright/test';

// The SSE hook (frontend/app/lib/sse.ts) flips to a "Reconnecting" state when
// the EventSource emits `onerror`, then auto-reconnects with backoff. We force a
// failed connection by aborting the stream request, confirm the indicator leaves
// "Connected", then lift the block and confirm it recovers.
test('connection indicator recovers after the stream drops', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=Connected').first()).toBeVisible({ timeout: 10000 });

  // Abort every /api/stream/prices request so reconnect attempts fail.
  await page.route('**/api/stream/prices', (route) => route.abort());

  // Reload so the EventSource is recreated against the now-blocked endpoint;
  // onerror fires and the indicator shows Reconnecting/Disconnected.
  await page.reload();
  await expect(page.locator('text=/Reconnecting|Disconnected/').first()).toBeVisible({
    timeout: 15000,
  });

  // Lift the block; the hook's backoff timer reconnects and we return to Connected.
  await page.unroute('**/api/stream/prices');
  await expect(page.locator('text=Connected').first()).toBeVisible({ timeout: 20000 });
});
