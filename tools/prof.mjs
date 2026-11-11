// tools/prof.mjs — perfil CPU của luồng chính trong N giây (CDP Profiler); in các hàm tốn nhiều thời gian riêng nhất.
//   node tools/prof.mjs [--secs 8] [--q 12] [--model id]
import { open, setup } from './shot.mjs';
const A = {}; const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); A[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
const s = await open({ tier: A.tier || 'low', W: 1000, H: 640, q: A.q ? '&q=' + A.q : '' });
if (A.model) await setup(s.page, { model: A.model, U: A.U });
await s.page.waitForTimeout(+(A.warm || 6000));
const cdp = await s.page.context().newCDPSession(s.page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
await s.page.waitForTimeout(+(A.secs || 8) * 1000);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map(), byId = new Map(); for (const n of profile.nodes) byId.set(n.id, n);
const dts = profile.timeDeltas; let total = 0;
profile.samples.forEach((id, i) => { const n = byId.get(id), f = n.callFrame, k = (f.functionName || '(anon)') + ' ' + f.url.split('/').pop() + ':' + f.lineNumber; self.set(k, (self.get(k) || 0) + dts[i]); total += dts[i]; });
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, +(A.top || 14));
console.log('total ms', Math.round(total / 1000)); for (const [k, v] of top) console.log((v / 1000).toFixed(0).padStart(6), k);
await s.close();
