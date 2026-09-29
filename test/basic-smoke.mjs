import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '..', 'index.html'), 'utf8');
const checks = [
  ['single-file HTML', !/<script[^>]+src=|<link[^>]+href=/.test(html)],
  ['native demo outline', html.includes('TextwMindmap')],
  ['Locate selected control', html.includes('Locate selected')],
  ['world-grid background', html.includes('dots')],
];
for (const [name, ok] of checks) { if (!ok) throw Error(`failed: ${name}`); console.log(`ok: ${name}`); }
console.log('basic smoke passed');
