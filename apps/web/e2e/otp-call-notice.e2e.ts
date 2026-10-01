import { expect, test } from '@playwright/test';

// When the server delivers codes with 2Factor, people are told they may get a call instead of an SMS.
test('warns that the code may come as a phone call', async ({ page }) => {
  await page.route('**/v1/auth/config', (route) =>
    route.fulfill({ json: { phoneAuth: 'otp', otpDelivery: 'call_or_sms', consentVersion: 'x' } }),
  );
  // Never reach the real API: nothing must go out to a phone from a test.
  await page.route('**/v1/auth/login', (route) => route.fulfill({ json: { status: 'verify_device', ticket: 't'.repeat(24) } }));
  await page.goto('/login');
  await expect(page.getByText('You may get a phone call that reads out your code. If not, you’ll get it by SMS.')).toBeVisible();

  await page.getByLabel('Mobile number').fill('9999912345');
  await page.getByLabel('Password', { exact: true }).fill('whatever-123');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Verify it’s you' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('you may get a call that reads out your 6-digit code');
  await page.screenshot({ path: test.info().outputPath('call-notice.png') });
});

test('says nothing about calls when codes only come by SMS', async ({ page }) => {
  await page.route('**/v1/auth/config', (route) => route.fulfill({ json: { phoneAuth: 'otp', otpDelivery: 'sms', consentVersion: 'x' } }));
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  await expect(page.getByText(/phone call that reads out/)).toHaveCount(0);
});
