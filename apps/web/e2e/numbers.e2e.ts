import { expect, test } from '@playwright/test';
import { signUpViaUi } from './helpers.js';

test('a new number: own label + icon, name, calls and media switches — no preset labels', async ({ page }) => {
  await signUpViaUi(page);
  await page.goto('/numbers/new');
  // No preset labels to pick from; only a hint with examples.
  await expect(page.getByRole('radio', { name: 'OLX' })).toHaveCount(0);
  await expect(page.getByText(/e\.g\. OLX, Dating, Tenants/)).toBeVisible();

  await page.getByLabel('Label', { exact: true }).fill('Flat hunting');
  await page.getByRole('radio', { name: 'Home' }).click();
  await expect(page.getByText('Preview:')).toBeVisible();
  await page.getByLabel('Display name').fill('Rohan');
  await page.getByRole('switch', { name: 'Allow media sharing' }).click();
  await page.screenshot({ path: test.info().outputPath('add-number.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create number' }).click();

  await expect(page.getByRole('heading', { name: 'Rohan' })).toBeVisible();
  await expect(page.getByText('Flat hunting').first()).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Allow media sharing' })).toHaveAttribute('aria-checked', 'false');

  // The inbox filter is the user's own label.
  await page.goto('/inbox');
  await expect(page.getByRole('toolbar', { name: 'Filters' }).getByText('Flat hunting')).toBeVisible();
});
