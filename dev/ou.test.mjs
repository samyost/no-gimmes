// Over/under browser tests: its own page, per-day lines on each player's gross
// score, bets capped by the Settings max, no over on yourself, even-money
// settlement against the book, and card-derived scores.
//   node dev/ou.test.mjs   (needs: cd dev && npm i)
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
  // Sly already has all 18 gross scores posted in a four-ball — 90 on the card
  const holes = {};
  for (let n=1;n<=18;n++) holes[n] = { strokes:{ p3:5 } };
  return {
    config: { tripName:'T', teamNames:{red:'RED',blue:'BLUE'}, holder:null, tieRule:'chip', gimme:'conc',
      net:true, allowances:{singles:100,fourball:90,shamble:85,foursomes:50,greensomes:60,chapman:60,scramble:35},
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
p.on('pageerror', e => console.error('  [pageerror]', e.message));
const ouGet = async () => (await fetch(`${DB}/t/no-gimmes-2026/ou.json`)).json();

try {
  await fetch(`${DB}/t/no-gimmes-2026.json`, { method:'PUT', body: JSON.stringify(seed()) });
  await p.goto(`http://127.0.0.1:${WEBP}/?db=${encodeURIComponent(DB)}`);
  await until(()=>p.locator('.whocard').count().then(n=>n===4));
  await p.locator('.whocard').first().click(); // Duck (p1)
  await until(()=>p.evaluate(()=>location.hash.startsWith('#/')));

  // --- pure logic, in page context ---
  const logic = await p.evaluate(()=>({
    max: ouMax(),
    over: ouResult(88.5, 91), under: ouResult(88.5, 80), push: ouResult(90, 90), none: ouResult(null, 90),
    selfOver: ouBetProblem('p1','p1','over'), selfUnder: ouBetProblem('p1','p1','under'), otherOver: ouBetProblem('p1','p2','over'),
    win: ouBetNet({side:'over',amt:10},'over'), lose: ouBetNet({side:'under',amt:10},'over'), pushNet: ouBetNet({side:'over',amt:10},'push'),
    card: ouCardScore('sun','p3'), noCard: ouCardScore('sun','p1'),
  }));
  ok('max bet defaults to $10', logic.max === 10);
  ok('over / under / push / no-result resolve', logic.over==='over' && logic.under==='under' && logic.push==='push' && logic.none===null);
  ok('over on yourself is refused, under is fine, over on someone else is fine', !!logic.selfOver && logic.selfUnder==='' && logic.otherOver==='');
  ok('even money: win +stake, lose −stake, push 0', logic.win===10 && logic.lose===-10 && logic.pushNet===0);
  ok('card-derived gross needs all 18 posted', logic.card===90 && logic.noCard===null);
  const edge = await p.evaluate(()=>{
    S.ou = { sun: { p1:{ line:0, score:-3 }, p2:{ line:'88.5', score:'91' } } };
    const bad = ouEntry('sun','p1'), good = ouEntry('sun','p2');
    delete S.ou;
    // a grudge match on the same day with different (complete) strokes for Sly, and Tank only posted there
    const holes = {}; for (let n=1;n<=18;n++) holes[n] = { strokes:{ p3:6, p2:4 } };
    S.matches.sb9 = { day:'sun', side:true, group:'a', ord:90, red:['p3'], blue:['p2'], holes };
    const r = { sly: ouCardScore('sun','p3'), tank: ouCardScore('sun','p2') };
    delete S.matches.sb9;
    return { bad, good, r };
  });
  ok('non-positive line/score read as unset', edge.bad.line===null && edge.bad.score===null && edge.good.line===88.5 && edge.good.score===91);
  ok('cup match card beats a grudge match card', edge.r.sly===90);
  ok('grudge match stands in when the cup match has no per-player card', edge.r.tank===72);

  // --- its own page, reached from the gear hub ---
  await p.locator('.gear').first().click();
  ok('hub carries an Over / Under row', await until(()=>p.locator('.hubrow', { hasText:'Over / Under' }).count().then(n=>n===1)));
  await p.locator('.hubrow', { hasText:'Over / Under' }).click();
  ok('routes to #/ou/<day>', await until(()=>p.evaluate(()=>location.hash==='#/ou/sun')));
  ok('one card per player on the day', await until(()=>p.locator('.oucard').count().then(n=>n===4)));
  ok('board has no over/under section', await p.evaluate(()=>!/OVER \/ UNDER/.test(renderBoard('sun'))));
  ok('Sly’s score fills in from the card', await p.locator('#ou-p3 [data-input="ouscore"]').getAttribute('placeholder').then(v=>v==='90'));
  ok('no betting until a line is set', await p.locator('#ou-p1 .oubtn').isDisabled());

  // --- set a line on Duck, half-point, syncs ---
  await p.locator('#ou-p1 [data-input="ouline"]').fill('88.5');
  await p.locator('#ou-p1 [data-input="ouline"]').press('Enter');
  await p.locator('#ou-p1 [data-input="ouline"]').blur();
  ok('line saved to the trip', await until(async()=>{ const o = await ouGet(); return o && o.sun && o.sun.p1 && o.sun.p1.line===88.5; }));
  ok('BET opens up once a line is set', await until(()=>p.locator('#ou-p1 .oubtn').isEnabled()));

  // --- Duck (this phone) can't take the over on himself ---
  await p.locator('#ou-p1 .oubtn').click();
  ok('bet sheet opens on Duck', await until(()=>p.locator('#sheetbox h3').textContent().then(t=>/Bet on .*Duck/.test(t))));
  ok('OVER is disabled for the man himself', await p.locator('#sheetbox [data-act="ouside"][data-v="over"]').isDisabled());
  ok('UNDER pre-selected for a self bet', await p.locator('#sheetbox [data-act="ouside"][data-v="under"].pri').count().then(n=>n===1));
  ok('amount chips stop at the max', await p.evaluate(()=>[...document.querySelectorAll('#sheetbox [data-act="ouamt"]')].every(b=>+b.dataset.v<=10)));
  await p.locator('#sheetbox [data-act="ouamt"][data-v="5"]').click();
  await p.locator('#sheetbox [data-act="ouplace"]').click();
  ok('Duck’s $5 under on himself lands', await until(async()=>{ const o = await ouGet(); const b = o.sun.p1.bets && o.sun.p1.bets.p1; return b && b.side==='under' && b.amt===5; }));

  // --- Tank takes the over on Duck at $10 (max) ---
  await p.locator('#ou-p1 .oubtn').click();
  await p.locator('#sheetbox [data-act="oubettor"][data-p="p2"]').click();
  ok('OVER enabled when betting on somebody else', await p.locator('#sheetbox [data-act="ouside"][data-v="over"]').isEnabled());
  await p.locator('#sheetbox [data-act="ouside"][data-v="over"]').click();
  await p.locator('#sheetbox [data-act="ouplace"]').click();
  ok('Tank’s over lands at the $10 max by default', await until(async()=>{ const o = await ouGet(); const b = o.sun.p1.bets.p2; return b && b.side==='over' && b.amt===10; }));
  ok('two bet chips on Duck’s card', await until(()=>p.locator('#ou-p1 .oubet').count().then(n=>n===2)));

  // --- a write that dodges the UI still gets clamped and the rule still holds ---
  const forced = await p.evaluate(()=>{ const why = ouPlaceBet('sun','p1','p1','over',10); const r2 = ouPlaceBet('sun','p1','p4','under',999); return { why, r2, amt: ouEntry('sun','p1').bets.p4.amt }; });
  ok('ouPlaceBet refuses the self-over', /over on yourself/.test(forced.why));
  ok('ouPlaceBet clamps to the max', forced.r2==='' && forced.amt===10);

  // --- post the score: 91 → OVER. Tank +10, Duck −5, Moose −10 ---
  await p.locator('#ou-p1 [data-input="ouscore"]').fill('91');
  await p.locator('#ou-p1 [data-input="ouscore"]').press('Enter');
  await p.locator('#ou-p1 [data-input="ouscore"]').blur();
  ok('verdict reads OVER by 2.5', await until(()=>p.locator('#ou-p1 .verdict').textContent().then(t=>/OVER BY 2\.5/i.test(t))));
  const book = await p.evaluate(()=>ouDayBook('sun'));
  ok('day book settles even money', book.net.p2===10 && book.net.p1===-5 && book.net.p4===-10 && book.settled===3 && book.open===0);
  ok('the book shows the house side', book.book===5);
  ok('book rendered on the page', await until(()=>p.locator('.oubook .brow', { hasText:'Tank' }).textContent().then(t=>/\+\$10/.test(t))));

  // --- max lives in Settings ---
  await p.evaluate(()=>{ location.hash='#/settings'; });
  ok('settings has the max-bet field', await until(()=>p.locator('[data-input="oumax"]').count().then(n=>n===1)));
  await p.locator('[data-input="oumax"]').fill('20');
  await p.locator('[data-input="oumax"]').press('Enter');
  await p.locator('[data-input="oumax"]').blur();
  ok('max syncs to config', await until(async()=>{ const r = await fetch(`${DB}/t/no-gimmes-2026/config/ouMax.json`); return (await r.json())===20; }));
  ok('ouMax follows the setting', await p.evaluate(()=>ouMax()===20));

  // --- one place for everything one person has placed ---
  await p.evaluate(()=>{ location.hash='#/ou/sun'; });
  await until(()=>p.locator('.oubyrow [data-act="oubets"]').count().then(n=>n===4));
  // Duck also takes the under on Sly at 90 (a push) so the list spans lines
  await p.evaluate(()=>{ op('ou/sun/p3/line', 90); ouPlaceBet('sun','p3','p1','under',10); });
  await p.locator('.oubyrow [data-act="oubets"][data-p="p1"]').click();
  ok('bets-by sheet opens on Duck', await until(()=>p.locator('#sheetbox h3').textContent().then(t=>/Duck’s bets/.test(t))));
  ok('lists both of Duck’s bets', await until(()=>p.locator('#sheetbox .oubetrow').count().then(n=>n===2)));
  ok('each row names the line, side, stake and outcome', await p.evaluate(()=>{
    const rows = [...document.querySelectorAll('#sheetbox .oubetrow')].map(r=>r.textContent.replace(/\s+/g,' '));
    return rows.some(t=>/on .*Duck/.test(t) && /UNDER 88\.5/.test(t) && /\$5/.test(t) && /−\$5/.test(t))
        && rows.some(t=>/on .*Sly/.test(t) && /UNDER 90/.test(t) && /\$10/.test(t) && /PUSH/.test(t));
  }));
  ok('summary nets the settled bets', await p.locator('#sheetbox .oubetsum').textContent().then(t=>/settled/.test(t) && /−\$5/.test(t)));
  await p.locator('#sheetbox [data-act="oubetsfor"][data-p="p2"]').click();
  ok('switching to Tank shows his one bet', await until(()=>p.locator('#sheetbox h3').textContent().then(t=>/Tank’s bets/.test(t))) && await p.locator('#sheetbox .oubetrow').count().then(n=>n===1));
  await p.locator('#sheetbox [data-act="oubetsfor"][data-p="p3"]').click();
  ok('a player with no bets gets the empty line', await until(()=>p.locator('#sheetbox .oubetsum').textContent().then(t=>/No bets yet/.test(t))));
  ok('ouBetsBy spans days and lines', await p.evaluate(()=>{ const r = ouBetsBy('p1'); return r.length===2 && r[0].pid==='p1' && r[1].pid==='p3' && r[1].net===0; }));
  ok('bets keep their timestamp and sort oldest first', await p.evaluate(()=>{
    const e = ouEntry('sun','p1');
    const ts = Object.values(e.bets).map(b=>b.t);
    const chips = [...document.querySelectorAll('#ou-p1 .oubet')].map(c=>c.dataset.b);
    const byT = Object.entries(e.bets).sort((a,b)=>a[1].t-b[1].t).map(([b])=>b);
    return ts.every(x=>x>0) && chips.join()===byT.join() && ouBetsBy('p1').every((r,i,a)=>i===0 || a[i-1].bet.t<=r.bet.t);
  }));
  // a row opens the bet editor for that bet
  await p.locator('#sheetbox [data-act="oubetsfor"][data-p="p1"]').click();
  await p.locator('#sheetbox .oubetrow[data-p="p3"]').click();
  ok('tapping a bet opens its editor', await until(()=>p.locator('#sheetbox h3').textContent().then(t=>/Bet on .*Sly/.test(t))));
  await p.evaluate(()=>closeSheet(true));
  // the book rows open the same sheet
  await p.locator('.oubook .brow[data-p="p2"]').first().click();
  ok('book row opens that person’s bets', await until(()=>p.locator('#sheetbox h3').textContent().then(t=>/Tank’s bets/.test(t))));
  await p.evaluate(()=>closeSheet(true));

  // --- pulling a bet ---
  await p.evaluate(()=>{ location.hash='#/ou/sun'; });
  await until(()=>p.locator('#ou-p1 .oubet').count().then(n=>n===3));
  await p.locator('#ou-p1 .oubet[data-b="p4"]').click();
  await until(()=>p.locator('#sheetbox [data-act="ouremove"]').count().then(n=>n===1));
  await p.locator('#sheetbox [data-act="ouremove"]').click();
  ok('bet pulled from the trip', await until(async()=>{ const o = await ouGet(); return !(o.sun.p1.bets && o.sun.p1.bets.p4); }));

  console.log(`\n${pass} passed, ${fail} failed`);
} catch(e){
  console.error('TEST CRASH:', e); fail++;
} finally {
  await browser.close(); web.close(); mock.kill();
  process.exit(fail ? 1 : 0);
}
