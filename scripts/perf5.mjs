import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-frame-rate-limit', '--disable-gpu-vsync'], headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
const measure = async (label, setup) => {
  await page.evaluate(setup);
  await page.waitForTimeout(1200);
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2500) requestAnimationFrame(f); else res((n * 1000) / (performance.now() - t0)); }; requestAnimationFrame(f); }));
  console.log(label.padEnd(40), fps.toFixed(1), 'fps', await page.evaluate(() => document.getElementById('hud').textContent.split('\n')[0]));
};
for (const k of process.argv.slice(2)) { await measure('key ' + k, () => {}); await page.keyboard.press(k); await page.waitForTimeout(500); }
await measure('sun 1', () => {});
await measure('sun 2', () => {});
await measure('sun 3 (no far)', () => { galaxy.state.showFar = false; });
await measure('sun 4 (no far, no bloom)', () => { galaxy.state.bloom = 0; });
await measure('sun 5 (far, bloom, budget 3e6)', () => { galaxy.state.showFar = true; galaxy.state.bloom = 0.55; galaxy.state.budget = 3e6; });
await measure('sun 6 (budget 3e5)', () => { galaxy.state.budget = 3e5; });
await page.keyboard.press('KeyG');
await measure('galaxy 1 (budget 1.5e6)', () => { galaxy.state.budget = 1.5e6; });
await measure('galaxy 2', () => {});
await page.keyboard.press('KeyH');
await measure('top 1', () => {});
await measure('top 2', () => {});
await browser.close();
