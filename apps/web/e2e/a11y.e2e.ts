import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createNumberViaUi, signUpViaUi } from './helpers.js';

/** WCAG 2.1 AA checks on the main screens. Fails on serious/critical violations. */
async function audit(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `${name} has accessibility violations`).toEqual([]);
}

test('login, sign-up, forgot password and legal pages', async ({ page }) => {
  await page.goto('/login');
  await audit(page, 'login');
  await page.goto('/signup');
  await audit(page, 'sign-up');
  await page.goto('/forgot-password');
  await audit(page, 'forgot password');
  await page.goto('/privacy');
  await audit(page, 'privacy');
  await page.goto('/grievance');
  await audit(page, 'grievance');
});

test('signed-in screens', async ({ page }) => {
  await signUpViaUi(page);
  await audit(page, 'my numbers (empty)');
  const code = await createNumberViaUi(page, 'A11y Number');
  await audit(page, 'number detail');
  await page.goto('/numbers/new');
  await audit(page, 'add number');
  await page.goto('/inbox');
  await audit(page, 'inbox');
  await page.goto('/calls');
  await audit(page, 'calls');
  await page.goto('/settings');
  await audit(page, 'settings');
  await page.goto('/settings/profile');
  await page.getByRole('heading', { name: 'My profile' }).waitFor();
  await audit(page, 'profile');
  await page.goto(`/${code}`);
  await audit(page, 'public number page');
});
