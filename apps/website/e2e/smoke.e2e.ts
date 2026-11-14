import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('landing page opens', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('heading', 'One inventory. Every harness.')).toBeVisible();
});
