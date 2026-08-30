// Breckenridge has 27 holes; OSM only carries golf=hole centerlines for two of
// the three nines (refs 1-9 = Beaver, 10-18 = Bear — both match the printed
// card to within a few yards). The Elk nine was mapped later by someone who
// traced greens, tees, fairways and bunkers but never drew the hole lines, so
// this script reconstructs them:
//   1. every green/tee/fairway further than 60 m from a Beaver/Bear centerline
//      is an Elk feature (that leaves exactly 9 orphan greens);
//   2. a bitmask DP assigns those greens to Elk 1-9 and picks a back tee for
//      each, scoring straight-line tee->green against the printed Elk card,
//      the walk from the previous green, and starting/finishing at the
//      clubhouse (the best route beats the runner-up by better than 2:1);
//   3. the centerline is threaded through the hole's fairway so doglegs bend
//      the right way instead of cutting the corner.
// Emits dev/osm/breck.elk.json — read back by build-maps.mjs. Rerun after a
// fresh fetch; it prints the card-vs-measured table so drift is obvious.
//   node dev/osm/derive-elk.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, 'breck.json'), 'utf8'));

// Elk from the printed card (Gold tees): yards then par.
const CARD = [386, 576, 203, 441, 239, 283, 436, 572, 420];
const PAR  = [4, 5, 3, 4, 3, 4, 4, 5, 4];
const ORPHAN = 60;    // m from a Beaver/Bear centerline before a feature is Elk's
const MAX_WALK = 320; // yd green -> next tee; anything longer is not a routing

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

const known = holeWays.map(h => h.geometry.map(proj));
function orphans(kind){
  const out = [];
  for (const e of raw.elements){
    if (e.tags.golf !== kind) continue;
    for (const r of ringsOf(e)){
      if (r.length < 3) continue;
      const q = r.map(proj), c = centroid(q);
      if (Math.min(...known.map(L => lineDist(c, L))) > ORPHAN) out.push({ id: e.id, c, q });
    }
  }
  return out;
}
const greens = orphans('green'), tees = orphans('tee'), fairways = orphans('fairway');
if (greens.length !== 9) throw new Error(`expected 9 Elk greens, found ${greens.length} — OSM data changed, re-check the split`);

// the clubhouse: Beaver 1 and Bear 1 both start there, so does Elk 1
const clubhouse = centroid([proj(holeWays[0].geometry[0]), proj(holeWays[9].geometry[0])]);

// ---- assign greens to Elk 1-9 and pick each hole's back tee -----------------
// cost = card error (playing longer than the card is far more suspect than a
// dogleg measuring short) + the walk from the previous green, ends weighted
// toward the clubhouse. Full enumeration via mask DP keeping the best K routes.
const OVER = 3, W_WALK = 0.55, W_ENDS = 0.35, K_TEE = 8, BEAM = 6;
const cand = greens.map(g => CARD.map(card => tees
  .map(t => ({ t, d: yd(dist(t.c, g.c)) }))
  .filter(x => x.d <= card * 1.06 && x.d >= card * 0.70)
  .map(x => ({ ...x, err: Math.max(0, card - x.d) + Math.max(0, x.d - card) * OVER }))
  .sort((a, b) => a.err - b.err).slice(0, K_TEE)));

const N = 9, FULL = (1 << N) - 1;
const push = (m, k, cost, path) => {
  const a = m.get(k) || []; a.push({ cost, path });
  a.sort((x, y) => x.cost - y.cost); if (a.length > BEAM) a.length = BEAM; m.set(k, a);
};
let states = new Map();
for (let g = 0; g < N; g++)
  for (const c of cand[g][0]) push(states, (1 << g) * 16 + g, c.err + yd(dist(clubhouse, c.t.c)) * W_ENDS, [{ g, c }]);
for (let step = 1; step < N; step++){
  const next = new Map();
  for (const [k, arr] of states){
    const mask = Math.floor(k / 16), last = k % 16;
    for (const v of arr) for (let g = 0; g < N; g++){
      if (mask & (1 << g)) continue;
      for (const c of cand[g][step]){
        const walk = yd(dist(greens[last].c, c.t.c));
        if (walk > MAX_WALK) continue;
        push(next, (mask | (1 << g)) * 16 + g, v.cost + c.err + walk * W_WALK, v.path.concat([{ g, c }]));
      }
    }
  }
  states = next;
}
const routes = [];
for (const [k, arr] of states){
  if (Math.floor(k / 16) !== FULL) continue;
  for (const v of arr) routes.push({ cost: v.cost + yd(dist(greens[k % 16].c, clubhouse)) * W_ENDS, path: v.path });
}
routes.sort((a, b) => a.cost - b.cost);
if (!routes.length) throw new Error('no Elk routing satisfies the card — OSM data changed');
const best = routes[0];
const runnerUp = routes.find(r => r.path.map(p => p.g).join() !== best.path.map(p => p.g).join());

// ---- thread each centerline through its fairway -----------------------------
// bucket the hole's fairway vertices along the tee->green axis and follow the
// middle of each bucket, so a dogleg bends instead of cutting the corner
function centerline(tee, green){
  const len = dist(tee, green);
  const ux = (green[0]-tee[0])/len, uy = (green[1]-tee[1])/len, nx = -uy, ny = ux;
  const along = p => (p[0]-tee[0])*ux + (p[1]-tee[1])*uy;
  const across = p => (p[0]-tee[0])*nx + (p[1]-tee[1])*ny;
  const mine = fairways.filter(f => {
    const c = f.c, u = along(c);
    return u > -40 && u < len + 40 && Math.abs(across(c)) < 90;
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
for (let i = 0; i < N; i++){
  const { g, c } = best.path[i];
  const green = greens[g].c;
  // measure from the middle of the tee box, the way the card does
  const line = centerline(c.t.c, green);
  const walk = i ? Math.round(yd(dist(greens[best.path[i-1].g].c, c.t.c))) : Math.round(yd(dist(clubhouse, c.t.c)));
  elk.push({ ref: i + 1, par: PAR[i], card: CARD[i], green: greens[g].id, tee: c.t.id,
    geometry: line.map(unproj) });
  console.log(String(i+1).padStart(4), String(PAR[i]).padStart(4), String(CARD[i]).padStart(5),
    String(Math.round(c.d)).padStart(6), String(walk).padStart(8), ('   ' + c.t.id).padEnd(15), greens[g].id);
}
const err = best.path.reduce((a, p, i) => a + Math.abs(p.c.d - CARD[i]), 0) / N;
console.log(`\nroute cost ${Math.round(best.cost)} (runner-up ${runnerUp ? Math.round(runnerUp.cost) : 'none'}), mean card error ${err.toFixed(1)} yd`);
if (runnerUp && runnerUp.cost < best.cost * 1.5)
  console.warn('WARNING: the winning routing is not clearly better than the runner-up — verify by hand');
writeFileSync(join(here, 'breck.elk.json'), JSON.stringify({
  note: 'Derived by dev/osm/derive-elk.mjs — OSM has no golf=hole ways for Breckenridge\'s Elk nine.',
  cost: Math.round(best.cost), runnerUpCost: runnerUp ? Math.round(runnerUp.cost) : null,
  meanCardError: +err.toFixed(1), holes: elk }, null, 1));
console.log('wrote breck.elk.json');
