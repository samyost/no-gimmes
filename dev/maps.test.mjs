// Feature tests: lo-fi hole maps (traced from OSM), tap-to-drop ball marks
// (synced per player), historical hole notes, and plays-like yardage.
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
    days: { sat: { course:'vail', tee:'Black', format:'fourball', points:1, times:{a:'06:00'}, teamOf:{} } },
    matches: { m1: { day:'sat', group:'a', ord:0, red:['p1','p3'], blue:['p2','p4'], holes:{} } },
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

  // --- tap to drop a ball ---
  await p.locator('.hmap svg').click({ position:{ x:120, y:30 } });
  ok('tap drops my mark', await until(()=>p.locator('.hmap .bmark').count().then(n=>n===1)));
  ok('mark is team red', await p.locator('.hmap .bmark.r').count().then(n=>n===1));
  ok('mark synced to the db', await until(async()=>{
    const r = await fetch(`${DB}/t/no-gimmes-2026/days/sat/balls/1/p1.json`).then(x=>x.json());
    return r && typeof r.x === 'number' && typeof r.y === 'number';
  }));
  ok('footer offers clear', await p.locator('.hmapfoot button').count().then(n=>n===1));

  // --- second tap moves it (still one mark) ---
  await p.locator('.hmap svg').click({ position:{ x:200, y:40 } });
  await sleep(300);
  ok('second tap moves, not duplicates', await p.locator('.hmap .bmark').count().then(n=>n===1));

  // --- clear ---
  await p.locator('.hmapfoot button').click();
  ok('clear removes the mark', await until(()=>p.locator('.hmap .bmark').count().then(n=>n===0)));

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

  // --- spectator can't tap ---
  await p.evaluate(()=>{ localStorage.setItem('ng_id', JSON.stringify('watch')); });
  await p.reload();
  await until(()=>p.locator('.hmap svg').count().then(n=>n===1));
  ok('spectator gets no tap hint', await p.locator('.mhint').count().then(n=>n===0));
  await p.locator('.hmap svg').click({ position:{ x:100, y:30 } });
  await sleep(400);
  const balls7 = await fetch(`${DB}/t/no-gimmes-2026/days/sat/balls/7.json`).then(x=>x.json());
  ok('spectator tap writes nothing', !balls7 || !balls7.watch);
} catch(e){ fail++; console.error('  FAIL (exception)', e); }

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); web.close(); mock.kill();
process.exit(fail ? 1 : 0);
