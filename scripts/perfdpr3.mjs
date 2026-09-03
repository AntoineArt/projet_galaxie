import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-frame-rate-limit', '--disable-gpu-vsync'], headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
const measure = async (label, setup) => {
  await page.evaluate(setup);
  await page.waitForTimeout(2000);
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res((n * 1000) / (performance.now() - t0)); }; requestAnimationFrame(f); }));
  console.log(label.padEnd(34), fps.toFixed(1), 'fps', await page.evaluate(() => document.getElementById('hud').textContent.split('\n')[0].split('étoiles GPU')[1]));
};
await page.keyboard.press('KeyR');
await measure('warmup', () => {});
await measure('tout', () => {});
await measure('étoiles sans extinction', () => { galaxy.stars.material.uniforms.uDustOn.value = 0; });
await measure('far sans extinction', () => { galaxy.far.starMat.uniforms.uDustOn.value = 0; });
await measure('budget 1e6', () => { galaxy.stars.material.uniforms.uDustOn.value = 1; galaxy.far.starMat.uniforms.uDustOn.value = 1; galaxy.state.budget = 1e6; });
await browser.close();
