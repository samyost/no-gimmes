// Best-ball (three teams) browser tests: its own page, teams drawn 2·2·3 from
// seven present players, gross off the card or typed on the page, low team
// takes the hole, a two-way tie is a push that the tied teams settle on the
// next hole even when a third team wins that hole.
//   node dev/bb.test.mjs   (needs: cd dev && npm i)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const DBP = 8821, WEBP = 8822;
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
    usualTeams['p'+(i+1)] = i%2===0 ? 'red' : 'blue'; });
  // Duck and Tank play a four-ball on the card: Duck 4 on 1, Tank 5 on 1 — the page should read them
  const holes = { 1: { strokes:{ p1:4, p2:5 } } };
  return {
    config: { tripName:'T', teamNames:{red:'RED',blue:'BLUE'}, holder:null, tieRule:'chip', gimme:'conc',
      net:false, allowances:{singles:100,fourball:90,shamble:85,foursomes:50,greensomes:60,chapman:60,scramble:35},
      flat100:false, strokeCap:0, junk:false, junkTypes:{}, skins:false, skinsNet:true, skinsCarry:true },
    players, usualTeams,
    days: { sun: { course:'vail', format:'fourball', points:1, times:{a:'06:00'}, teamOf:{} } },
    matches: { m1: { day:'sun', group:'a', ord:0, red:['p1','p3'], blue:['p2','p4'], holes } },
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

try {
  await fetch(`${DB}/t/no-gimmes-2026.json`, { method:'PUT', body: JSON.stringify(seed()) });
  await p.goto(`http://127.0.0.1:${WEBP}/?db=${encodeURIComponent(DB)}`);
  await until(()=>p.locator('.whocard').count().then(n=>n===7));
  await p.locator('.whocard').first().click(); // Duck

  // --- hub → Best Ball page ---
  await p.locator('[data-act="hub"]').first().click();
  ok('hub offers Best Ball under side action', await until(()=>p.locator('#sheetbox .hubrow', { hasText:'Best Ball' }).count().then(n=>n===1)));
  await p.locator('#sheetbox .hubrow', { hasText:'Best Ball' }).click();
  ok('lands on #/bb/sun', await until(()=>p.evaluate(()=>location.hash==='#/bb/sun')));
  ok('no teams yet → editor with a draw button', await until(()=>p.locator('[data-act="bbdeal"]').count().then(n=>n===1)));
  ok('draw button says 2·2·3 for seven', await p.locator('[data-act="bbdeal"]').textContent().then(t=>/2·2·3/.test(t)));

  // --- draw teams, then pin a known split by tapping ---
  await p.locator('[data-act="bbdeal"]').click();
  ok('draw makes three teams of 2, 2, 3', await until(()=>p.evaluate(()=>{ const t = bbTeams('sun').map(x=>x.ids.length); return t.join(',')==='2,2,3'; })));
  ok('teams sync to the database', await until(async()=>{ const r = await fetch(`${DB}/t/no-gimmes-2026/bb/sun/team.json`); const t = await r.json(); return t && Object.keys(t).length===7; }));
  // force a deterministic split: 1 = Duck+Tank, 2 = Sly+Moose, 3 = Wolf+Goat+Owl
  await p.evaluate(()=>op('bb/sun/team', { p1:'1', p2:'1', p3:'2', p4:'2', p5:'3', p6:'3', p7:'3' }));
  await until(()=>p.evaluate(()=>bbTeamOf('sun','p7')==='3'));
  // tapping a name moves it to the next team; tapping around brings it back
  await p.locator('.bbchip', { hasText:'Owl' }).click();
  ok('tap moves Owl off team 3 (out)', await until(()=>p.evaluate(()=>bbTeamOf('sun','p7')===null)));
  await p.locator('.bbchip', { hasText:'Owl' }).click(); // → 1
  await p.locator('.bbchip', { hasText:'Owl' }).click(); // → 2
  await p.locator('.bbchip', { hasText:'Owl' }).click(); // → 3
  ok('three taps later Owl is back on team 3', await until(()=>p.evaluate(()=>bbTeamOf('sun','p7')==='3')));
  await p.locator('[data-act="bbedit"][data-v="0"]').click();
  ok('DONE shows the scoring view on hole 1', await until(()=>p.locator('.bbhole .hn').textContent().then(t=>/HOLE 1/.test(t))));

  // --- card scores read through: Duck 4, Tank 5 already on hole 1 ---
  ok('Duck’s 4 comes off the card (brass)', await p.locator('.bbtm.t1 .qn.set.card').count().then(n=>n===2));
  ok('team 1 best is 4', await p.locator('.bbtm.t1 .best').textContent().then(t=>/best 4/.test(t)));
  ok('hole waits on the other two teams', await p.locator('.bbverdict').textContent().then(t=>/Waiting on/.test(t)));

  // --- hole 1: team 2 ties team 1 at 4, team 3 makes 5 → push 1 v 2 ---
  const tap = async (team, name, v) => p.locator(`.bbtm.t${team} .srow`, { hasText:name }).locator(`.qn:not(.step)[data-v="${v}"]`).click();
  await tap(2, 'Sly', 4); await tap(2, 'Moose', 6);
  await tap(3, 'Wolf', 5); await tap(3, 'Goat', 5); await tap(3, 'Owl', 6);
  ok('hole 1 is a push between teams 1 and 2', await until(()=>p.locator('.bbverdict .push').count().then(n=>n===1)));
  ok('verdict names the tied teams', await p.locator('.bbverdict').textContent().then(t=>/🦅🐻/.test(t) && /🦊🫎/.test(t) && !/🐺/.test(t)));
  ok('standings all zero', await p.evaluate(()=>{ const s = bbState('sun'); return s.won['1']===0 && s.won['2']===0 && s.won['3']===0 && s.carries.length===1; }));
  ok('rail marks hole 1 as a push', await p.locator('#bbcell1 .r').textContent().then(t=>t==='='));
  ok('NEXT HOLE appears once posted', await p.locator('[data-act="bbhole"][data-n="2"].bigbtn').count().then(n=>n===1));

  // --- hole 2: team 3 wins outright (3), but 1 v 2 is settled 4 v 5 → team 1 gets hole 1 ---
  await p.locator('[data-act="bbhole"][data-n="2"].bigbtn').click();
  ok('on hole 2, banner says hole 1 is riding', await until(()=>p.locator('.bbopen').textContent().then(t=>/Hole 1 still up/.test(t))));
  await tap(1, 'Duck', 4); await tap(1, 'Tank', 5);
  await tap(2, 'Sly', 5); await tap(2, 'Moose', 5);
  await tap(3, 'Wolf', 3); await tap(3, 'Goat', 4); await tap(3, 'Owl', 4);
  ok('team 3 takes hole 2, team 1 takes the carried hole 1', await until(()=>p.evaluate(()=>{ const s = bbState('sun'); return s.won['1']===1 && s.won['2']===0 && s.won['3']===1 && s.carries.length===0; })));
  ok('verdict says both', await p.locator('.bbverdict').textContent().then(t=>/🐺🐐🦉.*take hole 2/.test(t) && /🦅🐻.*hole 1 \(carried\)/.test(t)));
  ok('standings show 1 · 0 · 1', await p.locator('.bbstand .tm .pts').allTextContents().then(a=>a.join(',')==='1,0,1'));
  ok('ledger has two rows', await p.locator('.bbledger tr').count().then(n=>n===3));

  // --- typed score overrides the card and tapping it again clears back to the card ---
  await p.locator('#bbcell1').click();
  await until(()=>p.locator('.bbhole .hn').textContent().then(t=>/HOLE 1/.test(t)));
  await tap(1, 'Duck', 3); // Duck typed 3 here (card says 4)
  ok('typed 3 beats the card 4', await until(()=>p.evaluate(()=>bbGross('sun',1,'p1').v===3 && bbGross('sun',1,'p1').from==='hand')));
  ok('hole 1 now goes to team 1 outright, no push', await until(()=>p.evaluate(()=>{ const s = bbState('sun'); return s.perHole[1].winner==='1' && s.won['1']===1 && s.won['3']===1 && s.carries.length===0; })));
  await tap(1, 'Duck', 3); // tap again → clear → back to the card
  ok('clearing falls back to the card', await until(()=>p.evaluate(()=>bbGross('sun',1,'p1').v===4 && bbGross('sun',1,'p1').from==='card')));

  // --- pickup: a team with every ball picked up loses the hole ---
  await p.locator('#bbcell3').click();
  await until(()=>p.locator('.bbhole .hn').textContent().then(t=>/HOLE 3/.test(t)));
  await tap(1, 'Duck', 4); await tap(1, 'Tank', 4);
  await tap(2, 'Sly', 4); await tap(2, 'Moose', 4);
  await p.locator('.bbtm.t3 .srow:has-text("Wolf") + .srowsub .pickup').click();
  await p.locator('.bbtm.t3 .srow:has-text("Goat") + .srowsub .pickup').click();
  await p.locator('.bbtm.t3 .srow:has-text("Owl") + .srowsub .pickup').click();
  ok('all-pickup team scores X and the hole is a 1 v 2 push', await until(()=>p.evaluate(()=>{ const s = bbState('sun'); const r = s.perHole[3]; return r && r.net['3']===Infinity && r.push && r.push.join()==='1,2'; })));

  // --- cup untouched, board shows the strip ---
  const c = await p.evaluate(()=>{ const c = cup(); return c.red + c.blue + c.pRed + c.pBlue; });
  ok('best ball moves nothing on the cup', c === 0);
  await p.locator('.backbtn').first().click();
  ok('board carries a best-ball strip', await until(()=>p.locator('.tgh', { hasText:'BEST BALL' }).count().then(n=>n===1)));
  ok('strip shows the tally and the open push', await p.locator('[data-act="bb"].dayfoot').textContent().then(t=>/🦅🐻 1/.test(t) && /🐺🐐🦉 1/.test(t) && /1 riding/.test(t)));

  console.log(`\n${pass} passed, ${fail} failed`);
} catch(e){
  console.error('TEST CRASH:', e); fail++;
} finally {
  await browser.close(); web.close(); mock.kill();
  process.exit(fail ? 1 : 0);
}
