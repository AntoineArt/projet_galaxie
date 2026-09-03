// node scripts/click.mjs out.png x y [keys...] : R, clic à (x,y), touches, capture
import { chromium } from 'playwright';
const [out, xs, ys, ...keys] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'], headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BoundingSphere')) errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/' + (process.env.QS ?? ''), { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
await page.keyboard.press('KeyR'); await page.waitForTimeout(2500);
await page.mouse.click(+xs, +ys); await page.waitForTimeout(600);
console.log('--- sélection ---'); console.log(await page.evaluate(() => document.getElementById('sel').innerText));
for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(1500); console.log('--- après', k, '---'); console.log(await page.evaluate(() => document.getElementById('sel').innerText.split('\n').slice(0, 3).join('\n'))); }
await page.waitForTimeout(1500);
await page.screenshot({ path: out });
console.log('hud:', await page.evaluate(() => document.getElementById('hud').textContent.split('\n')[2]));
console.log('errors:', errs);
await browser.close();
