import { expect, test } from '@playwright/test';
import { pair } from './helpers.js';

test('two browsers chat live with ticks and typing', async ({ browser }) => {
  const { owner, visitor, close } = await pair(browser);

  await expect(owner.getByRole('log').getByText('Is this still available?')).toBeVisible();

  // Visitor opens the chat from the inbox.
  await visitor.goto('/inbox');
  await visitor.getByRole('link', { name: /Rahul Deals/ }).click();
  await expect(visitor.getByRole('log').getByText('Is this still available?')).toBeVisible();

  // Owner replies; visitor gets it live (no reload).
  await owner.getByLabel('Type a message…').fill('Yes, it is. Are you interested?');
  await owner.getByRole('button', { name: 'Send' }).click();
  await expect(visitor.getByRole('log').getByText('Yes, it is. Are you interested?')).toBeVisible();

  // Visitor has the chat open, so the owner's message goes to read (blue ticks).
  await expect(owner.getByRole('log').getByRole('img', { name: 'Read' }).first()).toBeVisible();

  // Typing indicator.
  await visitor.getByLabel('Type a message…').pressSequentially('Can you share');
  await expect(owner.getByText('typing…')).toBeVisible();
  await visitor.getByRole('button', { name: 'Send' }).click();
  await expect(owner.getByRole('log').getByText('Can you share')).toBeVisible();

  await close();
});
