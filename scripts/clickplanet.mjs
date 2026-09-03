// visite l'étoile la plus proche (J), clique sur la planète 1 (position projetée), visite (V), capture
import { chromium } from 'playwright';
const out = process.argv[2] ?? '/tmp/planet.png';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'], headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('BoundingSphere')) errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
// se place près d'une étoile à planètes (même recherche que findplanets)
for (let i = 0; i < 40; i++) {
  await page.evaluate((i) => { const p = galaxy.controls.position; p.set(-8200 + (i % 7) * 3.1, (i * 1.7) % 11, 20 + (i * 0.9) % 5); }, i);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyJ'); await page.waitForTimeout(700);
  const n = await page.evaluate(() => galaxy.systemR.system ? galaxy.systemR.system.planets.length : 0);
  if (n >= 3) break;
}
await page.waitForTimeout(1000);
// position écran de la planète 1
const pt = await page.evaluate(() => {
  const b = galaxy.systemR.bodies.find((x) => x.body.kind === 'planet');
  if (!b) return null;
  const cam = galaxy.camera; const v = new galaxy.THREE.Vector4(b.rel.x, b.rel.y, b.rel.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
  return { x: (v.x / v.w + 1) / 2 * innerWidth, y: (1 - v.y / v.w) / 2 * innerHeight, planet: b.body.planet, moons: galaxy.systemR.system.planets[b.body.planet].moons.length };
});
console.log('planète à', pt);
if (pt) {
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(500);
  console.log('--- sélection ---'); console.log(await page.evaluate(() => document.getElementById('sel').innerText));
  await page.keyboard.press('KeyV'); await page.waitForTimeout(2500);
  console.log('--- après V ---'); console.log(await page.evaluate(() => document.getElementById('sel').innerText.split('\n').slice(0, 4).join('\n')));
}
await page.screenshot({ path: out });
console.log('errors:', errs);
await browser.close();
