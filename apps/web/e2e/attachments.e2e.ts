import { expect, test } from '@playwright/test';
import { pair } from './helpers.js';

test('photos and files are shared in a chat and fetched only with the login', async ({ browser }) => {
  const { owner, visitor, close } = await pair(browser);
  await visitor.goto('/inbox');
  await visitor.getByRole('link', { name: /Rahul Deals/ }).click();

  // A real 3000×2000 JPEG, made in the browser.
  const jpeg = await visitor.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000;
    canvas.height = 2000;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 3000, 2000);
    gradient.addColorStop(0, '#7c5cff');
    gradient.addColorStop(1, '#ff6fb1');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 3000, 2000);
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]!;
  });

  await visitor.locator('input[type=file]').setInputFiles({ name: 'bike photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
  await expect(visitor.getByText('bike photo.jpg')).toBeVisible();
  await visitor.getByLabel('Add a caption…').fill('Here is the bike');
  await visitor.getByRole('button', { name: 'Send' }).click();

  // Both sides see the photo (shrunk to 2048 px wide) with its caption.
  for (const page of [visitor, owner]) {
    const photo = page.getByRole('img', { name: 'bike photo.jpg' });
    await expect(photo).toBeVisible();
    await expect(page.getByRole('log', { name: 'Messages' }).getByText('Here is the bike')).toBeVisible();
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2048);
    // Shown from memory, not from a URL anyone could copy.
    expect(await photo.getAttribute('src')).toMatch(/^blob:/);
  }

  // The file itself needs the access token: a plain request (cookies only) is refused.
  const attachmentId = await owner.evaluate(async () => {
    const entry = performance.getEntriesByType('resource').find((e) => e.name.includes('/v1/attachments/'));
    return entry!.name.split('/').pop()!;
  });
  expect(await owner.evaluate(async (id) => (await fetch(`/v1/attachments/${id}`, { credentials: 'include' })).status, attachmentId)).toBe(401);

  // Full-size view.
  await owner.getByRole('button', { name: 'Open photo' }).click();
  await expect(owner.getByRole('dialog').getByRole('img', { name: 'bike photo.jpg' })).toBeVisible();
  await owner.keyboard.press('Escape');

  // A PDF from the other side, downloaded by the receiver.
  await owner.locator('input[type=file]').setInputFiles({ name: 'Rent agreement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nagreement\n%%EOF') });
  await owner.getByRole('button', { name: 'Send' }).click();
  const fileCard = visitor.getByRole('button', { name: 'Download Rent agreement.pdf' });
  await expect(fileCard).toBeVisible();
  const [download] = await Promise.all([visitor.waitForEvent('download'), fileCard.click()]);
  expect(download.suggestedFilename()).toBe('Rent agreement.pdf');

  // Unsafe types are refused with a clear message.
  await owner.locator('input[type=file]').setInputFiles({ name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') });
  await owner.getByRole('button', { name: 'Send' }).click();
  await expect(owner.getByRole('alert')).toContainText('This file type can’t be sent');

  // Delete for everyone removes the photo on both sides.
  const bubble = visitor.locator('div.group').filter({ has: visitor.getByRole('img', { name: 'bike photo.jpg' }) });
  await bubble.hover();
  await bubble.getByRole('button', { name: 'Message actions' }).click();
  await visitor.getByRole('menuitem', { name: 'Delete for everyone' }).click();
  await expect(owner.getByRole('img', { name: 'bike photo.jpg' })).toHaveCount(0);
  await expect(owner.getByText('This message was deleted')).toBeVisible();
  await close();
});
