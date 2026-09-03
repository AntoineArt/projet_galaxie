// node scripts/find.mjs out.png "label du bouton" [KeyV]
import { chromium } from 'playwright';
const [out, label, ...keys] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'], headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BoundingSphere')) errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
await page.keyboard.press('KeyR'); await page.waitForTimeout(2000);
await page.click(`#find button:has-text("${label}")`); await page.waitForTimeout(1500);
console.log('--- sélection ---'); console.log(await page.evaluate(() => document.getElementById('sel').innerText));
for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(2500); console.log('--- après', k, '---'); console.log(await page.evaluate(() => document.getElementById('sel').innerText.split('\n').slice(0, 2).join('\n'))); }
await page.screenshot({ path: out });
console.log('errors:', errs);
await browser.close();
