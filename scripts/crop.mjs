// node scripts/crop.mjs in.png out.png x y w h scale
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [inp, out, x, y, w, h, sc] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Math.round(w * sc), height: Math.round(h * sc) } });
const b64 = readFileSync(inp).toString('base64');
await page.setContent(`<body style="margin:0;background:#000"><canvas id=c width=${w * sc} height=${h * sc}></canvas><script>const im=new Image();im.onload=()=>{const c=document.getElementById('c').getContext('2d');c.imageSmoothingEnabled=false;c.drawImage(im,${x},${y},${w},${h},0,0,${w * sc},${h * sc});document.title='ok'};im.src='data:image/png;base64,${b64}';</script></body>`);
await page.waitForFunction(() => document.title === 'ok');
await page.screenshot({ path: out });
await browser.close();
