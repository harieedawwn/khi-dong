// Đóng gói: src/main.js -> dist/app.js (một script IIFE cổ điển), dist/index.html (CSS và phông nhúng base64).
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true, format: 'iife', platform: 'browser', target: ['es2019', 'safari14', 'chrome90'],
  minify: true, legalComments: 'none', outfile: path.join(dist, 'app.js'),
});

const mime = { '.woff2': ['font/woff2', 'woff2'], '.woff': ['font/woff', 'woff'] };
let css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
css = css.replace(/url\(["']?fonts\/([^"')]+)["']?\)(\s*format\(["'][a-z0-9]+["']\))?/g, (m, f) => {
  const ext = path.extname(f), b64 = fs.readFileSync(path.join(root, 'src/fonts', f)).toString('base64');
  return `url("data:${mime[ext][0]};base64,${b64}") format("${mime[ext][1]}")`;
});
if (/url\(["']?fonts\//.test(css)) throw new Error('còn phông chưa nhúng');

const stamp = Date.now().toString(36);
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const link = /<link rel="stylesheet" href="src\/styles\.css[^"]*">/;
if (!link.test(html)) throw new Error('index.html không có thẻ link styles.css');
html = html.replace(link, () => `<style>\n${css}\n</style>`);
html = html.replace(/<script src="app\.js[^"]*" defer><\/script>/, `<script src="app.js?v=${stamp}" defer></script>`);
fs.writeFileSync(path.join(dist, 'index.html'), html);
console.log('dist/ xong: app.js', (fs.statSync(path.join(dist, 'app.js')).size / 1024).toFixed(0), 'KB; index.html', (fs.statSync(path.join(dist, 'index.html')).size / 1024).toFixed(0), 'KB');
