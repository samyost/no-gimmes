// Integration test: two Chromium pages vs the mock Firebase RTDB.
// Verifies: seeded boot, who-am-I, tap scoring, SSE live sync across clients,
// offline op queue + reflush, cross-match concurrent merge, match closure.
//   node dev/sync.test.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const DBP = 8791, WEBP = 8792;
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

// seed tree: 8 players, sat teams/matches ready
function seed(){
  const players = {}, usualTeams = {};
  const names = ['Duck','Tank','Sly','Moose','Bear','Gus','Hawk','KC'];
  names.forEach((n,i)=>{ players['p'+(i+1)] = { name:n, emoji:['🦅','🐻','🦊','🫎','🐺','🐐','🦈','🥃'][i], hcp: [4,10,8,18,6,12,2,15][i], ord:i };
    usualTeams['p'+(i+1)] = i%2===0 ? 'red' : 'blue'; });
  return {
    config: { tripName:'No Gimmes 2026', teamNames:{red:'RED',blue:'BLUE'}, holder:null, tieRule:'chip', gimme:'conc',
      net:true, allowances:{singles:100,fourball:90,shamble:85,foursomes:50,greensomes:60,chapman:60,scramble:35}, flat100:false, strokeCap:0,
      junk:false, junkTypes:{birdie:true}, skins:false, skinsNet:true, skinsCarry:true },
    players, usualTeams,
    days: { sat: { course:'vail', tee:'Black', format:'fourball', points:1, x2:false,
      times:{a:'06:00', b:'06:10'},
      teamOf:{},
      carts: { c1:{seats:['p1','p3'],group:'a'}, c2:{seats:['p2','p4'],group:'a'},
               c3:{seats:['p5','p7'],group:'b'}, c4:{seats:['p6','p8'],group:'b'} } } },
    matches: {
      m1: { day:'sat', group:'a', ord:0, red:['p1','p3'], blue:['p2','p4'], holes:{} },
      m2: { day:'sat', group:'b', ord:1, red:['p5','p7'], blue:['p6','p8'], holes:{} },
    },
    junk: {},
  };
}

const mock = spawn('node', [join(here,'mock-rtdb.js'), String(DBP)], { stdio:'inherit' });
const web = createServer((req,res)=>{ res.writeHead(200, {'Content-Type':'text/html'}); res.end(html); });
await new Promise(r => web.listen(WEBP, r));
await sleep(600);

// force "today" = Saturday Sept 5 2026 inside the pages so day resolution is deterministic
const FAKE_NOW = new Date('2026-09-05T15:00:00').getTime();

const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
async function newPage(){
  const ctx = await browser.newContext({ viewport:{ width:390, height:800 } });
  await ctx.addInitScript(`{
    const OD = Date;
    const fixed = ${FAKE_NOW};
    const start = OD.now();
    class FD extends OD {
      constructor(...a){ if (a.length===0) super(fixed + (OD.now()-start)); else super(...a); }
      static now(){ return fixed + (OD.now()-start); }
    }
    window.Date = FD;
  }`);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('  [pageerror]', e.message));
  return page;
}
const url = `http://127.0.0.1:${WEBP}/?db=${encodeURIComponent(DB)}`;

try {
  // ---- seed DB and open two clients ----
  await fetch(`${DB}/t/no-gimmes-2026.json`, { method:'PUT', body: JSON.stringify(seed()) });

  const p1 = await newPage();
  await p1.goto(url);
  ok('who-are-you shown', await until(()=>p1.locator('.whocard').count().then(n=>n===8)));
  await p1.locator('.whocard').first().click(); // Duck (p1), in m1
  // Duck is in a live match today (tee 06:00 < 15:00) → personalized landing on the match
  ok('personalized landing on own match', await until(()=>p1.evaluate(()=>location.hash.includes('#/match/m1'))));
  ok('status EVEN in the meta line, not a billboard', await until(()=>p1.locator('.mmeta .mst').textContent().then(t=>t.includes('EVEN'))));
  ok('no big status block', await p1.locator('.bigstat').count().then(n=>n===0));
  // ---- match screen chrome: setup gear top-right, one compact winner row, scores tucked away ----
  ok('setup gear on the match screen', await p1.locator('.cupstrip .gear[data-act="hub"]').count().then(n=>n===1));
  ok('one compact RED · HALVE · BLUE row', await p1.locator('.winrow .wbtn').count().then(n=>n===3));
  ok('scores drawer closed by default', await p1.locator('.drawer').count().then(n=>n===0));

  const p2 = await newPage();
  await p2.goto(url);
  await until(()=>p2.locator('.whocard').count().then(n=>n===8));
  await p2.locator('.whofoot button').click(); // spectator
  ok('spectator lands on board', await until(()=>p2.evaluate(()=>location.hash.includes('#/day/sat'))));

  // ---- board chrome: no tab strip; a day picker sheet; setup gear in the app bar ----
  ok('no day tab strip on the canvas', await p2.locator('.daytabs, .dt').count().then(n=>n===0));
  ok('setup gear in the app bar', await p2.locator('.appbar .gear[data-act="hub"]').count().then(n=>n===1));
  ok('day pill says TODAY', await p2.locator('.daypick').textContent().then(t=>/SAT/.test(t) && /TODAY/.test(t)));
  await p2.locator('.daypick').click();
  ok('day sheet lists all four days', await until(()=>p2.locator('#sheetbox .dayrow').count().then(n=>n===4)));
  ok('current day highlighted in the sheet', await p2.locator('#sheetbox .dayrow.on[data-d="sat"]').count().then(n=>n===1));
  await p2.locator('#sheetbox .dayrow[data-d="sun"]').click();
  ok('picking a day switches the board', await until(()=>p2.evaluate(()=>location.hash.includes('#/day/sun') && !ui.sheet)));
  await p2.locator('.daypick').click();
  await p2.locator('#sheetbox .dayrow[data-d="sat"]').click();
  await until(()=>p2.evaluate(()=>location.hash.includes('#/day/sat')));
  await p2.locator('.appbar .gear').click();
  ok('gear opens the setup hub', await until(()=>p2.locator('#sheetbox h3').textContent().then(t=>/Setup/i.test(t))));
  await p2.locator('#sheetlayer .scrim').click({ position:{ x:10, y:10 } }); // top corner — the sheet covers the middle
  await until(()=>p2.evaluate(()=>!ui.sheet));

  // ---- unstarted matches must not project (bone gap in the bar) ----
  const proj0 = await p2.evaluate(()=>{ const c = cup(); return c.pRed + c.pBlue; });
  ok('no projection before tee-off', proj0 === 0);

  // ---- net dots present (Vail Black, fourball 90% off low: Hawk hcp 2 low) ----
  const dotCount = await p1.locator('.cell .sdots i').count();
  ok('stroke dots painted on rail', dotCount > 0);

  // ---- tap scoring + SSE to the other client ----
  await p1.locator('.wbtn.R').click();          // hole 1: RED
  ok('optimistic rail fill', await until(()=>p1.locator('.cell .fill.A').count().then(n=>n>=1)));
  ok('status 1UP on scorer', await until(()=>p1.locator('.mmeta .mst').textContent().then(t=>t.includes('RED 1UP'))));
  ok('undo snackbar', await until(()=>p1.locator('#snack').textContent().then(t=>t.includes('UNDO'))));
  ok('p2 sees 1UP chip via SSE', await until(()=>p2.locator('.mrow .chip').first().textContent().then(t=>t.trim()==='1UP')));
  await sleep(1500); // let the SSE echo of p1's own write come back
  const selfEcho = await p1.locator('#snack').textContent();
  ok('no self-echo conflict toast', !/also scored/.test(selfEcho));

  // auto-advance: current hole is now 2
  ok('auto-advanced to hole 2', await until(()=>p1.locator('.hctx .h1').textContent().then(t=>t.includes('HOLE 2'))));

  // ---- strokes drawer derivation ----
  await p1.locator('.drawerh').click();
  await until(()=>p1.locator('.srow').count().then(n=>n===4));
  // hole 2 par: enter 4 for Duck(p1,red), 5 for others → red derived
  const rowVals = await p1.evaluate(()=>{
    const out=[]; document.querySelectorAll('.srow').forEach(r=>out.push(r.querySelector('.who').textContent));
    return out;
  });
  ok('drawer rows grouped red first', /Duck|Sly/.test(rowVals[0]));
  // Duck 3 (net 3) vs everyone else 5 → RED derived; before blue enters, banner must WAIT
  async function setRow(i, num){
    const row = p1.locator('.srow').nth(i);
    await row.locator(`.qn:not(.step)`, { hasText: String(num) }).first().click();
  }
  await setRow(0,3);
  ok('incomplete entry does not derive', await until(()=>p1.locator('.dbanner').textContent().then(t=>/Waiting/i.test(t))));
  await setRow(1,5); await setRow(2,5); await setRow(3,5);
  ok('derivation banner appears', await until(()=>p1.locator('.dbanner').textContent().then(t=>/Derived: RED/i.test(t))));
  const lit = p1.locator('.wbtn.R.lit');
  ok('red mini pill lit', await until(()=>lit.count().then(n=>n===1)));
  await lit.click();
  ok('hole 2 committed via strokes', await until(()=>p1.locator('.mmeta .mst').textContent().then(t=>t.includes('RED 2UP'))));

  // ---- offline queue + concurrent merge ----
  await p1.context().setOffline(true);
  // p1 (offline) scores hole 3 RED
  await until(()=>p1.locator('.hctx .h1').textContent().then(t=>t.includes('HOLE 3')));
  await p1.locator('.wbtn.R').first().click();
  ok('offline pill shows queued', await until(()=>p1.locator('.pill').first().textContent().then(t=>/QUEUED/.test(t))));
  // p2 scores m2 hole 1 BLUE meanwhile
  await p2.locator('[data-act="match"]').nth(1).click();
  await until(()=>p2.locator('.wbtn.B').count().then(n=>n===1));
  await p2.locator('.wbtn.B').click();
  await until(async()=>{ const r = await fetch(`${DB}/t/no-gimmes-2026/matches/m2/holes/1/winner.json`); return (await r.json())==='B'; });
  // p1 back online → its queued hole-3 op flushes; both survive
  await p1.context().setOffline(false);
  await p1.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  ok('offline op flushed to DB', await until(async()=>{
    const r = await fetch(`${DB}/t/no-gimmes-2026/matches/m1/holes/3/winner.json`); return (await r.json())==='A'; }, 10000));
  ok('concurrent write survived merge', await until(async()=>{
    const r = await fetch(`${DB}/t/no-gimmes-2026/matches/m2/holes/1/winner.json`); return (await r.json())==='B'; }));
  ok('p1 sees p2 match via SSE on board', await until(async()=>{
    await p1.locator('.backbtn').first().click().catch(()=>{});
    return p1.locator('.mrow .chip', { hasText:'1UP' }).count().then(n=>n>=1);
  }, 8000));

  // ---- closure: drive m2 to 10&8 on page2, closure sheet appears ----
  for (let h=2; h<=10; h++){
    await p2.locator('.wbtn.B').first().click();
    await sleep(760); // lockout
  }
  ok('closure sheet fired', await until(()=>p2.locator('#sheetbox').textContent().then(t=>/TAKE IT|Point posted/i.test(t))));
  ok('final chip on board (other client)', await until(async()=>{
    const t = await p1.locator('.mrow').nth(1).textContent(); return /10&8|9&8|✓/.test(t); }, 8000));
  const cupTxt = await p1.locator('.cuphead .cupline').textContent();
  ok('cup shows a posted point', /1/.test(cupTxt));

  // ---- ledger + rail sanity on closed match ----
  await p2.locator('[data-act="board"]').first().click().catch(()=>{});

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (e){
  console.error('TEST CRASH:', e);
  fail++;
} finally {
  await browser.close();
  web.close();
  mock.kill();
  process.exit(fail ? 1 : 0);
}
