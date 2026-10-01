// Renders public/icon.svg into the PNG icons browsers need for installable PWAs.
//   node scripts/generate-icons.mjs
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

const targets = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  // Maskable: keep the mark inside the 80% safe zone on a solid background.
  { file: 'icon-maskable-512.png', size: 512, pad: 0.12 },
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
];

for (const { file, size, pad } of targets) {
  const inner = Math.round(size * (1 - pad * 2));
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:#0B0B14;display:grid;place-items:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
    </body></html>`,
  );
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname, omitBackground: false });
  console.log('wrote', file);
}
await browser.close();
