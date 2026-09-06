// Head-to-head browser tests: stroke play derived from the card, negotiated
// strokes flat off the total, one stake per matchup settling player to player
// into the over/under ledger; the draw pairs red with blue and doubles up
// exactly one on 4 v 3; retired grudge matches stay invisible.
//   node dev/h2h.test.mjs   (needs: cd dev && npm i)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const DBP = 8831, WEBP = 8832;
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
  const names = ['Duck','Tank','Sly','Moose','Wolf','Goat','Owl'];
  names.forEach((n,i)=>{ players['p'+(i+1)] = { name:n, emoji:['🦅','🐻','🦊','🫎','🐺','🐐','🦉'][i], hcp:null, ord:i };
    usualTeams['p'+(i+1)] = i%2===0 ? 'red' : 'blue'; }); // 4 red (odd ids), 3 blue
  // Duck 4s all day (72) and Tank 5s all day (90) on the card; Sly and Moose only through 9
  const h1 = {}, h2 = {};
  for (let n=1;n<=18;n++){ h1[n] = { strokes:{ p1:4, p2:5 } }; if (n<=9) h2[n] = { strokes:{ p3:5, p4:4 } }; }
  return {
    config: { tripName:'T', teamNames:{red:'RED',blue:'BLUE'}, holder:null, tieRule:'chip', gimme:'conc',
      net:false, allowances:{singles:100,fourball:90,shamble:85,foursomes:50,greensomes:60,chapman:60,scramble:35},
      flat100:false, strokeCap:0, junk:false, junkTypes:{}, skins:false, skinsNet:true, skinsCarry:true, ouMax:10, h2hStake:10 },
    players, usualTeams,
    days: { sun: { course:'vail', format:'fourball', points:1, times:{a:'06:00'}, teamOf:{} } },
    matches: { m1: { day:'sun', group:'a', ord:0, red:['p1','p5'], blue:['p2','p6'], holes:h1 },
               m2: { day:'sun', group:'a', ord:1, red:['p3','p7'], blue:['p4'], holes:h2 },
               sb1: { day:'sun', side:true, group:'a', ord:90, red:['p1'], blue:['p2'], holes:{} } }, // retired shape
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
p.on('pageerror', e => { console.error('  [pageerror]', e.message); fail++; });
const h2hGet = async () => (await fetch(`${DB}/t/no-gimmes-2026/h2h/sun.json`)).json();

try {
  await fetch(`${DB}/t/no-gimmes-2026.json`, { method:'PUT', body: JSON.stringify(seed()) });
  await p.goto(`http://127.0.0.1:${WEBP}/?db=${encodeURIComponent(DB)}`);
  await until(()=>p.locator('.whocard').count().then(n=>n===7));
  await p.locator('.whocard').first().click(); // Duck
  await until(()=>p.evaluate(()=>location.hash.startsWith('#/')));

  // --- pure logic, in page context ---
  const logic = await p.evaluate(()=>{
    const row = (a,b,to,n) => ({ d:'sun', a, b, to, n, stake:10, id:'x', t:0 });
    return {
      stake: h2hStake(),
      flat: h2hResult(row('p1','p2',null,0)),          // Duck 72 v Tank 90
      give10: h2hResult(row('p1','p2','p2',10)),        // Tank gets 10 → 72 v 80
      give18: h2hResult(row('p1','p2','p2',18)),        // push
      give20: h2hResult(row('p1','p2','p2',20)),        // Tank by 2
      live: h2hResult(row('p3','p4',null,0)),           // both thru 9, Moose 9 better
      none: h2hResult(row('p5','p6',null,0)),           // nothing posted
      net: [h2hNet(row('p1','p2','p2',20), h2hResult(row('p1','p2','p2',20)), 'p2'), h2hNet(row('p1','p2','p2',20), h2hResult(row('p1','p2','p2',20)), 'p1')],
      grudgeGone: !matchesFor('sun').some(m=>m.id==='sb1') && !theMatch('sb1'),
    };
  });
  ok('default stake from settings', logic.stake === 10);
  ok('no strokes: Duck by 18', logic.flat.done && logic.flat.winner==='p1' && logic.flat.margin===18);
  ok('10 strokes to Tank: Duck by 8', logic.give10.winner==='p1' && logic.give10.margin===8);
  ok('18 strokes: push', logic.give18.done && logic.give18.winner===null);
  ok('20 strokes: Tank by 2 — strokes flip it', logic.give20.winner==='p2' && logic.give20.margin===2);
  ok('live: gross diff over the holes both posted', !logic.live.done && logic.live.thru===9 && logic.live.diff===9);
  ok('nothing posted: thru 0', !logic.none.done && logic.none.thru===0);
  ok('even money player to player', logic.net[0]===10 && logic.net[1]===-10);
  ok('retired grudge match is invisible', logic.grudgeGone);

  // --- the page: hub → Side action, head-to-head section on top ---
  await p.locator('.gear').first().click();
  await p.locator('#sheetbox .hubrow', { hasText:'Head-to-head' }).click();
  ok('lands on the side action page', await until(()=>p.evaluate(()=>location.hash==='#/ou/sun')));
  ok('head-to-head section renders above over/under', await until(async()=>{
    const h = await p.locator('.h2hhdr h4').allTextContents(); return h[0]==='HEAD-TO-HEAD' && h[1]==='OVER / UNDER'; }));

  // --- draw: 4 red v 3 blue → 4 matchups, red v blue, one blue doubles ---
  await p.locator('[data-act="h2hdraw"]').click();
  ok('draw makes four matchups', await until(()=>p.locator('.h2hrow').count().then(n=>n===4)));
  const drawn = await p.evaluate(()=>h2hRows('sun').map(r=>({ a:effTeam('sun',r.a), b:effTeam('sun',r.b), pa:r.a, pb:r.b, n:r.n, stake:r.stake })));
  ok('every matchup is red vs blue', drawn.every(r=>r.a==='red' && r.b==='blue'));
  ok('every red plays once', new Set(drawn.map(r=>r.pa)).size===4);
  ok('exactly one blue doubles up', new Set(drawn.map(r=>r.pb)).size===3);
  ok('strokes start at 0, stake at the default', drawn.every(r=>r.n===0 && r.stake===10));
  ok('matchups sync to the database', await until(async()=>{ const h = await h2hGet(); return h && Object.keys(h).length===4; }));
  ok('team tally shows in the header', await p.locator('.h2hhdr .tally').textContent().then(t=>/RED \d/.test(t) && /\d BLUE/.test(t)));

  // --- + Matchup: Duck vs Tank, Duck gives 20, $20 ---
  await p.evaluate(()=>op('h2h/sun', null)); // clean slate for a deterministic row
  await until(()=>p.locator('.h2hrow').count().then(n=>n===0));
  await p.locator('[data-act="h2hnew"]').click();
  ok('matchup sheet opens', await until(()=>p.locator('#sheetbox h3').textContent().then(t=>/New matchup/i.test(t))));
  ok('Add it disabled until two are picked', await p.locator('[data-act="h2hsave"]').isDisabled());
  await p.locator('#sheetbox .pchip', { hasText:'Duck' }).click();
  await p.locator('#sheetbox .pchip', { hasText:'Tank' }).click();
  ok('header reads Duck vs Tank', await p.locator('#sheetbox .h2hvs').textContent().then(t=>/Duck/.test(t) && /Tank/.test(t)));
  for (let i=0;i<20;i++) await p.locator('#sheetbox .h2hstep .nav').nth(1).click();
  ok('stepper at 20', await p.locator('#sheetbox .h2hstep .n').textContent().then(t=>t.trim()==='20'));
  ok('strokes default to the second man; the toggle shows both ways', await p.locator('#sheetbox [data-act="h2hto"]').count().then(n=>n===2));
  await p.locator('#sheetbox [data-act="h2hto"][data-p="p2"]').click(); // Tank gets them → Duck gives
  await p.locator('#sheetbox [data-act="h2hstake"][data-v="20"]').click();
  await p.locator('[data-act="h2hsave"]').click();
  ok('row shows the terms', await until(()=>p.locator('.h2hrow .terms').first().textContent().then(t=>/Duck gives 20/.test(t) && /\$20/.test(t))));
  ok('row settles off the card: Tank by 2, +$20 Tank', await p.locator('.h2hrow .out').first().textContent().then(t=>/Tank by 2/.test(t) && /\+\$20/.test(t)));
  ok('tally: BLUE 1', await p.locator('.h2hhdr .tally').textContent().then(t=>/RED 0/.test(t) && /1 BLUE/.test(t)));
  ok('saved shape in the database', await until(async()=>{ const h = await h2hGet(); const r = h && Object.values(h)[0]; return r && r.a==='p1' && r.b==='p2' && r.give.to==='p2' && r.give.n===20 && r.stake===20; }));

  // --- ledger: same book as over/under, player to player ---
  const book = await p.evaluate(()=>ouDayBook('sun'));
  ok('ledger nets Tank +20, Duck −20, book untouched', book.net.p2===20 && book.net.p1===-20 && book.book===0 && book.settled===1);
  ok('day ledger renders both', await p.locator('.oubook .brow', { hasText:'Tank' }).textContent().then(t=>/\+\$20/.test(t)));
  // an over/under bet lands in the same numbers
  await p.evaluate(()=>{ op('ou/sun/p1/line', 70); op('ou/sun/p1/bets/p2', { side:'over', amt:5, t:Date.now() }); }); // Duck shot 72 → over wins for Tank
  ok('over/under adds into the same ledger', await until(()=>p.evaluate(()=>{ const b = ouDayBook('sun'); return b.net.p2===25 && b.net.p1===-20 && b.book===-5; })));

  // --- edit: tap the row, flip who gives → Duck by 38 ---
  await p.locator('.h2hrow').first().click();
  ok('sheet opens on the existing matchup', await until(()=>p.locator('#sheetbox h3').textContent().then(t=>/^Matchup/i.test(t.trim()))));
  await p.locator('#sheetbox [data-act="h2hto"][data-p="p1"]').click(); // Duck gets them
  await p.locator('[data-act="h2hsave"]').click();
  ok('flipped strokes flip the result', await until(()=>p.locator('.h2hrow .out').first().textContent().then(t=>/Duck by 38/.test(t))));

  // --- live matchup: Sly v Moose thru 9 ---
  await p.locator('[data-act="h2hnew"]').click();
  await p.locator('#sheetbox .pchip', { hasText:'Sly' }).click();
  await p.locator('#sheetbox .pchip', { hasText:'Moose' }).click();
  await p.locator('[data-act="h2hsave"]').click();
  ok('live row shows the running gross diff', await until(()=>p.locator('.h2hrow', { hasText:'Sly' }).locator('.out').textContent().then(t=>/Moose −9/.test(t) && /thru 9/.test(t))));
  ok('an open matchup counts as riding', await p.evaluate(()=>ouDayBook('sun').open===1));

  // --- delete with undo ---
  await p.locator('.h2hrow', { hasText:'Sly' }).click();
  await p.locator('[data-act="h2hdel"]').click();
  ok('deleted', await until(()=>p.locator('.h2hrow').count().then(n=>n===1)));
  await p.locator('#snack [data-act="snackbtn"]').click();
  ok('undo brings it back', await until(()=>p.locator('.h2hrow').count().then(n=>n===2)));

  // --- the cup never sees any of it ---
  const c = await p.evaluate(()=>{ const c = cup(); return c.red + c.blue + c.pRed + c.pBlue; });
  ok('head-to-head moves nothing on the cup', c === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
} catch(e){
  console.error('TEST CRASH:', e); fail++;
} finally {
  await browser.close(); web.close(); mock.kill();
  process.exit(fail ? 1 : 0);
}
