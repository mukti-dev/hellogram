import { expect, test } from '@playwright/test';

/** A fresh Indian mobile number per run so every run is a real sign-up. */
const randomMobile = () => `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

test('sign up with phone OTP → confirm 18+ → land on My numbers', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Mobile number').fill(randomMobile());
  await page.getByRole('button', { name: 'Send OTP' }).click();

  await expect(page.getByRole('heading', { name: 'Enter the OTP' })).toBeVisible();
  // OTP_BYPASS is on in dev: any 6-digit code is accepted.
  await page.getByLabel('Digit 1 of 6').pressSequentially('246810');

  await expect(page.getByRole('heading', { name: 'One last step' })).toBeVisible();
  await page.getByLabel('I am 18 years or older').check();
  await page.getByLabel(/I agree to the Terms of Service/).check();
  await page.getByRole('button', { name: 'Create my account' }).click();

  await expect(page).toHaveURL(/\/numbers$/);
  await expect(page.getByRole('heading', { name: 'My numbers' })).toBeVisible();

  // Session survives a reload via the refresh cookie.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My numbers' })).toBeVisible();
});

test('logged-out users are sent to login', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
});
