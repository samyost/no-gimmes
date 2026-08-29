// Fetch golf-course geometry from OpenStreetMap (Overpass API) for every
// course the app knows. Runs in GitHub Actions (unrestricted egress); results
// land in dev/osm/<key>.json plus a summary.json with per-course counts.
//   node dev/osm/fetch.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const UA = 'no-gimmes-course-maps/1.0 (github.com/samyost/no-gimmes; one-time course geometry fetch)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// re: name regex for the OSM golf_course polygon; center: fallback [lat,lon]
const COURSES = [
  { key:'vail',      re:'Vail Golf',            center:[39.6440,-106.3200] },
  { key:'breck',     re:'Breckenridge Golf',    center:[39.5330,-106.0260] },
  { key:'river',     re:'River Course',         center:[39.6075,-105.9780] },
  { key:'ranch',     re:'Keystone Ranch',       center:[39.5805,-105.9995] },
  { key:'willis',    re:'Willis Case',          center:[39.7840,-105.0490] },
  { key:'citypark',  re:'City Park Golf',       center:[39.7495,-104.9475] },
  { key:'evergreen', re:'Evergreen Golf',       center:[39.6415,-105.3245] },
  { key:'kennedy',   re:'Kennedy Golf',         center:[39.6535,-104.8655] },
  { key:'overland',  re:'Overland Park Golf',   center:[39.6855,-105.0065] },
  { key:'wellshire', re:'Wellshire Golf',       center:[39.6525,-104.9415] },
];

async function q(query, tries = 4){
  const compact = query.replace(/\s+/g, ' ').trim();
  let lastErr = null;
  for (let i = 0; i < tries; i++){
    const url = ENDPOINTS[i % ENDPOINTS.length];
    try {
      const r = await fetch(url, { method:'POST',
        headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'User-Agent': UA, 'Accept': 'application/json' },
        body:'data=' + encodeURIComponent(compact) });
      if (r.status === 429 || r.status === 504){ lastErr = new Error(url + ' ' + r.status); await sleep(15000); continue; }
      if (!r.ok){
        const body = (await r.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
        lastErr = new Error(url + ' ' + r.status + ': ' + body);
        await sleep(8000); continue;
      }
      return await r.json();
    } catch (e){ lastErr = e; await sleep(8000); }
  }
  throw lastErr;
}

const round = n => Math.round(n * 1e6) / 1e6;
function slim(el){
  const out = { type: el.type, id: el.id, tags: el.tags || {} };
  if (el.geometry) out.geometry = el.geometry.map(p => ({ lat: round(p.lat), lon: round(p.lon) }));
  if (el.members) out.members = el.members.map(m => ({
    type: m.type, role: m.role,
    geometry: (m.geometry || []).map(p => ({ lat: round(p.lat), lon: round(p.lon) })) }));
  if (el.bounds) out.bounds = el.bounds;
  if (el.lat != null){ out.lat = round(el.lat); out.lon = round(el.lon); }
  return out;
}

const summary = {};
for (const c of COURSES){
  process.stdout.write(c.key + ': ');
  try {
  // stage 1 — locate the golf_course polygon by name inside Colorado
  let bb = null, courseName = null;
  try {
    const s1 = await q(`[out:json][timeout:90];area["ISO3166-2"="US-CO"]->.co;
      (way["leisure"="golf_course"]["name"~"${c.re}",i](area.co);
       relation["leisure"="golf_course"]["name"~"${c.re}",i](area.co););out bb tags;`);
    const el = (s1.elements || [])[0];
    if (el && el.bounds){
      const p = 0.002, b = el.bounds;
      bb = [b.minlat - p, b.minlon - p, b.maxlat + p, b.maxlon + p];
      courseName = (el.tags || {}).name || null;
    }
  } catch (e){ console.log('stage1 failed (' + e.message + '), using fallback bbox'); }
  if (!bb){
    const [la, lo] = c.center;
    bb = [la - 0.013, lo - 0.017, la + 0.013, lo + 0.017];
  }
  await sleep(3000);
  // stage 2 — everything golf-tagged (plus water) inside that box
  const box = bb.map(round).join(',');
  const s2 = await q(`[out:json][timeout:180];
    (way["golf"](${box});relation["golf"](${box});node["golf"](${box});
     way["natural"="water"](${box});relation["natural"="water"](${box}););out geom;`);
  const els = (s2.elements || []).map(slim);
  writeFileSync(join(here, c.key + '.json'),
    JSON.stringify({ course: courseName, bbox: bb.map(round), elements: els }));
  const counts = {};
  for (const el of els){
    const t = el.tags.golf || (el.tags.natural === 'water' ? 'water' : 'other');
    counts[t] = (counts[t] || 0) + 1;
  }
  const holeRefs = els.filter(e => e.tags.golf === 'hole' && e.tags.ref).map(e => e.tags.ref);
  summary[c.key] = { course: courseName, counts, holeRefs: holeRefs.sort((a, b) => a - b) };
  console.log(JSON.stringify(summary[c.key]));
  } catch (e){
    summary[c.key] = { error: String(e.message || e) };
    console.log('FAILED: ' + (e.message || e));
  }
  await sleep(4000);
}
mkdirSync(here, { recursive: true });
writeFileSync(join(here, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('done');
