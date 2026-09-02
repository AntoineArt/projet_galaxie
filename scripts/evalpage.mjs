// node scripts/evalpage.mjs [keys...] -- évalue /tmp/eval.js après les touches
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'], headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
await page.waitForTimeout(1500);
for (const k of process.argv.slice(2)) { await page.keyboard.press(k); await page.waitForTimeout(600); }
console.log(JSON.stringify(await page.evaluate(readFileSync('/tmp/eval.js', 'utf8')), null, 1));
await browser.close();
