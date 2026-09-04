// Breckenridge has 27 holes; OSM only carries golf=hole centerlines for two of
// the three nines (refs 1-9 = Beaver, 10-18 = Bear — measured against the
// printed cards they match hole for hole, apart from a few OSM traced from a
// forward tee). The Elk nine was mapped later by someone who traced greens,
// tees, fairways and bunkers but never drew the hole lines, so this script
// reconstructs them:
//   1. every green/tee/fairway well clear of a Beaver/Bear centerline is an
//      Elk feature (that leaves exactly 9 orphan greens), minus the practice
//      ground — the one tee inside the driving range is 8x the size of any
//      real tee box and would otherwise be picked as a back tee;
//   2. the tee boxes are grouped into per-hole complexes, and a search assigns
//      a green and a complex to each of Elk 1-9 — no two holes may share
//      either — scoring straight-line tee-to-green against the printed Elk
//      card, the walk from the previous green, and starting and finishing at
//      the clubhouse (the winner averages 13.8 yd off the card, where the
//      runner-up averages 25.9 and needs a 311 yd walk between two holes);
//   3. the centerline is threaded through the hole's fairway so doglegs bend
//      the right way instead of cutting the corner.
// Emits dev/osm/breck.elk.json — read back by build-maps.mjs. Rerun after a
// fresh fetch; it prints the card-vs-built table so drift is obvious.
//   node dev/osm/derive-elk.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, 'breck.json'), 'utf8'));

// Elk from the printed card (Gold tees): yards then par.
const CARD = [386, 576, 203, 441, 239, 283, 436, 572, 420];
const PAR  = [4, 5, 3, 4, 3, 4, 4, 5, 4];
const ORPHAN = 60;     // m from a Beaver/Bear centerline before a feature is Elk's
const ORPHAN_TEE = 50; // tees crowd the previous hole's green, so they run closer
const COMPLEX = 70;    // m between tee boxes of the same hole
const MAX_WALK = 320;  // yd green -> next tee; anything longer is not a routing

const R = 6371000, D = Math.PI / 180;
const holeWays = raw.elements.filter(e => e.tags.golf === 'hole' && e.geometry && e.geometry.length > 1)
  .sort((a, b) => (+a.tags.ref || 0) - (+b.tags.ref || 0));
if (holeWays.length !== 18) throw new Error(`expected 18 Beaver/Bear centerlines, got ${holeWays.length}`);
const lat0 = holeWays[0].geometry[0].lat;
const kx = Math.cos(lat0 * D) * R * D, ky = R * D;
const proj = p => [p.lon * kx, p.lat * ky];
const unproj = q => ({ lat: +(q[1] / ky).toFixed(6), lon: +(q[0] / kx).toFixed(6) });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const yd = m => m / 0.9144;
const centroid = q => [q.reduce((a, p) => a + p[0], 0) / q.length, q.reduce((a, p) => a + p[1], 0) / q.length];

function segDist(p, a, b){
  const l2 = dist(a, b) ** 2;
  if (!l2) return dist(p, a);
  let t = ((p[0]-a[0])*(b[0]-a[0]) + (p[1]-a[1])*(b[1]-a[1])) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + t*(b[0]-a[0]), a[1] + t*(b[1]-a[1])]);
}
const lineDist = (p, L) => { let m = Infinity; for (let i = 0; i < L.length-1; i++) m = Math.min(m, segDist(p, L[i], L[i+1])); return m; };
function ringsOf(e){
  if (e.geometry) return [e.geometry];
  if (e.members) return e.members.filter(m => m.role === 'outer' || !m.role).map(m => m.geometry).filter(g => g && g.length > 2);
  return [];
}
function inRing(p, ring){
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj-xi) * (p[1]-yi) / (yj-yi) + xi) hit = !hit;
  }
  return hit;
}

const known = holeWays.map(h => h.geometry.map(proj));
const range = raw.elements.filter(e => e.tags.golf === 'driving_range').flatMap(ringsOf).map(r => r.map(proj));
function orphans(kind, thr){
  const out = [];
  for (const e of raw.elements){
    if (e.tags.golf !== kind) continue;
    for (const r of ringsOf(e)){
      if (r.length < 3) continue;
      const q = r.map(proj), c = centroid(q);
      if (Math.min(...known.map(L => lineDist(c, L))) <= thr) continue;
      if (range.some(ring => inRing(c, ring))) continue;   // practice ground, not a hole
      out.push({ id: e.id, c, q });
    }
  }
  return out;
}
const greens = orphans('green', ORPHAN), tees = orphans('tee', ORPHAN_TEE), fairways = orphans('fairway', ORPHAN);
if (greens.length !== 9) throw new Error(`expected 9 Elk greens, found ${greens.length} — OSM data changed, re-check the split`);

// a hole's tee boxes sit in a line a few metres apart; group them so two holes
// can't be handed boxes out of the same complex
const complexes = [];
for (const t of tees){
  const hit = complexes.filter(g => g.some(x => dist(x.c, t.c) < COMPLEX));
  if (!hit.length){ complexes.push([t]); continue; }
  const keep = hit[0];
  for (const other of hit.slice(1)){ keep.push(...other); complexes.splice(complexes.indexOf(other), 1); }
  keep.push(t);
}
complexes.forEach((g, i) => g.forEach(t => { t.cx = i; }));
if (complexes.length < 9) throw new Error(`only ${complexes.length} Elk tee complexes for 9 holes`);

// the clubhouse: Beaver 1 and Bear 1 both start there, so does Elk 1
const clubhouse = centroid([proj(holeWays[0].geometry[0]), proj(holeWays[9].geometry[0])]);

// ---- assign a green and a tee complex to each of Elk 1-9 --------------------
// cost = card error (playing longer than the card is far more suspect than a
// dogleg measuring short) + the walk in from the previous green, with the ends
// pulled toward the clubhouse. Exhaustive DFS; greens and complexes are each
// used at most once, which keeps the search small.
const OVER = 3, W_WALK = 0.55, W_ENDS = 0.35;
const cand = greens.map(g => CARD.map(card => {
  const best = new Map();   // one box per complex: whichever fits this card
  for (const t of tees){
    const d = yd(dist(t.c, g.c));
    if (d > card * 1.06 || d < card * 0.70) continue;
    const err = Math.max(0, card - d) + Math.max(0, d - card) * OVER;
    if (!best.has(t.cx) || err < best.get(t.cx).err) best.set(t.cx, { t, d, err });
  }
  return [...best.values()].sort((a, b) => a.err - b.err);
}));

const routes = new Map();   // green sequence -> cheapest route with that sequence
const pick = [];
(function dfs(i, gMask, cMask, cost, last){
  if (i === 9){
    const total = cost + yd(dist(greens[last].c, clubhouse)) * W_ENDS;
    const key = pick.map(p => p.g).join('>');
    if (!routes.has(key) || total < routes.get(key).cost)
      routes.set(key, { cost: total, path: pick.map(p => ({ ...p })) });
    return;
  }
  for (let g = 0; g < 9; g++){
    if (gMask & (1 << g)) continue;
    for (const c of cand[g][i]){
      if (cMask & (1 << c.t.cx)) continue;
      const walk = i ? yd(dist(greens[last].c, c.t.c)) : yd(dist(clubhouse, c.t.c));
      if (walk > MAX_WALK) continue;
      pick.push({ g, c, walk });
      dfs(i + 1, gMask | (1 << g), cMask | (1 << c.t.cx), cost + c.err + walk * W_WALK, g);
      pick.pop();
    }
  }
})(0, 0, 0, 0, -1);
const ranked = [...routes.values()].sort((a, b) => a.cost - b.cost);
if (!ranked.length) throw new Error('no Elk routing satisfies the card — OSM data changed');
const [best, runnerUp] = ranked;

// ---- thread each centerline through its fairway -----------------------------
// bucket the hole's fairway vertices along the tee->green axis and follow the
// middle of each bucket, so a dogleg bends instead of cutting the corner
function centerline(tee, green){
  const len = dist(tee, green);
  const ux = (green[0]-tee[0])/len, uy = (green[1]-tee[1])/len, nx = -uy, ny = ux;
  const along = p => (p[0]-tee[0])*ux + (p[1]-tee[1])*uy;
  const across = p => (p[0]-tee[0])*nx + (p[1]-tee[1])*ny;
  const mine = fairways.filter(f => {
    const u = along(f.c);
    return u > -40 && u < len + 40 && Math.abs(across(f.c)) < 90;
  });
  const pts = mine.flatMap(f => f.q).filter(p => { const u = along(p); return u > 25 && u < len - 25; });
  const bins = 5, out = [tee];
  for (let i = 0; i < bins; i++){
    const lo = len * (i + 0.5) / (bins + 1), hi = len * (i + 1.5) / (bins + 1);
    const vs = pts.filter(p => along(p) >= lo && along(p) < hi).map(across).sort((a, b) => a - b);
    if (vs.length < 3) continue;
    const mid = vs.length % 2 ? vs[(vs.length-1)/2] : (vs[vs.length/2-1] + vs[vs.length/2]) / 2;
    if (Math.abs(mid) < 8) continue;   // straight enough — don't add noise
    const u = (lo + hi) / 2;
    out.push([tee[0] + ux*u + nx*mid, tee[1] + uy*u + ny*mid]);
  }
  out.push(green);
  return out;
}

const elk = [];
console.log('hole  par  card  built  walk-in   tee way        green way');
for (let i = 0; i < 9; i++){
  const { g, c, walk } = best.path[i];
  elk.push({ ref: i + 1, par: PAR[i], card: CARD[i], green: greens[g].id, tee: c.t.id,
    geometry: centerline(c.t.c, greens[g].c).map(unproj) });
  console.log(String(i+1).padStart(4), String(PAR[i]).padStart(4), String(CARD[i]).padStart(5),
    String(Math.round(c.d)).padStart(6), String(Math.round(walk)).padStart(8), ('   ' + c.t.id).padEnd(15), greens[g].id);
}
// how well a routing fits the printed card is the check that means something;
// the search cost is only how the winner was found
const meanErr = r => r.path.reduce((a, p, i) => a + Math.abs(p.c.d - CARD[i]), 0) / 9;
const err = meanErr(best), worst = Math.max(...best.path.map((p, i) => Math.abs(p.c.d - CARD[i])));
console.log(`\n${routes.size} routings fit. mean card error ${err.toFixed(1)} yd, worst hole ${Math.round(worst)} yd;`
  + ` runner-up ${runnerUp ? meanErr(runnerUp).toFixed(1) + ' yd' : 'none'}. cost ${Math.round(best.cost)}`
  + `${runnerUp ? ' vs ' + Math.round(runnerUp.cost) : ''}.`);
if (worst > 60) console.warn(`WARNING: a hole misses the card by ${Math.round(worst)} yd — verify by hand`);
if (runnerUp && meanErr(runnerUp) < err * 1.5)
  console.warn('WARNING: the runner-up fits the card nearly as well — verify by hand');
writeFileSync(join(here, 'breck.elk.json'), JSON.stringify({
  note: 'Derived by dev/osm/derive-elk.mjs — OSM has no golf=hole ways for Breckenridge\'s Elk nine.',
  cost: Math.round(best.cost), runnerUpCost: runnerUp ? Math.round(runnerUp.cost) : null,
  meanCardError: +err.toFixed(1), worstCardError: Math.round(worst),
  runnerUpMeanCardError: runnerUp ? +meanErr(runnerUp).toFixed(1) : null, holes: elk }, null, 1));
console.log('wrote breck.elk.json');
