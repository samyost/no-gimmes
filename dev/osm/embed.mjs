// Embed a course's built hole maps into index.html as a HOLEMAPS.<key> line.
// Replaces the existing line for that course, or inserts after the HOLEMAPS
// declaration. Idempotent — rerun after rebuilding maps.
//   node dev/osm/embed.mjs <key>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const key = process.argv[2];
if (!key){ console.error('usage: node embed.mjs <course-key>'); process.exit(1); }
const maps = JSON.parse(readFileSync(join(here, key + '.maps.json'), 'utf8'));
const byHole = {};
for (const m of maps) byHole[m.hole] = { vb: m.vb, g: m.g };
const line = `HOLEMAPS.${key} = ${JSON.stringify(byHole)};`;

const idx = join(here, '..', '..', 'index.html');
let html = readFileSync(idx, 'utf8');
const re = new RegExp(`^HOLEMAPS\\.${key} = .*;$`, 'm');
if (re.test(html)) html = html.replace(re, line);
else html = html.replace(/^const HOLEMAPS = \{\};$/m, `const HOLEMAPS = {};\n${line}`);
writeFileSync(idx, html);
console.log(`embedded HOLEMAPS.${key}: ${maps.length} holes, ${(line.length/1024).toFixed(1)} KB`);
