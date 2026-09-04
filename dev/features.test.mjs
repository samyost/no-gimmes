// Feature tests: the Mixer day format (rotating segments + back-nine flip,
// or a back nine in its own order), the shared mix library (day-independent
// rotations a day picks from), grudge-match side bets (1v1, zero cup points),
// Fig Jam mulligans on the stroke trace, and best-2-balls derivation.
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

  // --- hole 7: best-ball segment (4 player rows) ---
  await p.locator('#cell7').click();
  ok('hole 7 shows BEST BALL', await until(()=>p.locator('.hctx .h1').textContent().then(t=>/BEST BALL/.test(t))));
  ok('best-ball segment → one row per PLAYER', await until(()=>p.locator('.srow').count().then(n=>n===4)));

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
  await p.locator('.wbtn.R').first().click();
  await until(()=>p.locator('.mmeta .mst').textContent().then(t=>/1UP/.test(t)));
  const c = await p.evaluate(()=>{ const c = cup(); return { pts: c.red + c.blue, proj: c.pRed + c.pBlue, sched: c.scheduled }; });
  ok('side-bet hole moves nothing on the cup', c.pts === 0 && c.proj === 0);
  ok('side bet not in the scheduled pool', c.sched === 1);
  // side bet uses singles rows (2), not the mixer segment shape
  ok('side bet drawer is 1v1', await until(async()=>{
    if (await p.locator('.drawer .srow').count() === 0) await p.locator('.drawerh').click();
    return p.locator('.srow').count().then(n=>n===2);
  }));

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

  // --- the hybrid round: 3-hole turns of best ball / scramble / Fig Jam, the
  // back nine in its own order (not just the front reversed) ---
  await until(()=>p.evaluate(()=>pend.length===0)); // let the phone's own writes land before writing from "another phone"
  await fetch(`${DB}/t/no-gimmes-2026/mixes/mx3.json`, { method:'PUT', body:JSON.stringify(
    { name:'Birthday Weekend', seg:3, formats:['fourball','scramble','figjam'], flip:true, back:['scramble','figjam','fourball'], ord:5 }) });
  await fetch(`${DB}/t/no-gimmes-2026/days/sun/mixId.json`, { method:'PUT', body:JSON.stringify('mx3') });
  ok('own back-nine order drives holes 10-18', await until(()=>p.evaluate(()=>
    [1,4,7,10,13,16].map(n=>holeFormat('sun',n)).join() === 'fourball,scramble,figjam,scramble,figjam,fourball')));
  ok('mix card spells out the back nine', await until(()=>p.locator('.mixcard.on .fd').textContent().then(t=>/back: SCRAMBLE → FIG JAM → BEST BALL/.test(t))));
  await p.locator('.mixcard.on .mixedit').click();
  ok('designer shows the back nine as its own order', await until(()=>p.locator('#sheetbox .selopt.on', { hasText:'Its own order' }).count().then(n=>n===1)));
  ok('designer lists the back-nine chips', await p.locator('#sheetbox [data-act="mixbackdel"]').count().then(n=>n===3));
  // flipping back to "Reversed" drops the explicit list
  await p.locator('#sheetbox [data-act="mixback"][data-v="flip"]').click();
  ok('reversed again → FIG JAM leads the back', await until(()=>p.evaluate(()=>holeFormat('sun',10)==='figjam' && !sanitizeMix(S.mixes.mx3).back)));
  await p.locator('#sheetbox [data-act="mixback"][data-v="own"]').click();
  ok('"its own order" starts from what the back was playing', await until(()=>p.evaluate(()=>(sanitizeMix(S.mixes.mx3).back||[]).join()==='figjam,scramble,fourball')));
  await p.locator('button[data-act="sheet-close"]').click();

  // the ready-made recipe lands in the library as an editable copy and is picked for the day
  const before = await p.evaluate(()=>mixes().length);
  await p.locator('[data-act="mixpreset"]').first().click();
  ok('preset saved to the library', await until(()=>p.evaluate(b=>mixes().length===b+1, before)));
  ok('preset is the birthday rotation and picked for the day', await until(()=>p.evaluate(()=>{
    const m = S.mixes[dayCfg('sun').mixId]; return m && m.name==='Birthday Weekend' && [1,4,7].map(n=>holeFormat('sun',n)).join()==='fourball,scramble,figjam'; })));
  await p.locator('button[data-act="sheet-close"]').click();
  await until(()=>p.evaluate(()=>pend.length===0));
  await fetch(`${DB}/t/no-gimmes-2026/days/sun/mixId.json`, { method:'PUT', body:JSON.stringify('mx3') });

  // --- Fig Jam on the course: alternate shot, one ball a side, mulligans on the trace ---
  await p.evaluate(()=>{ location.hash='#/match/m3'; });
  await until(()=>p.locator('#cell7').count().then(n=>n===1));
  await p.locator('#cell7').click();
  ok('hole 7 shows FIG JAM', await until(()=>p.locator('.hctx .h1').textContent().then(t=>/FIG JAM/.test(t))));
  ok('Duck’s team ball is selected by default', await until(()=>p.locator('.gchip.sel', { hasText:'RED' }).count().then(n=>n===1)));
  const mul = () => p.locator('.tracebar [data-act="mulligan"]');
  ok('MULLIGAN offered, nothing to re-hit yet', await until(()=>mul().isDisabled()));
  await p.locator('.tracebar [data-act="tally"]').click();
  ok('one shot → MULLIGAN live', await until(()=>mul().isEnabled()));
  await mul().click();
  ok('a mulligan stops counting but stays in the record', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/0 SO FAR/.test(t) && /1 mulligan/.test(t))));
  ok('button shows the swing’s count', await until(()=>mul().textContent().then(t=>/1\/2/.test(t))));
  ok('re-hit needed before another', await mul().isDisabled());
  await p.locator('.tracebar [data-act="tally"]').click();
  await until(()=>mul().isEnabled());
  await mul().click();
  ok('second mulligan on the same swing', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/0 SO FAR/.test(t) && /2 mulligans/.test(t))));
  await p.locator('.tracebar [data-act="tally"]').click();
  ok('two is the cap — third swing must be played', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/1 SO FAR/.test(t)) && mul().isDisabled()));
  await p.locator('.tracebar [data-act="tally"]').click();
  await p.locator('.hmap .inbtn').click();
  ok('holed in 3 — mulligans never count', await until(()=>p.locator('.tracebar .ro').textContent().then(t=>/HOLED IN 3/.test(t))));
  ok('trace keeps all five strokes, two flagged', await p.evaluate(()=>{ const t = traceFor(theMatch('m3'), 7, 'A'); return t.length===5 && t.filter(s=>s.m).length===2; }));
  // the back is now FIG JAM → SCRAMBLE → BEST BALL (set in the designer above)
  await p.locator('#cell13').click();
  ok('hole 13 is SCRAMBLE (own back-nine order)', await until(()=>p.locator('.hctx .h1').textContent().then(t=>/SCRAMBLE/.test(t))));
  ok('no MULLIGAN outside Fig Jam', await until(()=>mul().count().then(n=>n===0)));

  // --- best 2 balls: both scores add up, so one number alone is never a pickup ---
  await fetch(`${DB}/t/no-gimmes-2026/mixes/mx3/formats/0.json`, { method:'PUT', body:JSON.stringify('best2') });
  await until(()=>p.evaluate(()=>holeFormat('sun',1)==='best2'));
  await p.locator('#cell1').click();
  ok('hole 1 shows BEST 2 BALLS', await until(()=>p.locator('.hctx .h1').textContent().then(t=>/BEST 2 BALLS/.test(t))));
  if (await p.locator('.drawer .srow').count() === 0) await p.locator('.drawerh').click();
  ok('own-ball rows for all four', await until(()=>p.locator('.srow').count().then(n=>n===4)));
  // tap a quick-row number and wait for it to land (the drawer re-renders as
  // the banner changes, so a tap can straddle a render)
  const tapGross = async (k, v) => {
    for (let i = 0; i < 3; i++){
      await p.locator(`.qn:not(.step)[data-k="${k}"][data-v="${v}"]`).click();
      if (await until(()=>p.evaluate(([k,v])=>(effStrokes(theMatch('m3'),1)||{})[k]===v, [k, v]), 1500)) return;
    }
  };
  await tapGross('p1', 4);
  ok('one ball in → still waiting on both sides', await until(()=>p.locator('.dbanner').textContent().then(t=>/Waiting on RED and BLUE/.test(t))));
  await tapGross('p3', 5);
  ok('red complete → waiting on blue', await until(()=>p.locator('.dbanner').textContent().then(t=>/Waiting on BLUE/.test(t))));
  await tapGross('p2', 4);
  await tapGross('p4', 5);
  // net 90% off Duck (4): Tank 7, Sly 4, Moose 13 → Moose gets a dot on SI 11.
  // RED 4+5=9, BLUE 4+(5-1)=8
  ok('two best nets add up → BLUE', await until(()=>p.locator('.dbanner').textContent().then(t=>/Derived: BLUE/.test(t))));

  // --- Shambleford: same balls, Stableford points — an eagle and a blow-up tie two pars ---
  await tapGross('p1', 2);
  await tapGross('p3', 6);
  await p.locator('.qn.step[data-k="p3"][data-v="7"]').click(); // + past the quick row
  await until(()=>p.evaluate(()=>(effStrokes(theMatch('m3'),1)||{}).p3===7));
  ok('best2 still adds strokes → BLUE', await until(()=>p.locator('.dbanner').textContent().then(t=>/Derived: BLUE/.test(t))));
  await fetch(`${DB}/t/no-gimmes-2026/mixes/mx3/formats/0.json`, { method:'PUT', body:JSON.stringify('shambleford') });
  ok('hole 1 shows SHAMBLEFORD', await until(()=>p.locator('.hctx .h1').textContent().then(t=>/SHAMBLEFORD/.test(t))));
  ok('points on every row', await until(()=>p.locator('.srowsub', { hasText:/4 pts/ }).count().then(n=>n===1)));
  ok('4+0 v 2+2 → halved', await until(()=>p.locator('.dbanner').textContent().then(t=>/HALVED/.test(t))));

  console.log(`\n${pass} passed, ${fail} failed`);
} catch(e){
  console.error('TEST CRASH:', e); fail++;
} finally {
  await browser.close(); web.close(); mock.kill();
  process.exit(fail ? 1 : 0);
}
