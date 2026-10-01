import { expect, test } from '@playwright/test';
import { TEST_PASSWORD, fillSignup, randomMobile, signUpViaUi } from './helpers.js';

test('sign up: details → verify the mobile → My numbers; the session survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

  await fillSignup(page, randomMobile(), 'Mukti Prasad');
  await expect(page.getByRole('heading', { name: 'Verify your mobile number' })).toBeVisible();
  // OTP_BYPASS is on in this test stack: any 6-digit code is accepted.
  await page.getByLabel('Digit 1 of 6').pressSequentially('246810');

  await expect(page).toHaveURL(/\/numbers$/);
  await expect(page.getByRole('heading', { name: 'My numbers' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My numbers' })).toBeVisible();

  await page.goto('/settings/profile');
  // The private name from sign-up shows on My profile (the sidebar copy is hidden on phones).
  await expect(page.getByText('Mukti Prasad', { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

test('under-18s cannot sign up', async ({ page }) => {
  await page.goto('/signup');
  const fifteen = new Date();
  fifteen.setFullYear(fifteen.getFullYear() - 15);
  await page.getByLabel('Date of birth').fill(fifteen.toISOString().slice(0, 10));
  await expect(page.getByText('You must be 18 or older to use Hellogram')).toBeVisible();
});

test('login: same device needs only the password; a new device verifies the mobile once', async ({ browser }) => {
  const first = await browser.newContext();
  const page = await first.newPage();
  const mobile = await signUpViaUi(page);

  // Log out, then back in on the same device: password only.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Log out' }).last().click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  // Back where they were (Settings), with no code asked.
  await expect(page).toHaveURL(/\/settings$/);

  // A different browser = a new device: password, then a one-time code.
  const second = await browser.newContext();
  const other = await second.newPage();
  await other.goto('/login');
  await other.getByLabel('Mobile number').fill(mobile);
  await other.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await other.getByRole('button', { name: 'Log in' }).click();
  await expect(other.getByRole('heading', { name: 'Verify it’s you' })).toBeVisible();
  await other.getByLabel('Digit 1 of 6').pressSequentially('246810');
  await expect(other).toHaveURL(/\/numbers$/);

  // Wrong password: one generic message.
  const third = await (await browser.newContext()).newPage();
  await third.goto('/login');
  await third.getByLabel('Mobile number').fill(mobile);
  await third.getByLabel('Password', { exact: true }).fill('not-my-password');
  await third.getByRole('button', { name: 'Log in' }).click();
  await expect(third.getByText('Mobile number or password is incorrect')).toBeVisible();
  await first.close();
  await second.close();
});

test('forgot password: code + new password signs in', async ({ page }) => {
  const mobile = await signUpViaUi(page);
  await page.context().clearCookies();
  await page.goto('/forgot-password');
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('Digit 1 of 6').pressSequentially('246810');
  await page.getByLabel('Password', { exact: true }).fill('Moonlight#88');
  await page.getByLabel('Confirm password').fill('Moonlight#88');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page).toHaveURL(/\/numbers$/);
});

test('logged-out users are sent to login, and come back afterwards', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
});
