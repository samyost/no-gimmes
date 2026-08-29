// Turn raw Overpass output (dev/osm/<key>.json) into compact per-hole SVG
// path data ready to embed in index.html.
//   node dev/osm/build-maps.mjs <key> [holes]
// Emits dev/osm/<key>.maps.json:
//   [ {hole, vb:[w,h], yds, g:[[kind, "M…Z"], …]} × 18 ]
// kinds: f fairway · g green · t tee · b bunker · w water · r rough · c centerline
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const key = process.argv[2];
if (!key){ console.error('usage: node build-maps.mjs <course-key>'); process.exit(1); }
const raw = JSON.parse(readFileSync(join(here, key + '.json'), 'utf8'));

const KINDS = { fairway:'f', green:'g', tee:'t', bunker:'b', water_hazard:'w', lateral_water_hazard:'w', rough:'r' };
const CORRIDOR = 70;   // m either side of the centerline that belongs to a hole
const SIMPLIFY = 2.5;  // m Douglas-Peucker tolerance
const W = 360;         // output viewBox width (long axis of the hole)

// ---- geometry helpers (local equirectangular metres) ------------------------
const R = 6371000, D = Math.PI / 180;
function projector(lat0){
  const kx = Math.cos(lat0 * D) * R * D, ky = R * D;
  return p => [p.lon * kx, p.lat * ky];
}
const d2 = (a, b) => (a[0]-b[0])**2 + (a[1]-b[1])**2;
function segDist2(p, a, b){
  const l2 = d2(a, b); if (!l2) return d2(p, a);
  let t = ((p[0]-a[0])*(b[0]-a[0]) + (p[1]-a[1])*(b[1]-a[1])) / l2;
  t = Math.max(0, Math.min(1, t));
  return d2(p, [a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])]);
}
const lineDist2 = (p, line) => {
  let m = Infinity;
  for (let i = 0; i < line.length - 1; i++) m = Math.min(m, segDist2(p, line[i], line[i+1]));
  return m;
};
function simplify(pts, tol){
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length-1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length){
    const [i0, i1] = stack.pop();
    let mi = -1, md = tol * tol;
    for (let i = i0 + 1; i < i1; i++){
      const dd = segDist2(pts[i], pts[i0], pts[i1]);
      if (dd > md){ md = dd; mi = i; }
    }
    if (mi > 0){ keep[mi] = 1; stack.push([i0, mi], [mi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---- collect features -------------------------------------------------------
// rings: assemble relation outer members by stitching shared endpoints
function rings(members){
  const outers = members.filter(m => m.role === 'outer' || !m.role).map(m => m.geometry).filter(g => g && g.length > 1);
  const done = [], open = [...outers];
  while (open.length){
    let ring = open.shift().slice();
    let grew = true;
    while (grew && (ring[0].lat !== ring[ring.length-1].lat || ring[0].lon !== ring[ring.length-1].lon)){
      grew = false;
      for (let i = 0; i < open.length; i++){
        const g = open[i], h = ring[ring.length-1];
        if (g[0].lat === h.lat && g[0].lon === h.lon){ ring = ring.concat(g.slice(1)); open.splice(i,1); grew = true; break; }
        const e = g[g.length-1];
        if (e.lat === h.lat && e.lon === h.lon){ ring = ring.concat(g.slice(0,-1).reverse()); open.splice(i,1); grew = true; break; }
      }
    }
    done.push(ring);
  }
  return done;
}

const holes = raw.elements.filter(e => e.tags.golf === 'hole' && e.geometry && e.geometry.length > 1);
const feats = [];
for (const e of raw.elements){
  const kind = KINDS[e.tags.golf] || (e.tags.natural === 'water' ? 'w' : null);
  if (!kind) continue;
  const polys = e.geometry ? [e.geometry] : e.members ? rings(e.members) : [];
  for (const p of polys) if (p.length > 2) feats.push({ kind, pts: p });
}
if (!holes.length){ console.error('no golf=hole centerlines in ' + key + '.json'); process.exit(2); }

const lat0 = holes[0].geometry[0].lat, proj = projector(lat0);
const projFeats = feats.map(f => ({ kind: f.kind, pts: f.pts.map(proj) }));

const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null;
const out = [];
for (const h of holes.sort((a,b) => (+a.tags.ref||0) - (+b.tags.ref||0))){
  const ref = +h.tags.ref;
  if (only && !only.includes(ref)) continue;
  const line = h.geometry.map(proj);
  // rotate so play runs left (tee) to right (green): x along the hole, y across
  const a = line[0], b = line[line.length-1];
  const len = Math.hypot(b[0]-a[0], b[1]-a[1]) || 1;
  const ux = (b[0]-a[0])/len, uy = (b[1]-a[1])/len, nx = -uy, ny = ux;
  const rot = p => { const dx = p[0]-a[0], dy = p[1]-a[1]; return [dx*ux+dy*uy, dx*nx+dy*ny]; };
  // water/rough may hug several holes — any vertex in the corridor keeps them;
  // fairway/green/tee/bunker belong to one hole — ask for the centroid, or
  // most of the polygon, to sit inside the corridor to kill neighbor bleed
  const near = projFeats.filter(f => {
    const inC = f.pts.filter(p => lineDist2(p, line) < CORRIDOR*CORRIDOR).length;
    if (!inC) return false;
    if (f.kind === 'w' || f.kind === 'r') return true;
    const cx = f.pts.reduce((a,p)=>a+p[0],0)/f.pts.length, cy = f.pts.reduce((a,p)=>a+p[1],0)/f.pts.length;
    return lineDist2([cx,cy], line) < (CORRIDOR-5)*(CORRIDOR-5) || inC / f.pts.length >= 0.4;
  });
  const shapes = [];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const clip = [];
  for (const f of near){
    const pts = simplify(f.pts.map(rot), SIMPLIFY);
    if (pts.length < 3) continue;
    clip.push({ kind: f.kind, pts });
    if (f.kind !== 'w' && f.kind !== 'r') // water/rough can be huge; don't let them drive the frame
      for (const p of pts){ minx=Math.min(minx,p[0]); maxx=Math.max(maxx,p[0]); miny=Math.min(miny,p[1]); maxy=Math.max(maxy,p[1]); }
  }
  const cl = simplify(line.map(rot), SIMPLIFY);
  for (const p of cl){ minx=Math.min(minx,p[0]); maxx=Math.max(maxx,p[0]); miny=Math.min(miny,p[1]); maxy=Math.max(maxy,p[1]); }
  // the frame follows the centerline's corridor; a neighbor polygon with one
  // vertex inside it must not drag the frame out — overflow clips at the edge
  let cminx=Infinity, cminy=Infinity, cmaxx=-Infinity, cmaxy=-Infinity;
  for (const p of cl){ cminx=Math.min(cminx,p[0]); cmaxx=Math.max(cmaxx,p[0]); cminy=Math.min(cminy,p[1]); cmaxy=Math.max(cmaxy,p[1]); }
  const cross = Math.min(55, Math.max(30, len * 0.3)); // short par 3s stay tight
  minx = Math.max(minx, cminx - 45); maxx = Math.min(maxx, cmaxx + 45);
  miny = Math.max(miny, cminy - cross); maxy = Math.min(maxy, cmaxy + cross);
  const pad = 12;
  minx -= pad; miny -= pad; maxx += pad; maxy += pad;
  const s = W / (maxx - minx), Hgt = Math.round((maxy - miny) * s * 10) / 10;
  const tx = p => [ +( (p[0]-minx)*s ).toFixed(1), +( (p[1]-miny)*s ).toFixed(1) ];
  const path = (pts, close) => 'M' + pts.map(tx).map(p => p.join(' ')).join('L') + (close ? 'Z' : '');
  const order = { w:0, r:1, f:2, t:3, b:4, g:5 };
  clip.sort((x,y) => (order[x.kind]??9) - (order[y.kind]??9));
  for (const c of clip) shapes.push([c.kind, path(c.pts, true)]);
  shapes.push(['c', path(cl, false)]);
  const yds = Math.round(Math.hypot(b[0]-a[0], b[1]-a[1]) / 0.9144);
  out.push({ hole: ref, vb: [W, Hgt], yds, g: shapes });
}
writeFileSync(join(here, key + '.maps.json'), JSON.stringify(out));
const bytes = JSON.stringify(out).length;
console.log(key, out.length + ' holes,', (bytes/1024).toFixed(1) + ' KB total,',
  out.map(o => o.hole + ':' + o.g.length + 'shp').join(' '));
