// Feature tests: lo-fi hole maps (traced from OSM), golfer selection and
// stroke traces (tap-per-stroke, tally, tap-the-flag, posted-vs-mapped),
// historical hole notes, and plays-like yardage.
//   node dev/maps.test.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const DBP = 8811, WEBP = 8812;
const DB = `http://127.0.0.1:${DBP}`;
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond){ pass++; console.log('  ok', name); } else { fail++; console.error('  FAIL', name); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000, step = 120){
  const t0 = Date.now();
  while (Date.now() - t0 < ms){ try { if (await fn()) return true; } catch(e){} await sleep(step); }
  return false;
}

function seed(){
  const players = {}, usualTeams = {};
  const names = ['Duck','Tank','Sly','Moose'];
  names.forEach((n,i)=>{ players['p'+(i+1)] = { name:n, emoji:['🦅','🐻','🦊','🫎'][i], hcp:[4,12,8,18][i], ord:i };
    usualTeams['p'+(i+1)] = i%2===0 ? 'red' : 'blue'; });
  return {
    config: { tripName:'T', teamNames:{red:'RED',blue:'BLUE'}, holder:null, tieRule:'chip', gimme:'conc',
      net:false, allowances:{fourball:90}, flat100:false, strokeCap:0, junk:false, junkTypes:{}, skins:false, skinsNet:true, skinsCarry:true },
    players, usualTeams,
    days: {
      fri: { course:'willis', tee:'Bronze', format:'fourball', points:1, times:{a:'06:00'}, teamOf:{} },
      sat: { course:'vail',   tee:'Black',  format:'fourball', points:1, times:{a:'06:00'}, teamOf:{} },
      sun: { course:'breck',  rot:'be',     format:'fourball', points:1, times:{a:'06:00'}, teamOf:{} },
      mon: { course:'ranch',  tee:'Gold',   format:'fourball', points:1, times:{a:'06:00'}, teamOf:{} },
    },
    matches: {
      m1: { day:'sat', group:'a', ord:0, red:['p1','p3'], blue:['p2','p4'], holes:{} },
      m2: { day:'fri', group:'a', ord:0, red:['p1','p3'], blue:['p2','p4'], holes:{} },
      m3: { day:'sun', group:'a', ord:0, red:['p1','p3'], blue:['p2','p4'], holes:{} },
      m4: { day:'mon', group:'a', ord:0, red:['p1','p3'], blue:['p2','p4'], holes:{} },
    },
    junk: {},
  };
}

const mock = spawn('node', [join(here,'mock-rtdb.js'), String(DBP)], { stdio:'ignore' });
const web = createServer((req,res)=>{ res.writeHead(200, {'Content-Type':'text/html'}); res.end(html); });
await new Promise(r => web.listen(WEBP, r));
await sleep(500);

const FAKE_NOW = new Date('2026-09-05T15:00:00').getTime(); // Saturday
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{ width:390, height:844 } });
await ctx.addInitScript(`{
  const OD = Date; const fixed = ${FAKE_NOW}; const start = OD.now();
  class FD extends OD { constructor(...a){ if (a.length===0) super(fixed + (OD.now()-start)); else super(...a); }
    static now(){ return fixed + (OD.now()-start); } }
  window.Date = FD;
}`);
const p = await ctx.newPage();
await p.route(/fonts\.g(oogleapis|static)\.com/, r=>r.abort());
p.on('pageerror', e => console.error('  [pageerror]', e.message));

try {
  await fetch(`${DB}/t/no-gimmes-2026.json`, { method:'PUT', body: JSON.stringify(seed()) });
  await p.goto(`http://127.0.0.1:${WEBP}/?db=${encodeURIComponent(DB)}`);
  await until(()=>p.locator('.whocard').count().then(n=>n===4));
  await p.locator('.whocard').first().click(); // Duck (p1, red)
  ok('lands on the match', await until(()=>p.evaluate(()=>location.hash.includes('#/match/m1'))));

  // --- hole map renders ---
  ok('hole map renders on hole 1', await until(()=>p.locator('.hmap svg').count().then(n=>n===1)));
  ok('map has fairway + green + centerline', await p.evaluate(()=>{
    const s = document.querySelector('.hmap svg');
    return !!(s.querySelector('.mf') && s.querySelector('.mg') && s.querySelector('.mc'));
  }));
  ok('tap hint shows for a player', await p.locator('.mhint').count().then(n=>n===1));

  // --- plays-like yardage (Vail Black tees have per-hole yards) ---
  ok('plays-like shows on the yardage line', await p.locator('.hctx .h1').textContent().then(t=>/plays ~/.test(t)));

  // --- golfer selection: the phone's owner is selected by default ---
  ok('golfer chips render for all four', await p.locator('.gchips .gchip').count().then(n=>n===4));
  ok('I am selected by default', await p.locator('.gchip.sel').textContent().then(t=>/Duck/.test(t)));
  ok('tally bar offers +1 / penalty', await p.evaluate(()=>
    ['tally','pen'].every(a=>document.querySelector(`.tracebar [data-act="${a}"]`))));
  ok('IN lives on the map beside the flag, not in the tally bar', await p.evaluate(()=>
    !!document.querySelector('.hmap svg .inbtn[data-act="holed"]') && !document.querySelector('.tracebar [data-act="holed"]')));

  // --- forward: each map tap is a stroke where the ball finished ---
  await p.locator('.hmap svg').click({ position:{ x:120, y:30 } });
  ok('tap adds a numbered stroke', await until(()=>p.locator('.hmap .bmark.sel').count().then(n=>n===1)));
  ok('stroke is team red', await p.locator('.hmap .bmark.sel.r').count().then(n=>n===1));
  await p.locator('.hmap svg').click({ position:{ x:200, y:40 } });
  await p.locator('.hmap svg').click({ position:{ x:300, y:44 } });
  ok('three taps → three strokes, joined', await until(async()=>
    (await p.locator('.hmap .bmark.sel').count())===3 && (await p.locator('.hmap .tr').count())===1));
  ok('readout counts', await p.locator('.tracebar .ro').textContent().then(t=>/3 SO FAR/.test(t)));
  ok('trace synced to the db beside the score', await until(async()=>{
    const r = await fetch(`${DB}/t/no-gimmes-2026/matches/m1/holes/1/trace/p1.json`).then(x=>x.json());
    return Array.isArray(r) && r.length===3 && typeof r[0].x==='number';
  }));
  // an in-progress trace is not a score
  await p.locator('.drawerh').click();
  ok('half-mapped hole shows progress, not a score', await until(()=>p.locator('.srowsub').first().textContent().then(t=>/3 on the map so far/.test(t))));
  ok('no quick number lit yet', await p.locator('.srow').first().locator('.qn.set').count().then(n=>n===0));
  await p.locator('.drawerh').click();

  // --- +1 (unplaced) and penalty add to the count without a dot ---
  await p.locator('[data-act="tally"]').click();
  await p.locator('[data-act="pen"]').click();
  ok('unplaced + penalty counted, not drawn', await until(async()=>
    /5 SO FAR/.test(await p.locator('.tracebar .ro').textContent()) && (await p.locator('.hmap .bmark.sel').count())===3));
  ok('readout explains the unplaced strokes', await p.locator('.tracebar .ro').textContent().then(t=>/1 unplaced/.test(t) && /1 penalty/.test(t)));

  // --- undo peels the latest stroke ---
  await p.locator('[data-act="traceundo"]').click();
  await p.locator('[data-act="traceundo"]').click();
  ok('undo twice → back to 3', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/3 SO FAR/.test(t))));

  // --- in the hole completes the trace; the count becomes the gross ---
  await p.locator('[data-act="holed"]').click();
  ok('holed out', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/HOLED IN 4/.test(t))));
  ok('holing stroke drawn at the flag', await p.locator('.hmap .bmark.hole').count().then(n=>n===1));
  ok('map no longer takes taps', await p.locator('.hmap svg[data-maptap]').count().then(n=>n===0));
  await p.locator('.drawerh').click();
  ok('drawer shows the mapped 4 as set', await until(()=>p.locator('.srow').first().locator('.qn.set').textContent().then(t=>t.trim()==='4')));
  ok('…and says it came from the map', await p.locator('.srowsub').first().textContent().then(t=>/mapped/.test(t)));
  ok('rail marks the hole as having strokes', await p.locator('#cell1 .sg').count().then(n=>n===1));

  // --- a hand-posted score wins, and the trace stays intact ---
  await p.locator('.srow').first().locator('.qn:not(.step)', { hasText:'6' }).click();
  ok('posted 6 lights instead of mapped 4', await until(()=>p.locator('.srow').first().locator('.qn.set').textContent().then(t=>t.trim()==='6')));
  ok('offers the map count back', await p.locator('[data-act="usemap"]').textContent().then(t=>/use 4/.test(t)));
  const traceAfter = await fetch(`${DB}/t/no-gimmes-2026/matches/m1/holes/1/trace/p1.json`).then(x=>x.json());
  ok('trace untouched by the posted score', Array.isArray(traceAfter) && traceAfter.length===4);
  ok('ledger footnotes the disagreement', await p.locator('.ledger').textContent().then(t=>/posted 6, mapped 4/.test(t)));
  await p.locator('[data-act="usemap"]').click();
  ok('use-map clears the posted score', await until(()=>p.locator('.srow').first().locator('.qn.set').textContent().then(t=>t.trim()==='4')));

  // --- score for a partner: pick them in the drawer, tap the map ---
  await p.locator('.srow').nth(1).locator('.who').click(); // Sly
  ok('drawer row picks the golfer', await until(()=>p.locator('.srow.sel .who').textContent().then(t=>/Sly/.test(t))));
  await p.locator('.drawerh').click();
  ok('map chip agrees', await p.locator('.gchip.sel').textContent().then(t=>/Sly/.test(t)));
  ok('hint names them', await p.locator('.mhint').textContent().then(t=>/Sly/.test(t)));
  ok('my finished trace fades to a last dot', await p.locator('.hmap .bmark.dim').count().then(n=>n===1));

  // --- the flag is a putting target: a tap on it is a putt that stayed out
  //     (snapped to the pin); the IN button beside it is the holing stroke ---
  ok('no reverse-build mode anywhere', await p.evaluate(()=>!document.querySelector('[data-act="teeshot"]')));
  ok('pin ring drawn while the map takes taps', await p.locator('.hmap .pinring').count().then(n=>n===1));
  await p.locator('.hmap svg').click({ position:{ x:150, y:40 } });
  await p.locator('.hmap svg').click({ position:{ x:300, y:44 } });
  const pin = await p.evaluate(()=>{ const s = document.querySelector('.hmap svg[data-maptap]'); const r = s.getBoundingClientRect();
    return { x: (+s.dataset.fx) / (+s.dataset.w) * r.width, y: (+s.dataset.fy) / (+s.dataset.h) * r.height, fx:+s.dataset.fx, fy:+s.dataset.fy, w:+s.dataset.w, h:+s.dataset.h }; });
  await p.locator('.hmap svg').click({ position:{ x: pin.x + 3, y: pin.y - 3 } });
  ok('tapping the flag is a putt, not a hole-out: 3 so far', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/3 SO FAR/.test(t))));
  ok('the putt snaps to the pin', await until(async()=>{
    const r = await fetch(`${DB}/t/no-gimmes-2026/matches/m1/holes/1/trace/p3.json`).then(x=>x.json());
    return Array.isArray(r) && r.length===3 && Math.abs(r[2].x*pin.w - pin.fx) < 0.5 && Math.abs(r[2].y*pin.h - pin.fy) < 0.5;
  }));
  ok('hint stays one short line', await p.locator('.mhint').textContent().then(t=>/IN when it drops/.test(t)));
  await p.locator('.hmap .inbtn').click();
  ok('IN beside the flag holes out: holed in 4', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/HOLED IN 4/.test(t))));
  ok('holing stroke sits at the flag, numbered from the tee', await p.evaluate(()=>{
    const marks = document.querySelectorAll('.hmap .bmark.sel text');
    return document.querySelectorAll('.hmap .bmark.hole').length===1 && marks[0].textContent==='1';
  }));
  ok('IN button gone once holed', await p.locator('.hmap .inbtn').count().then(n=>n===0));
  ok('trace stored tee to pin', await until(async()=>{
    const r = await fetch(`${DB}/t/no-gimmes-2026/matches/m1/holes/1/trace/p3.json`).then(x=>x.json());
    return Array.isArray(r) && r.length===4 && r[3].h && r[0].x < r[1].x && !r.some(s=>s.r||s.t);
  }));

  // --- an ace: IN THE HOLE with nothing before it, with a second look ---
  await p.locator('.gchips .gchip').nth(2).click(); // Tank
  await p.locator('[data-act="holed"]').click();
  ok('hole-in-one is a legitimate 1', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/HOLED IN 1/.test(t))));
  ok('…and asks for a second look', await until(()=>p.locator('#snack').textContent().then(t=>/Hole-in-one/.test(t) && /UNDO/.test(t))));
  await p.locator('[data-act="snackbtn"]').click();
  ok('undo takes the ace back', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/NO STROKES YET/.test(t))));
  await p.locator('.gchips .gchip').nth(1).click(); // back to Sly
  await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/HOLED IN 4/.test(t)));

  // --- clear, with undo ---
  await p.locator('[data-act="traceclear"]').click();
  ok('clear empties the trace', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/NO STROKES YET/.test(t))));
  await p.locator('[data-act="snackbtn"]').click();
  ok('undo brings it back', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/HOLED IN 4/.test(t))));

  // --- selection resets each hole ---
  await p.locator('#cell2').click();
  ok('next hole: back to me', await until(()=>p.locator('.gchip.sel').textContent().then(t=>/Duck/.test(t))));
  await p.locator('#cell1').click();
  await until(()=>p.locator('.gchip.sel').count().then(n=>n===1));

  // --- a legacy single ball mark still renders ---
  await fetch(`${DB}/t/no-gimmes-2026/days/sat/balls/7/p2.json`, { method:'PUT', body: JSON.stringify({ x:0.5, y:0.5 }) });

  // --- another hole has a map too ---
  await p.locator('#cell7').click();
  ok('hole 7 renders its own map', await until(()=>p.locator('.hmap svg').count().then(n=>n===1)));

  // --- hole notes ---
  await p.locator('.hnotebtn').click();
  await p.locator('.hnote input').fill('lay back off the tee, creek crosses');
  await p.locator('.hnote input').blur();
  ok('note saved and rendered', await until(()=>p.locator('.hnote span').textContent().then(t=>/creek crosses/.test(t)).catch(()=>false)));
  ok('note keyed to course+hole in db', await until(async()=>{
    const r = await fetch(`${DB}/t/no-gimmes-2026/notes/vail/7.json`).then(x=>x.json());
    return r === 'lay back off the tee, creek crosses';
  }));

  // --- index.html carries exactly what the map pipeline builds ---
  const built = k => JSON.parse(readFileSync(join(here, 'osm', k + '.maps.json'), 'utf8'));
  for (const k of ['vail','willis','river','ranch','breck']){
    const want = {};
    for (const h of built(k)){
      if (h.nine) (want[h.nine] = want[h.nine] || {})[h.hole] = { vb: h.vb, g: h.g };
      else want[h.hole] = { vb: h.vb, g: h.g };
    }
    const line = html.match(new RegExp(`^HOLEMAPS\\.${k} = (.*);$`, 'm'));
    ok(`${k} embed is current with dev/osm/${k}.maps.json`,
      !!line && line[1] === JSON.stringify(want));
  }

  // --- overlapping Overpass boxes: each Keystone course kept its own lines ---
  const wayOf = (k, hole) => (built(k).find(h => h.hole === hole) || {}).way;
  ok('river 1 and 2 are the River Course\'s, not Ranch 1 and 2',
    wayOf('river', 1) === 759907392 && wayOf('river', 2) === 759907393);
  ok('ranch 16 and 17 are the Ranch\'s, not River 16 and 17',
    wayOf('ranch', 16) === 1162334830 && wayOf('ranch', 17) === 1162480606);

  // --- every embedded course carries a full round of maps ---
  ok('maps embedded for all five courses', await p.evaluate(()=>{
    const flat = k => { const m = HOLEMAPS[k]; return m && Array.from({length:18},(_,i)=>i+1).every(n=>m[n] && m[n].g.length); };
    const breck = ['beaver','bear','elk'].every(n => HOLEMAPS.breck[n] &&
      Array.from({length:9},(_,i)=>i+1).every(h => HOLEMAPS.breck[n][h] && HOLEMAPS.breck[n][h].g.length));
    return ['vail','willis','river','ranch'].every(flat) && breck;
  }));

  // --- Willis (a flat 18) ---
  await p.evaluate(()=>{ location.hash = '#/match/m2'; });
  ok('willis renders its own map', await until(()=>p.evaluate(()=>{
    const c = document.querySelector('.hmap .mc');
    return !!c && c.getAttribute('d') === HOLEMAPS.willis[1].g.find(x=>x[0]==='c')[1];
  })));

  // --- Keystone Ranch, whose OSM bbox overlaps the River Course ---
  await p.evaluate(()=>{ location.hash = '#/match/m4'; });
  ok('ranch renders its own map', await until(()=>p.evaluate(()=>{
    const c = document.querySelector('.hmap .mc');
    return !!c && c.getAttribute('d') === HOLEMAPS.ranch[1].g.find(x=>x[0]==='c')[1];
  })));

  // --- Breckenridge picks the map by nine, not by hole number ---
  await p.evaluate(()=>{ location.hash = '#/match/m3'; });   // Bear -> Elk
  const cline = () => p.evaluate(()=>{ const c = document.querySelector('.hmap .mc'); return c && c.getAttribute('d'); });
  const breckNine = (nine, h) => p.evaluate(([n,i])=>HOLEMAPS.breck[n][i].g.find(x=>x[0]==='c')[1], [nine,h]);
  ok('breck front nine draws BEAR', await until(async()=> await cline() === await breckNine('bear',1)));
  await p.locator('#cell10').click();
  ok('breck back nine draws ELK', await until(async()=> await cline() === await breckNine('elk',1)));
  await p.locator('#cell14').click();
  ok('breck hole 14 draws ELK 5', await until(async()=> await cline() === await breckNine('elk',5)));

  // --- spectator can't tap ---
  await p.evaluate(()=>{ location.hash = '#/match/m1'; });
  await until(()=>p.locator('#cell7').count().then(n=>n===1));
  // --- spectator: nobody selected by default, but may pick anyone ---
  await p.evaluate(()=>{ localStorage.setItem('ng_id', JSON.stringify('watch')); });
  await p.reload();
  await until(()=>p.locator('#cell7').count().then(n=>n===1));
  await p.locator('#cell7').click();
  await until(()=>p.locator('.hmap svg').count().then(n=>n===1));
  ok('legacy ball mark shows as a dot', await until(()=>p.locator('.hmap .bmark.b').count().then(n=>n===1))); // lands with the sync snapshot after reload
  ok('spectator has no golfer selected', await p.locator('.gchip.sel').count().then(n=>n===0));
  ok('spectator gets no tally bar', await p.locator('.tracebar').count().then(n=>n===0));
  await p.locator('.hmap svg').click({ position:{ x:100, y:30 } });
  await sleep(400);
  const h7 = await fetch(`${DB}/t/no-gimmes-2026/matches/m1/holes/7.json`).then(x=>x.json());
  ok('spectator tap writes nothing', !h7 || !h7.trace);
  await p.locator('.gchips .gchip').nth(3).click(); // Moose
  await p.locator('.hmap svg').click({ position:{ x:100, y:30 } });
  ok('…but can score for a picked golfer', await until(async()=>{
    const r = await fetch(`${DB}/t/no-gimmes-2026/matches/m1/holes/7/trace/p4.json`).then(x=>x.json());
    return Array.isArray(r) && r.length===1;
  }));

  // --- one-ball formats select a team, not a person ---
  await fetch(`${DB}/t/no-gimmes-2026/days/sat/format.json`, { method:'PUT', body: JSON.stringify('scramble') });
  await p.evaluate(()=>{ localStorage.setItem('ng_id', JSON.stringify('p2')); });
  await p.reload();
  await until(()=>p.locator('#cell7').count().then(n=>n===1));
  await p.locator('#cell7').click();
  await until(()=>p.locator('.gchips .gchip').count().then(n=>n===2));
  ok('scramble → two team chips', await p.locator('.gchips .gchip').count().then(n=>n===2));
  ok('Tank defaults to BLUE', await p.locator('.gchip.sel').textContent().then(t=>/BLUE/.test(t)));
  await p.locator('.hmap svg').click({ position:{ x:100, y:30 } });
  ok('team trace stored under B', await until(async()=>{
    const r = await fetch(`${DB}/t/no-gimmes-2026/matches/m1/holes/7/trace/B.json`).then(x=>x.json());
    return Array.isArray(r) && r.length===1;
  }));
} catch(e){ fail++; console.error('  FAIL (exception)', e); }

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); web.close(); mock.kill();
process.exit(fail ? 1 : 0);
