// chụp cả giao diện: node tools/uishot.mjs W H out.png [builder]
import { createRequire } from 'module';
import { serve } from './shot.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [W, H, out, builder] = [+process.argv[2], +process.argv[3], process.argv[4], process.argv[5]];
const { srv, url } = await serve();
const br = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await br.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
await page.addInitScript(() => { try { localStorage.setItem('phieu-ongkhidong-guide-v1', '1'); } catch (e) {} });
await page.goto(url + '?q=0'); await page.waitForTimeout(4000);
if (builder) { await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /xây|lắp|builder/i.test(x.textContent)); b && b.click(); }); await page.waitForTimeout(1500); }
await page.screenshot({ path: out });
console.log(await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, school: [document.querySelector('.school').scrollWidth, document.querySelector('.school').clientWidth, document.querySelector('.school').getBoundingClientRect().height], title: document.querySelector('.plate__title').getBoundingClientRect().height })));
await br.close(); srv.close();
