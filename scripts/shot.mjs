// Capture d'écran headless : node scripts/shot.mjs [out.png] [keys...]
// Exemple : node scripts/shot.mjs /tmp/g.png KeyG
import { chromium } from 'playwright';

const out = process.argv[2] ?? '/tmp/galaxie.png';
const keys = process.argv.slice(3);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu'] , headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForSelector('#hud', { state: 'attached' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(900); }
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
const hud = await page.evaluate(() => document.getElementById('hud').textContent + '\n' + document.getElementById('star').textContent);
console.log(hud);
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
