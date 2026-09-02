import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'], headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('BoundingSphere')) errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
const steps = ['KeyG', 'KeyH', 'KeyR', 'KeyJ', 'KeyF', 'KeyT', 'BracketRight', 'BracketRight', 'BracketRight', 'KeyT', 'Digit0', 'KeyE', 'KeyE'];
for (const k of steps) { await page.keyboard.press(k); await page.waitForTimeout(700); console.log(k.padEnd(14), await page.evaluate(() => document.getElementById('hud').textContent.split('\n')[0])); }
await page.evaluate(() => { galaxy.state.time = 500; });
await page.waitForTimeout(1500);
await page.evaluate(() => { galaxy.state.time = 21000; });
await page.waitForTimeout(1500);
console.log('time 21 Ga:', await page.evaluate(() => document.getElementById('hud').textContent.split('\n')[0]));
console.log('errors:', errs.length, errs.slice(0, 5));
await browser.close();
