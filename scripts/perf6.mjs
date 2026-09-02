import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-frame-rate-limit', '--disable-gpu-vsync'], headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 });
const measure = async (label, setup) => {
  await page.evaluate(setup);
  await page.waitForTimeout(1200);
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2500) requestAnimationFrame(f); else res((n * 1000) / (performance.now() - t0)); }; requestAnimationFrame(f); }));
  console.log(label.padEnd(40), fps.toFixed(1), 'fps');
};
await measure('warmup', () => {});
await measure('all', () => {});
await measure('far points hidden', () => { galaxy.far.starMat.visible = false; });
await measure('far + glow hidden', () => { galaxy.glow.material.visible = false; });
await measure('far + glow + dust hidden', () => { galaxy.far.dustMat.visible = false; });
await measure('far shown, no extinction', () => { galaxy.far.starMat.visible = true; galaxy.far.starMat.uniforms.uDustOn.value = 0; });
await browser.close();
