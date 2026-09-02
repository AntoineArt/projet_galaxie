import { buildPopTable, samplePop, youngPopMean, imfCdf, lumMS } from '../src/galaxy/stellar';
import { COMPONENTS } from '../src/galaxy/params';
const out = new Float32Array(4);
for (const c of COMPONENTS) { const t = buildPopTable(c); for (const tt of [2000, 5000, 8000, 13000, 20000]) { samplePop(t, tt, out); console.log(c.padEnd(6), tt, 'L', out[0].toFixed(3), 'rgb', Array.from(out.subarray(1)).map(v=>v.toFixed(2)).join(',')); } }
const y = youngPopMean(); console.log('young', y.L.toFixed(2), y.rgb.map(v=>v.toFixed(2)).join(','));
console.log('frac >1', (1-imfCdf(1)).toFixed(4), '>8', (1-imfCdf(8)).toExponential(2), '>0.08', (1-imfCdf(0.08)).toFixed(3), 'LMS(1)', lumMS(1));
