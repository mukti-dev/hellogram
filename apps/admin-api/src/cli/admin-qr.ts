/**
 * Shows the authenticator QR code for an existing admin again (first setup, or a new phone).
 *   pnpm --filter @hellogram/admin-api admin-qr <email>
 * Needs database access, like create-admin. The code on screen is a login secret: don't share or screenshot it.
 */
import { terminalQr } from '@hellogram/infrastructure';
import { createAdminContainer } from '../container.js';
import { loadAdminEnv } from '../env.js';

const [email] = process.argv.slice(2);
if (!email) {
  console.error('Usage: admin-qr <email>');
  process.exit(1);
}
const container = createAdminContainer(loadAdminEnv());
try {
  const { otpauthUrl } = await container.adminService.enrolment(email);
  console.log(`\nScan this with an authenticator app for ${email}:\n`);
  console.log(await terminalQr(otpauthUrl));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await container.close();
}
