import { expect, type Browser, type Page } from '@playwright/test';

export const randomMobile = () => `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

/** Signs up through the real UI (OTP_BYPASS accepts any code). */
export async function signUpViaUi(page: Page, mobile = randomMobile()): Promise<string> {
  await page.goto('/login');
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send OTP' }).click();
  await page.getByLabel('Digit 1 of 6').pressSequentially('246810');
  await expect(page.getByRole('heading', { name: 'One last step' })).toBeVisible();
  await page.getByLabel('I am 18 years or older').check();
  await page.getByLabel(/I agree to the Terms of Service/).check();
  await page.getByRole('button', { name: 'Create my account' }).click();
  await expect(page).toHaveURL(/\/numbers$/);
  return mobile;
}

/** Creates a number through the UI and returns its code. */
export async function createNumberViaUi(page: Page, name: string): Promise<string> {
  await page.goto('/numbers/new');
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
  await visitor.goto(`/${code}`);
  await visitor.getByLabel('Mobile number').fill(randomMobile());
  await visitor.getByLabel('Intro message (optional)').fill('Is this still available?');
  await visitor.getByRole('button', { name: 'Send OTP' }).click();
  await visitor.getByLabel('Digit 1 of 6').pressSequentially('112233');
  await visitor.getByLabel('I am 18 years or older').check();
  await visitor.getByLabel(/I agree to the Terms of Service/).check();
  await visitor.getByRole('button', { name: 'Create my account' }).click();
  await visitor.getByLabel('Your name on Hellogram').fill('Amit Kumar');
  await visitor.getByRole('button', { name: 'Send request' }).click();
  await expect(visitor.getByText('Request sent')).toBeVisible();

  await owner.goto('/inbox/requests');
  await owner.getByRole('button', { name: 'Accept' }).click();
  await expect(owner).toHaveURL(/\/inbox\/[0-9a-f-]{36}$/);
  return { owner, visitor, close: async () => { await ownerCtx.close(); await visitorCtx.close(); } };
}

