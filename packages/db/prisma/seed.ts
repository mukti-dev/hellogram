/**
 * Demo data matching the designs (spec §11). Idempotent: skips if the demo owner exists.
 *   pnpm db:seed
 *
 * Log in as the demo owner with mobile 99999 00001 (any 6-digit code while OTP_BYPASS=true).
 * Each other demo person can log in with their own number (see PEOPLE below).
 */
import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { createPrismaClient } from '../src/index.js';

const prisma = createPrismaClient(process.env.DATABASE_URL ?? '');
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);

function code(): string {
  for (;;) {
    const digits = Array.from({ length: 6 }, () => randomInt(10)).join('');
    if (new Set(digits).size < 4) continue; // skip weak-looking blocks
    return `${LETTERS[randomInt(24)]}${digits}${LETTERS[randomInt(24)]}`;
  }
}

/** Every demo account logs in with this password (argon2id hash of "Hello@2026"). */
export const DEMO_PASSWORD = 'Hello@2026';
const DEMO_PASSWORD_HASH = '$argon2id$v=19$m=19456,p=1,t=2$3pq1dDL2Sa8VKyargHGZsQ$j97MydyqKWNw/NkjaDU0jeEMvHtYJ5hgW+49KGU+BGw';

const DEMO_ACCOUNTS: [phone: string, name: string, gender: 'male' | 'female'][] = [
  ['+919999900001', 'Demo User', 'male'],
  ['+919999900002', 'Amit Kumar', 'male'],
  ['+919999900003', 'Sneha R', 'female'],
  ['+919999900004', 'Rohit Mehta', 'male'],
  ['+919999900005', 'Priya Singh', 'female'],
  ['+919999900006', 'Vikram', 'male'],
  ['+919999900007', 'Karan Patel', 'male'],
  ['+919999900008', 'Neha Sharma', 'female'],
];

const profile = (phone: string) => {
  const [, name, gender] = DEMO_ACCOUNTS.find(([p]) => p === phone) ?? [phone, 'Demo User', 'male'];
  return { name, gender, dateOfBirth: new Date('1995-05-10T00:00:00Z'), passwordHash: DEMO_PASSWORD_HASH };
};

async function account(phone: string) {
  return prisma.account.create({
    data: {
      phone,
      ...profile(phone),
      ageConfirmedAt: ago(30 * DAY),
      createdAt: ago(30 * DAY),
      consents: { create: { version: '2026-09-v1' } },
    },
  });
}

/** Demo accounts seeded before passwords existed get a name, birthday, gender and the demo password. */
async function upgradeDemoLogins() {
  for (const [phone] of DEMO_ACCOUNTS) {
    await prisma.account.updateMany({ where: { phone, passwordHash: null }, data: profile(phone) });
  }
}

/** Labels are the user's own words + an icon (these mirror the designs). */
async function persona(
  accountId: string,
  displayName: string,
  [labelName, labelIcon]: [name: string, icon: string],
  extra: Record<string, unknown> = {},
) {
  return prisma.persona.create({
    data: { accountId, code: code(), displayName, labelName, labelIcon, createdAt: ago(20 * DAY), ...extra },
  });
}

let seq = 0;
async function conversation(a: { id: string }, b: { id: string }, lines: [who: 'a' | 'b', text: string, minutesAgo: number][]) {
  const [personaAId, personaBId] = [a.id, b.id].sort() as [string, string];
  const c = await prisma.conversation.create({
    data: {
      personaAId,
      personaBId,
      retention: 'd30',
      createdAt: ago(3 * DAY),
      members: { create: [{ personaId: personaAId }, { personaId: personaBId }] },
    },
  });
  for (const [who, text, minutesAgo] of lines) {
    const sender = who === 'a' ? a : b;
    await prisma.message.create({
      data: {
        conversationId: c.id,
        senderPersonaId: sender.id,
        clientMessageId: `seed-${++seq}`,
        body: text,
        createdAt: ago(minutesAgo * MIN),
        deliveredAt: ago(minutesAgo * MIN - 1000),
      },
    });
  }
  await prisma.conversation.update({ where: { id: c.id }, data: { lastMessageAt: ago((lines.at(-1)?.[2] ?? 0) * MIN) } });
  return c;
}

async function main() {
  if (await prisma.account.findUnique({ where: { phone: '+919999900001' } })) {
    await upgradeDemoLogins();
    console.log(`Demo data already present — demo logins use the password ${DEMO_PASSWORD}.`);
    return;
  }

  // The demo owner: three numbers like the "My numbers" design (2 free · 1 paid).
  const owner = await account('+919999900001');
  const rahul = await persona(owner.id, 'Rahul Deals', ['OLX', 'shopping-bag']);
  const coffee = await persona(owner.id, 'Coffee Chats', ['Dating', 'heart'], { allowCalls: false });
  const rental = await persona(owner.id, 'Rental Enquiries', ['Tenants', 'home'], { status: 'paused', pauseReason: 'user', isPaid: true });
  const sub = await prisma.subscription.create({
    data: { accountId: owner.id, provider: 'dev', providerSubId: 'dev_sub_seed', quantity: 1, status: 'active', currentPeriodEnd: new Date(now + 20 * DAY) },
  });
  await prisma.$executeRaw`SELECT setval('invoice_seq', GREATEST((SELECT last_value FROM invoice_seq), 1))`;
  await prisma.payment.create({
    data: { subscriptionId: sub.id, amountPaise: 4900, gstPaise: 747, invoiceNo: 'HG/2026-27/SEED01', providerPaymentId: 'dev_pay_seed', paidAt: ago(10 * DAY) },
  });

  // People from the inbox / requests designs, each with their own account and number.
  const PEOPLE = [
    ['+919999900002', 'Amit Kumar'],
    ['+919999900003', 'Sneha R'],
    ['+919999900004', 'Rohit Mehta'],
    ['+919999900005', 'Priya Singh'],
    ['+919999900006', 'Vikram'],
    ['+919999900007', 'Karan Patel'],
    ['+919999900008', 'Neha Sharma'],
  ] as const;
  const p: Record<string, { id: string }> = {};
  for (const [phone, name] of PEOPLE) {
    const acct = await account(phone);
    p[name] = await persona(acct.id, name, ['Personal', 'users']);
  }

  // Pending contact requests (screen 7).
  const request = (from: { id: string }, to: { id: string }, intro: string, minutesAgo: number) =>
    prisma.contactRequest.create({
      data: { fromPersonaId: from.id, toPersonaId: to.id, introMessage: intro, createdAt: ago(minutesAgo * MIN), expiresAt: new Date(now + 29 * DAY) },
    });
  await request(p['Amit Kumar']!, rahul, 'Hi, is this laptop still available? I’m interested.', 120);
  await request(p['Sneha R']!, coffee, 'Let’s connect this weekend.', 300);
  await request(p['Rohit Mehta']!, rental, 'Can I visit tomorrow?', 1440);

  // Chats (screen 8 / desktop inbox).
  const priya = await conversation(rahul, p['Priya Singh']!, [
    ['b', 'Hi, is this still available?', 190],
    ['a', 'Yes, it is. Are you interested?', 188],
    ['b', 'Can you share some more photos?', 186],
    ['b', 'Looks good. What’s the price?', 182],
  ]);
  await conversation(coffee, p['Vikram']!, [['b', 'Hey! Coffee on Saturday?', 26 * 60]]);
  await conversation(rental, p['Karan Patel']!, [
    ['b', 'Is the 2BHK still available?', 3 * 24 * 60],
    ['a', 'Yes — visits on weekends.', 3 * 24 * 60 - 5],
    ['b', 'Thanks!', 3 * 24 * 60 - 10],
  ]);
  await conversation(coffee, p['Neha Sharma']!, [['b', 'Okay, let me check and get back.', 3 * 24 * 60 + 30]]);

  // A small call log.
  await prisma.call.create({
    data: {
      conversationId: priya.id, callerPersonaId: p['Priya Singh']!.id, calleePersonaId: rahul.id,
      status: 'ended', endReason: 'completed', createdAt: ago(180 * MIN), answeredAt: ago(180 * MIN - 5000), endedAt: ago(176 * MIN),
    },
  });
  await prisma.call.create({
    data: {
      conversationId: priya.id, callerPersonaId: p['Priya Singh']!.id, calleePersonaId: rahul.id,
      status: 'missed', endReason: 'no_answer', createdAt: ago(26 * HOUR), endedAt: ago(26 * HOUR - 45_000),
    },
  });

  console.log('Demo data created.');
  console.log('Owner: mobile 99999 00001 — numbers Rahul Deals, Coffee Chats, Rental Enquiries.');
  console.log('Others: 99999 00002 … 00008 (Amit, Sneha, Rohit, Priya, Vikram, Karan, Neha).');
  console.log(`Every demo account logs in with the password ${DEMO_PASSWORD}.`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
