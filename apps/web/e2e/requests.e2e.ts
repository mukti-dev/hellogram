import { expect, test } from '@playwright/test';
import { createNumberViaUi, fillSignup, randomMobile, signUpViaUi } from './helpers.js';

test('stranger opens link → sends request → owner accepts', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signUpViaUi(owner);
  const code = await createNumberViaUi(owner, 'Rahul Deals');
  expect(code).toMatch(/^[A-Z]\d{6}[A-Z]$/);

  // Visitor: logged out, opens the public link.
  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  await visitor.goto(`/${code.toLowerCase()}`);
  await expect(visitor).toHaveURL(new RegExp(`/${code}$`));
  await expect(visitor.getByRole('heading', { name: 'Rahul Deals' })).toBeVisible();
  await visitor.getByLabel('Intro message (optional)').fill('Is the laptop still available?');

  // Not signed up yet: sign up from the link, then land back on it with the intro kept.
  await visitor.getByRole('button', { name: 'Sign up to send a request' }).click();
  await fillSignup(visitor, randomMobile(), 'Amit');
  await visitor.getByLabel('Digit 1 of 6').pressSequentially('135790');
  await expect(visitor).toHaveURL(new RegExp(`/${code}$`));
  await expect(visitor.getByLabel('Intro message (optional)')).toHaveValue('Is the laptop still available?');
  await visitor.getByRole('button', { name: 'Send request' }).click();
  await visitor.getByLabel('Label', { exact: true }).fill('Buying');
  await visitor.getByLabel('Your name on Hellogram').fill('Amit Kumar');
  await visitor.getByRole('button', { name: 'Send request' }).click();
  await expect(visitor.getByText('Request sent')).toBeVisible();

  // Owner: sees the banner, reviews, accepts.
  await owner.goto('/inbox');
  await expect(owner.getByText('1 new request')).toBeVisible();
  await owner.getByRole('link', { name: /Review now/ }).click();
  await expect(owner.getByText('Amit Kumar')).toBeVisible();
  await expect(owner.getByText('Is the laptop still available?')).toBeVisible();
  await owner.getByRole('button', { name: 'Accept' }).click();
  await expect(owner).toHaveURL(/\/inbox\/[0-9a-f-]{36}$/);

  await ownerCtx.close();
  await visitorCtx.close();
});
