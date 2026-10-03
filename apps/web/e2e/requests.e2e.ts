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

test('inbox + → type a number → see who it is → send request → owner accepts', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signUpViaUi(owner);
  const code = await createNumberViaUi(owner, 'Rahul Deals');

  const senderCtx = await browser.newContext();
  const sender = await senderCtx.newPage();
  await signUpViaUi(sender);
  const myCode = await createNumberViaUi(sender, 'Amit Kumar', 'Buying', 'Shopping');

  await sender.goto('/inbox');
  await sender.getByRole('button', { name: 'New request' }).click();
  const dialog = sender.getByRole('dialog', { name: 'New request' });
  const number = dialog.getByLabel('Their number');
  const send = dialog.getByRole('button', { name: 'Send request' });

  // A mistyped number explains the format; your own number is refused.
  await number.fill('A12');
  await number.blur();
  await expect(dialog.getByText(/a letter, 6 digits, then a letter/)).toBeVisible();
  await expect(send).toBeDisabled();
  await number.fill(myCode);
  await expect(dialog.getByText('That’s one of your own numbers.')).toBeVisible();
  await expect(send).toBeDisabled();

  // Lower case and spaces are fine; it shows whose number it is before sending.
  await number.fill(`${code.slice(0, 4)} ${code.slice(4)}`.toLowerCase());
  await expect(dialog.getByText('Rahul Deals')).toBeVisible();
  await expect(dialog.getByText(`Sending from Amit Kumar · ${myCode}`)).toBeVisible();
  await dialog.getByLabel('Intro message (optional)').fill('Is the bike still for sale?');
  await send.click();
  await expect(sender.getByRole('dialog', { name: 'Request sent' })).toBeVisible();
  await sender.getByRole('button', { name: 'Done' }).click();
  await expect(sender.getByRole('dialog')).toBeHidden();

  // Sending again while it's pending is refused by the server, and the reason is shown.
  await sender.getByRole('button', { name: 'New request' }).click();
  await dialog.getByLabel('Their number').fill(code);
  await expect(dialog.getByText('Rahul Deals')).toBeVisible();
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(dialog.getByText('You already have a pending request to this number')).toBeVisible();

  await owner.goto('/inbox/requests');
  await expect(owner.getByText('Is the bike still for sale?')).toBeVisible();
  await owner.getByRole('button', { name: 'Accept' }).click();
  await expect(owner).toHaveURL(/\/inbox\/[0-9a-f-]{36}$/);

  await ownerCtx.close();
  await senderCtx.close();
});
