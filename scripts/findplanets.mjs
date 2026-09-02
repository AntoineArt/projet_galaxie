import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'], headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
await page.waitForTimeout(1500);
for (let i = 0; i < 40; i++) {
  await page.evaluate((i) => { const p = galaxy.controls.position; p.set(-8200 + (i % 7) * 3.1, (i * 1.7) % 11, 20 + (i * 0.9) % 5); }, i);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => { const s = galaxy.systemR.system; return s ? { planets: s.planets.length, mass: s.mass, comp: !!s.companion, kinds: s.planets.map(p => p.kind) } : null; });
  if (r && r.planets >= 3) { console.log(i, JSON.stringify(r)); break; }
}
await page.evaluate(() => { galaxy.controls.speed = 1e-5; });
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/sys3.png' });
console.log(await page.evaluate(() => document.getElementById('star').textContent));
await browser.close();
