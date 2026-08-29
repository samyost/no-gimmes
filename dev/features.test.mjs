// Feature tests: the Mixer day format (rotating segments + back-nine flip)
// and grudge-match side bets (1v1, zero cup points).
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
    days: { sun: { course:'breck', rot:'bb', format:'mixer',
      mixer:{ seg:3, formats:['scramble','greensomes','fourball'], flip:true },
      points:1, times:{a:'06:00'}, teamOf:{} } },
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

  // --- side bet: board section, zero cup impact ---
  await p.locator('.backbtn').first().click();
  ok('grudge section on the board', await until(()=>p.locator('.tgh', { hasText:'GRUDGE' }).count().then(n=>n===1)));
  await p.evaluate(()=>location.hash='#/match/sb1');
  ok('side-bet meta says no cup points', await until(()=>p.locator('.mmeta').textContent().then(t=>/SIDE BET/.test(t) && /NO CUP POINTS/.test(t))));
  // score a hole for Duck; the cup must not move
  await p.locator('.wbtn.R, .mini3 .mR').first().click();
  await until(()=>p.locator('.bigstat').textContent().then(t=>/1UP/.test(t)));
  const c = await p.evaluate(()=>{ const c = cup(); return { pts: c.red + c.blue, proj: c.pRed + c.pBlue, sched: c.scheduled }; });
  ok('side-bet hole moves nothing on the cup', c.pts === 0 && c.proj === 0);
  ok('side bet not in the scheduled pool', c.sched === 1);
  // side bet uses singles rows (2), not the mixer segment shape
  ok('side bet drawer is 1v1', await until(async()=>{
    if (await p.locator('.drawer .srow').count() === 0) await p.locator('.drawerh').click();
    return p.locator('.srow').count().then(n=>n===2);
  }));

  console.log(`\n${pass} passed, ${fail} failed`);
} catch(e){
  console.error('TEST CRASH:', e); fail++;
} finally {
  await browser.close(); web.close(); mock.kill();
  process.exit(fail ? 1 : 0);
}
