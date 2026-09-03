// temps JS par frame (thread principal) en vol : p50 / p95 / max
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'], headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5173/' + (process.env.QS ?? ''), { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
await page.keyboard.press('KeyR'); await page.waitForTimeout(2500);
await page.evaluate(() => { galaxy.controls.speed = 30; });
const measure = async (label, hold) => {
  await page.evaluate(() => { galaxy.perfLog.length = 0; });
  if (hold) await page.keyboard.down('KeyW');
  await page.waitForTimeout(4000);
  if (hold) await page.keyboard.up('KeyW');
  const r = await page.evaluate(() => { const d = galaxy.perfLog.slice().sort((a, b) => a - b); return { p50: d[Math.floor(d.length * 0.5)], p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1], n: d.length }; });
  console.log(label.padEnd(16), `JS p50 ${r.p50.toFixed(1)} ms  p95 ${r.p95.toFixed(1)} ms  max ${r.max.toFixed(1)} ms  (${r.n} frames)`);
};
await measure('immobile', false);
await measure('en vol 30 pc/s', true);
await measure('en vol 30 pc/s', true);
await page.keyboard.press('KeyG'); await page.waitForTimeout(2000);
await page.evaluate(() => { galaxy.controls.speed = 3000; });
await measure('vol ext. 3 kpc/s', true);
await browser.close();
