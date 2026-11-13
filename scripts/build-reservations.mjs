import {build} from 'esbuild';
import {readFile, writeFile, readdir, unlink} from 'node:fs/promises';

// GitHub Pages serves the committed assets directly, without a server build.
const result = await build({
  entryPoints: ['ui/reservations.jsx'],
  outdir: 'assets',
  entryNames: 'reservations-[hash]',
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2022'],
  jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"production"'},
  legalComments: 'linked',
  metafile: true,
});
const files = Object.keys(result.metafile.outputs);
const js = files.find(file => file.endsWith('.js'));
const css = files.find(file => file.endsWith('.css'));
if (!js || !css) throw new Error('Reservation assets were not generated');
const html = await readFile('index.html', 'utf8');
const start = '<!-- reservation-ui-assets -->';
const end = '<!-- /reservation-ui-assets -->';
if (!html.includes(start) || !html.includes(end)) throw new Error('Missing asset markers');
await writeFile('index.html', html.replace(
  /<!-- reservation-ui-assets -->[\s\S]*?<!-- \/reservation-ui-assets -->/,
  `${start}\n<link rel="stylesheet" href="./${css}">\n<script defer src="./${js}"></script>\n${end}`,
));
for (const file of await readdir('assets')) {
  const path = 'assets/' + file;
  if (/^reservations-.*\.(js|css|txt)$/.test(file) && !files.includes(path)) await unlink(path);
}
console.log('Built reservation UI', js, css);
