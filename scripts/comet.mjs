import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'], headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BoundingSphere')) errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
let info = null;
for (let i = 0; i < 60 && !info; i++) {
  await page.evaluate((i) => { const p = galaxy.controls.position; p.set(-8200 + (i % 7) * 3.1, (i * 1.7) % 11, 20 + (i * 0.9) % 5); }, i);
  await page.waitForTimeout(350);
  await page.keyboard.press('KeyJ'); await page.waitForTimeout(600);
  info = await page.evaluate(() => { const s = galaxy.systemR.system; if (!s || !s.comets.length) return null; const c = galaxy.systemR.bodies.find((b) => b.body.kind === 'comet'); return { comets: s.comets.length, dist: c && c.rel.length() / 4.848e-6, tail: galaxy.systemR.tailLines.visible }; });
}
console.log(JSON.stringify(info));
// sélectionne la comète et la visite
await page.evaluate(() => { const b = galaxy.systemR.bodies.find((x) => x.body.kind === 'comet'); galaxy.selection.current = { kind: 'body', systemId: galaxy.systemR.system.id, body: b.body, label: b.label, radius: b.body.radius }; });
await page.keyboard.press('KeyV'); await page.waitForTimeout(2500);
console.log(await page.evaluate(() => document.getElementById('sel').innerText.split('\n').slice(0, 5).join('\n')));
await page.screenshot({ path: '/tmp/comet.png' });
console.log('errors:', errs);
await browser.close();
