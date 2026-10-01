import { expect, type Browser, type Page } from '@playwright/test';

export const randomMobile = () => `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

export const TEST_PASSWORD = 'Sunrise!42';

/** Fills the sign-up form (18+, all fields) and submits it. */
export async function fillSignup(page: Page, mobile: string, name = 'Test User') {
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByLabel('Date of birth').fill('1995-05-10');
  await page.getByText('Prefer not to say').click();
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Signs up through the real UI (OTP_BYPASS accepts any code) and lands on My numbers. */
export async function signUpViaUi(page: Page, mobile = randomMobile(), name = 'Test User'): Promise<string> {
  await page.goto('/signup');
  await fillSignup(page, mobile, name);
  await expect(page.getByRole('heading', { name: 'Verify your mobile number' })).toBeVisible();
  await page.getByLabel('Digit 1 of 6').pressSequentially('246810');
  await expect(page).toHaveURL(/\/numbers$/);
  return mobile;
}

/** Creates a number through the UI and returns its code. */
export async function createNumberViaUi(page: Page, name: string, label = 'OLX', icon = 'Shopping'): Promise<string> {
  await page.goto('/numbers/new');
  await page.getByLabel('Label', { exact: true }).fill(label);
  await page.getByRole('radio', { name: icon }).click();
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Create number' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  const code = await page.locator('.font-mono').first().innerText();
  return code.trim();
}

/** Owner with a number + a visitor who requested it; the owner accepted. Both pages end in the chat. */
export async function pair(browser: Browser) {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signUpViaUi(owner);
  const code = await createNumberViaUi(owner, 'Rahul Deals');

  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  await signUpViaUi(visitor, randomMobile(), 'Amit');
  await visitor.goto(`/${code}`);
  await visitor.getByLabel('Intro message (optional)').fill('Is this still available?');
  await visitor.getByRole('button', { name: 'Send request' }).click();
  await visitor.getByLabel('Label', { exact: true }).fill('Buying');
  await visitor.getByLabel('Your name on Hellogram').fill('Amit Kumar');
  await visitor.getByRole('button', { name: 'Send request' }).click();
  await expect(visitor.getByText('Request sent')).toBeVisible();

  await owner.goto('/inbox/requests');
  await owner.getByRole('button', { name: 'Accept' }).click();
  await expect(owner).toHaveURL(/\/inbox\/[0-9a-f-]{36}$/);
  return { owner, visitor, close: async () => { await ownerCtx.close(); await visitorCtx.close(); } };
}

