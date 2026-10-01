/**
 * Creates an admin user and prints the TOTP secret to add to an authenticator app.
 *   pnpm --filter @hellogram/admin-api create-admin <email> <moderator|admin|grievance_officer>
 * The password is read from ADMIN_PASSWORD (never passed on the command line).
 */
import { createAdminContainer } from '../container.js';
import { loadAdminEnv } from '../env.js';

const [email, role] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!email || !role || !['moderator', 'admin', 'grievance_officer'].includes(role) || !password) {
  console.error('Usage: ADMIN_PASSWORD=... create-admin <email> <moderator|admin|grievance_officer>');
  process.exit(1);
}
const container = createAdminContainer(loadAdminEnv());
const created = await container.adminService.createAdmin(email, password, role as 'admin');
console.log(`Admin created: ${email} (${role})`);
console.log(`TOTP secret: ${created.totpSecret}`);
console.log(`Scan in an authenticator app: ${created.otpauthUrl}`);
await container.close();
