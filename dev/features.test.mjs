// Feature tests: the Mixer day format (rotating segments + back-nine flip),
// the shared mix library (day-independent rotations a day picks from),
// and the retired grudge-match side bets staying invisible.
//   node dev/features.test.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const DBP = 8801, WEBP = 8802;
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
      net:true, allowances:{singles:100,fourball:90,shamble:85,foursomes:50,greensomes:60,chapman:60,scramble:35},
      flat100:false, strokeCap:0, junk:false, junkTypes:{}, skins:false, skinsNet:true, skinsCarry:true },
    players, usualTeams,
    mixes: {
      mx1: { name:'The Classic', seg:3, formats:['scramble','greensomes','fourball'], flip:true, ord:0 },
      mx2: { name:'Purist Special', seg:9, formats:['foursomes','fourball'], flip:false, ord:1 },
    },
    days: {
      sun: { course:'breck', rot:'bb', format:'mixer', mixId:'mx1',
        points:1, times:{a:'06:00'}, teamOf:{} },
      // pre-library data shape: a day carrying its own inline rotation
      sat: { course:'vail', format:'mixer',
        mixer:{ seg:9, formats:['foursomes','chapman'], flip:false }, teamOf:{} },
    },
    matches: {
      m3:  { day:'sun', group:'a', ord:0, red:['p1','p3'], blue:['p2','p4'], holes:{} },
      sb1: { day:'sun', side:true, group:'a', ord:90, red:['p1'], blue:['p3'], holes:{} }, // two red teammates
    },
    junk: {},
  };
}

const mock = spawn('node', [join(here,'mock-rtdb.js'), String(DBP)], { stdio:'ignore' });
const web = createServer((req,res)=>{ res.writeHead(200, {'Content-Type':'text/html'}); res.end(html); });
await new Promise(r => web.listen(WEBP, r));
await sleep(500);

const FAKE_NOW = new Date('2026-09-06T15:00:00').getTime(); // Sunday
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{ width:390, height:800 } });
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
  await p.locator('.whocard').first().click(); // Duck

  // cup match preferred over the side bet for personalized landing
  ok('lands on the cup match, not the side bet', await until(()=>p.evaluate(()=>location.hash.includes('#/match/m3'))));

  // --- mixer: hole 1 is scramble (side-format: 2 drawer rows) ---
  ok('hole 1 shows SCRAMBLE', await until(()=>p.locator('.hctx .h1').textContent().then(t=>/SCRAMBLE/.test(t))));
  ok('rail carries segment labels', await p.locator('.ninediv', { hasText:'SCRAMBLE' }).count().then(n=>n>=1));
  await p.locator('.drawerh').click();
  ok('scramble segment → one row per SIDE', await until(()=>p.locator('.srow').count().then(n=>n===2)));

  // --- hole 7: four-ball segment (4 player rows) ---
  await p.locator('#cell7').click();
  ok('hole 7 shows FOUR-BALL', await until(()=>p.locator('.hctx .h1').textContent().then(t=>/FOUR-BALL/.test(t))));
  ok('four-ball segment → one row per PLAYER', await until(()=>p.locator('.srow').count().then(n=>n===4)));

  // --- hole 16: flipped back nine → scramble again ---
  await p.locator('#cell16').click();
  ok('hole 16 flips back to SCRAMBLE', await until(()=>p.locator('.hctx .h1').textContent().then(t=>/SCRAMBLE/.test(t))));
  // hole 13-15 should be greensomes under the flip
  await p.locator('#cell13').click();
  ok('hole 13 is GREENSOMES under the flip', await until(()=>p.locator('.hctx .h1').textContent().then(t=>/GREENSOMES/.test(t))));

  // --- grudge matches retired: a stale side:true row in the database is invisible ---
  await p.locator('.backbtn').first().click();
  await until(()=>p.locator('.tgh').count().then(n=>n>=1));
  ok('no grudge section on the board', await p.locator('.tgh', { hasText:'GRUDGE' }).count().then(n=>n===0));
  ok('stale side bet is not a match the app knows', await p.evaluate(()=>!matchesFor('sun').some(m=>m.id==='sb1') && !theMatch('sb1') && cup().scheduled===1));
  await p.evaluate(()=>{ location.hash='#/match/sb1'; });
  ok('its old route falls through to the board', await until(()=>p.evaluate(()=>ui.screen==='board')));
  await p.evaluate(()=>{ location.hash='#/day/sun/setup'; });
  await until(()=>p.locator('[data-act="addmatch"]').count().then(n=>n===1));
  ok('setup no longer offers + Side bet', await p.locator('[data-act="addsidebet"]').count().then(n=>n===0));

  // --- mix library: shared day-independent rotations ---
  // sun resolves its rotation through mixes/mx1 (all the mixer checks above
  // already ran against that path); sat still carries a pre-library inline one
  ok('legacy inline rotation still drives sat', await p.evaluate(()=>holeFormat('sat',1)==='foursomes' && holeFormat('sat',10)==='chapman'));

  await p.evaluate(()=>{ location.hash='#/day/sun/setup'; });
  ok('setup lists both library mixes', await until(()=>p.locator('.mixcard').count().then(n=>n===2)));
  ok('the day’s pick is highlighted', await until(()=>p.locator('.mixcard.on .fn').textContent().then(t=>/The Classic/i.test(t))));

  // a rename from "another phone" (straight REST write) lands live via SSE
  await fetch(`${DB}/t/no-gimmes-2026/mixes/mx2/name.json`, { method:'PUT', body:JSON.stringify('Purist 2.0') });
  ok('remote rename shows up live', await until(()=>p.locator('.mixcard', { hasText:'Purist 2.0' }).count().then(n=>n===1)));

  // picking the other mix rewires the day's holes and syncs
  await p.locator('.mixcard:not(.on) .mixmain').click();
  ok('picked mix drives the day’s holes', await until(()=>p.evaluate(()=>holeFormat('sun',1)==='foursomes' && dayCfg('sun').mixId==='mx2')));
  ok('the pick syncs to the database', await until(async()=>{
    const r = await fetch(`${DB}/t/no-gimmes-2026/days/sun/mixId.json`); return (await r.json())==='mx2';
  }));

  // + New mix saves a shared version and opens the designer
  await p.locator('[data-act="mixnew"]').click();
  ok('designer sheet opens', await until(()=>p.locator('#sheetbox h3').textContent().then(t=>/Mix designer/i.test(t))));
  ok('new mix saved to the library', await until(()=>p.evaluate(()=>mixes().length===3)));
  ok('new mix seeded from the day and picked for it', await p.evaluate(()=>dayCfg('sun').mixId!=='mx2' && holeFormat('sun',1)==='foursomes'));

  // deleting a mix in play: the day keeps a private copy of the rotation
  p.once('dialog', d=>d.accept());
  await p.locator('[data-act="mixdelete"]').click();
  ok('deleted from the library', await until(()=>p.evaluate(()=>mixes().length===2)));
  ok('day keeps playing the same rotation', await until(()=>p.evaluate(()=>holeFormat('sun',1)==='foursomes' && !dayCfg('sun').mixId)));
  ok('day shows its now-unsaved own rotation', await until(()=>p.locator('.mixcard.on', { hasText:'OWN ROTATION' }).count().then(n=>n===1)));

  console.log(`\n${pass} passed, ${fail} failed`);
} catch(e){
  console.error('TEST CRASH:', e); fail++;
} finally {
  await browser.close(); web.close(); mock.kill();
  process.exit(fail ? 1 : 0);
}
