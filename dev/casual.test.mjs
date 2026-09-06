// Casual day: format CASUAL makes no matches; the board shows everyone's own
// card, the card page scores hole by hole, totals and to-par run live, and
// over/under reads the typed totals.
//   node dev/casual.test.mjs   (needs: cd dev && npm i)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const here = dirname(fileURLToPath(import.meta.url));
const DBP = 8851, WEBP = 8852, DB = `http://127.0.0.1:${DBP}`;
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond){ pass++; console.log('  ok', name); } else { fail++; console.error('  FAIL', name); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000, step = 120){ const t0 = Date.now(); while (Date.now() - t0 < ms){ try { if (await fn()) return true; } catch(e){} await sleep(step); } return false; }
function seed(){
  const players = {}, usualTeams = {};
  ['Duck','Tank','Sly'].forEach((n,i)=>{ players['p'+(i+1)] = { name:n, emoji:['🦅','🐻','🦊'][i], hcp:[4,null,null][i], ord:i }; usualTeams['p'+(i+1)] = i%2===0?'red':'blue'; });
  return { config:{ tripName:'T', teamNames:{red:'RED',blue:'BLUE'}, net:true, allowances:{singles:100,fourball:90,shamble:85,foursomes:50,greensomes:60,chapman:60,scramble:35} },
    players, usualTeams, days:{ sun:{ course:'vail', format:'casual', points:1, times:{a:'08:00'}, teamOf:{} } },
    matches:{ m9:{ day:'sun', group:'a', ord:0, red:['p1'], blue:['p2'], holes:{} } }, junk:{} };
}
const mock = spawn('node', [join(here,'mock-rtdb.js'), String(DBP)], { stdio:'ignore' });
const web = createServer((req,res)=>{ res.writeHead(200, {'Content-Type':'text/html'}); res.end(html); });
await new Promise(r => web.listen(WEBP, r)); await sleep(500);
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{ width:390, height:800 } });
await ctx.addInitScript(`{ const OD = Date; const fixed = ${new Date('2026-09-06T15:00:00').getTime()}; const start = OD.now();
  class FD extends OD { constructor(...a){ if (a.length===0) super(fixed + (OD.now()-start)); else super(...a); } static now(){ return fixed + (OD.now()-start); } } window.Date = FD; }`);
const p = await ctx.newPage(); await p.route(/fonts\.g(oogleapis|static)\.com/, r=>r.abort());
p.on('pageerror', e => { console.error('  [pageerror]', e.message); fail++; });
try {
  await fetch(`${DB}/t/no-gimmes-2026.json`, { method:'PUT', body: JSON.stringify(seed()) });
  await p.goto(`http://127.0.0.1:${WEBP}/?db=${encodeURIComponent(DB)}`);
  await until(()=>p.locator('.whocard').count().then(n=>n===3));
  await p.locator('.whocard').first().click(); // Duck
  ok('a casual day lands you on the card', await until(()=>p.evaluate(()=>location.hash==='#/card/sun')));
  ok('your own row comes first', await p.locator('.bbtm .srow .who').first().textContent().then(t=>/Duck/.test(t)));
  ok('three rows, one per player', await p.locator('.bbtm .srow').count().then(n=>n===3));
  const tap = async (name, v) => p.locator('.bbtm .srow', { hasText:name }).locator(`.qn:not(.step)[data-v="${v}"]`).click();
  await tap('Duck', 3); await tap('Tank', 5); await tap('Sly', 4); // hole 1 is a par 4
  ok('totals run live: Duck −1, Tank +1, Sly E', await until(()=>p.evaluate(()=>{ const r = Object.fromEntries(cardTotals('sun').map(x=>[x.pid,x])); return r.p1.toPar===-1 && r.p2.toPar===1 && r.p3.toPar===0 && r.p1.thru===1; })));
  ok('leader sorts first', await p.evaluate(()=>cardTotals('sun')[0].pid==='p1'));
  ok('net column shows for the one man with a handicap', await p.locator('.cardtbl th', { hasText:'NET' }).count().then(n=>n===1));
  ok('stays on hole 1 with NEXT HOLE offered', await p.locator('.bbhole .hn').textContent().then(t=>/HOLE 1/.test(t)) && await p.locator('[data-act="cardhole"][data-n="2"].bigbtn').count().then(n=>n===1));
  await p.locator('[data-act="cardhole"][data-n="2"].bigbtn').click();
  ok('next hole', await until(()=>p.locator('.bbhole .hn').textContent().then(t=>/HOLE 2/.test(t))));
  ok('scores sync', await until(async()=>{ const r = await fetch(`${DB}/t/no-gimmes-2026/bb/sun/strokes/1.json`); const v = await r.json(); return v && v.p1===3 && v.p2===5 && v.p3===4; }));
  // board
  await p.locator('.backbtn').first().click();
  ok('board shows the card, no match rows, no empty-state', await until(()=>p.locator('.tgh', { hasText:'THE CARD' }).count().then(n=>n===1)) && await p.locator('.mrow, .empty').count().then(n=>n===0));
  ok('rules line says casual, no cup points', await p.locator('.dayctx .c2').textContent().then(t=>/CASUAL/.test(t) && /NO CUP POINTS/.test(t)));
  const c = await p.evaluate(()=>{ const c = cup(); return { pts:c.red+c.blue+c.pRed+c.pBlue, sched:c.scheduled }; });
  ok('a stale match on a casual day is dropped by Make matches / nothing counts to the cup', c.pts===0);
  // over/under reads the typed card once all 18 are in
  await p.evaluate(()=>{ for (let n=1;n<=18;n++) op(`bb/sun/strokes/${n}/p3`, 5); });
  ok('over/under card total from typed scores', await until(()=>p.evaluate(()=>ouCardScore('sun','p3')===90 && ouScore('sun','p3').from==='card')));
  // the map: open it for Tank on hole 2, three shots and in → mapped 4 on the card
  await p.evaluate(()=>{ location.hash='#/card/sun'; });
  await until(()=>p.locator('.bbtm .srow').count().then(n=>n===3));
  await p.locator('[data-act="cardhole"][data-n="2"]').first().click();
  await until(()=>p.locator('.bbhole .hn').textContent().then(t=>/HOLE 2/.test(t)));
  await p.locator('.srowsub .mapbtn').nth(1).click(); // second row = Tank
  ok('map sheet opens for Tank', await until(()=>p.locator('#sheetbox h3').textContent().then(t=>/Tank · hole 2/.test(t))));
  ok('Tank is the selected golfer', await p.locator('#sheetbox .gchip.sel').textContent().then(t=>/Tank/.test(t)));
  for (let i=0;i<3;i++) await p.locator('#sheetbox [data-act="tally"]').click();
  await p.locator('#sheetbox [data-act="holed"]').click();
  ok('holed in 4 on the map', await until(()=>p.locator('#sheetbox .tracebar .ro').textContent().then(t=>/HOLED IN 4/.test(t))));
  await p.locator('#sheetbox [data-act="sheet-close"]').click();
  ok('mapped score lands on the card as Tank’s 4', await until(()=>p.evaluate(()=>cardGross('sun',2,'p2')===4 && bbGross('sun',2,'p2').from==='map')));
  ok('row says mapped', await until(()=>p.locator('.bbtm .srow:has-text("Tank") + .srowsub').textContent().then(t=>/mapped/.test(t))));
  ok('card match is not a cup match', await p.evaluate(()=>!matchesFor('sun').some(m=>m.id==='card_sun') && !!theMatch('card_sun') && cup().scheduled===1));
  ok('trace synced under matches/card_sun', await until(async()=>{ const r = await fetch(`${DB}/t/no-gimmes-2026/matches/card_sun/holes/2/trace/p2.json`); const v = await r.json(); return Array.isArray(v) ? v.length===4 : (v && Object.keys(v).length===4); }));
  // typing a number over it wins
  await p.locator('.bbtm .srow', { hasText:'Tank' }).locator('.qn:not(.step)[data-v="5"]').click();
  ok('typed 5 beats the mapped 4', await until(()=>p.evaluate(()=>cardGross('sun',2,'p2')===5)));

  // setup hides the match block
  await p.evaluate(()=>{ location.hash='#/day/sun/setup'; });
  ok('setup offers the card instead of match making', await until(()=>p.locator('[data-act="card"]').count().then(n=>n>=1)) && await p.locator('[data-act="makematches"]').count().then(n=>n===0));
  console.log(`\n${pass} passed, ${fail} failed`);
} catch(e){ console.error('TEST CRASH:', e); fail++; }
finally { await browser.close(); web.close(); mock.kill(); process.exit(fail ? 1 : 0); }
