import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'], headless: true });
const page = await browser.newPage();
await page.goto('about:blank');
console.log(await page.evaluate(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e.UNMASKED_RENDERER_WEBGL) + ' | ' + gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE); }));
await browser.close();
