// Unit battery for the No Gimmes scoring engine.
// Runs against index.html's inline /* ===ENGINE=== */ block when index.html
// exists, else against dev/engine-draft.js — the draft and the shipped copy
// must be identical.
//   node dev/engine.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const indexPath = join(here, '..', 'index.html');

function loadEngine() {
  let src;
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, 'utf8');
    const m = html.match(/\/\* ===ENGINE=== \*\/([\s\S]*?)\/\* ===END ENGINE=== \*\//);
    if (!m) throw new Error('index.html exists but has no ===ENGINE=== block');
    src = m[1];
  } else {
    const js = readFileSync(join(here, 'engine-draft.js'), 'utf8');
    const m = js.match(/\/\* ===ENGINE=== \*\/([\s\S]*?)\/\* ===END ENGINE=== \*\//);
    src = m[1];
  }
  return new Function(`${src}; return ENG;`)();
}

const ENG = loadEngine();
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

const seq = (results) => { // 'A','B','H' array → holes object on holes 1..n
  const holes = {};
  results.forEach((w, i) => { if (w) holes[i + 1] = { w }; });
  return holes;
};
const O18 = Array.from({ length: 18 }, (_, i) => i + 1);
const O9 = Array.from({ length: 9 }, (_, i) => i + 1);

// ---- matchState -----------------------------------------------------------
{
  let s = ENG.matchState({}, O18, null);
  eq('empty match', [s.up, s.thru, s.done, s.statusText, s.dormie], [0, 0, false, 'A/S', false]);

  s = ENG.matchState(seq(['A', 'A', 'A']), O18, null);
  eq('3up thru 3', [s.up, s.thru, s.statusText, s.leader, s.done], [3, 3, '3UP', 'A', false]);

  s = ENG.matchState(seq(Array(10).fill('A')), O18, null);
  eq('10&8 maximal', [s.done, s.result.text, s.result.winner, s.result.closed], [true, '10&8', 'A', true]);

  // A: 4 up after 15 → 4&3 (win 5, lose 1, halve 9 → up 4, thru 15)
  const r43 = ['A', 'B', 'H', 'A', 'H', 'H', 'A', 'H', 'H', 'A', 'H', 'H', 'H', 'H', 'A'];
  s = ENG.matchState(seq(r43), O18, null);
  eq('4&3', [s.done, s.result.text, s.result.winner], [true, '4&3', 'A']);

  // dormie: B 3 up thru 15
  const dorm = [...Array(9).fill('H'), 'B', 'B', 'B', 'H', 'H', 'H'];
  s = ENG.matchState(seq(dorm), O18, null);
  eq('dormie B', [s.dormie, s.done, s.statusText, s.leader], [true, false, '3UP', 'B']);

  // dormie broken → halved match
  s = ENG.matchState(seq([...dorm, 'A', 'A', 'A']), O18, null);
  eq('halved after dormie chase', [s.done, s.result.text, s.result.winner], [true, 'HALVED', null]);

  // 1UP at the 18th
  const oneUp = [...Array(17).fill('H'), 'A'];
  s = ENG.matchState(seq(oneUp), O18, null);
  eq('1UP on 18', [s.done, s.result.text, s.result.winner], [true, '1UP', 'A']);

  // 1 up playing 18, wins it → 2UP
  const twoUp = [...Array(16).fill('H'), 'B', 'B'];
  s = ENG.matchState(seq(twoUp), O18, null);
  eq('2UP finish', [s.done, s.result.text, s.result.winner], [true, '2UP', 'B']);

  // concession while 2 down
  s = ENG.matchState(seq(['B', 'B', 'H']), O18, { by: 'A', afterThru: 3 });
  eq('A concedes', [s.done, s.result.winner, s.result.conceded], [true, 'B', true]);

  // for-fun holes after decided don't change the result
  s = ENG.matchState(seq([...Array(10).fill('A'), 'B', 'B']), O18, null);
  eq('for-fun after closeout', [s.result.text, s.result.winner], ['10&8', 'A']);

  // gap: holes 1,2 and 4 entered — every scored hole counts
  const gap = { 1: { w: 'A' }, 2: { w: 'A' }, 4: { w: 'B' } };
  s = ENG.matchState(gap, O18, null);
  eq('gap holes all count', [s.thru, s.up], [3, 1]);

  // closure works across a gap: 3 blank, 4-14 all A → 11 up, 7 unscored → decided
  const gapClose = {};
  [1,2].forEach(n=>gapClose[n]={w:'H'});
  for (let n=4;n<=14;n++) gapClose[n]={w:'A'};
  s = ENG.matchState(gapClose, O18, null);
  eq('closure across gap', [s.done, s.result.winner, s.result.margin, s.decidedAt], [true, 'A', 9, 12]);

  // clearing a mid-match hole un-decides a closed match
  const almost = {}; for (let n=1;n<=13;n++) almost[n]={w:'A'}; // 13&5 → done
  s = ENG.matchState(almost, O18, null);
  eq('13 straight closes', s.done, true);
  delete almost[3];
  s = ENG.matchState(almost, O18, null);
  eq('cleared hole reopens when margin allows', [s.thru, s.up, s.done], [12, 12, true]); // 12 up, 6 unscored → still done
  for (let n=8;n<=13;n++) delete almost[n];
  s = ENG.matchState(almost, O18, null);
  eq('enough cleared → live again', [s.thru, s.up, s.done], [6, 6, false]);

  // conceding while AHEAD records minimum 1UP for the receiver
  s = ENG.matchState(seq(['A', 'A']), O18, { by: 'A', afterThru: 2 });
  eq('concede while ahead', [s.result.winner, s.result.margin, s.result.text], ['B', 1, '1UP']);
  s = ENG.matchState(seq(['B', 'B', 'H']), O18, { by: 'A', afterThru: 3 });
  eq('concede while behind', [s.result.winner, s.result.margin, s.result.text], ['B', 2, '2UP']);

  // 9-hole match closes out
  s = ENG.matchState(seq(['A', 'A', 'A', 'A', 'A']), O9, null);
  eq('9-hole 5&4', [s.done, s.result.text], [true, '5&4']);

  // 9-hole halve
  s = ENG.matchState(seq(['A', 'B', 'H', 'H', 'H', 'H', 'H', 'H', 'H']), O9, null);
  eq('9-hole halved', [s.done, s.result.text], [true, 'HALVED']);
}

// ---- points ---------------------------------------------------------------
{
  const done = ENG.matchState(seq(Array(10).fill('A')), O18, null);
  eq('win points', ENG.matchPoints(done, 1), [1, 0]);
  eq('win points x2', ENG.matchPoints(done, 2), [2, 0]);
  const halved = ENG.matchState(seq(Array(18).fill('H')), O18, null);
  eq('halve points', ENG.matchPoints(halved, 1), [0.5, 0.5]);
  const live = ENG.matchState(seq(['B']), O18, null);
  eq('live yields none', ENG.matchPoints(live, 1), [0, 0]);
  eq('projected leader', ENG.projectedPoints(live, 1), [0, 1]);
  const as = ENG.matchState(seq(['A', 'B']), O18, null);
  eq('projected A/S splits', ENG.projectedPoints(as, 1), [0.5, 0.5]);
}

// ---- handicap allowances --------------------------------------------------
{
  const P = (id, ch, side) => ({ id, ch, side });
  let r = ENG.playingStrokes([P('a', 5, 'A'), P('b', 12, 'B')], 'singles', { net: false });
  eq('gross all zero', [r.players.a, r.players.b], [0, 0]);

  r = ENG.playingStrokes([P('a', 5, 'A'), P('b', 12, 'B')], 'singles', { net: true });
  eq('singles 100 off low', [r.players.a, r.players.b], [0, 7]);

  r = ENG.playingStrokes([P('a', -2, 'A'), P('b', 4, 'B')], 'singles', { net: true });
  eq('plus handicap', [r.players.a, r.players.b], [0, 6]);

  r = ENG.playingStrokes([P('a1', 4, 'A'), P('a2', 10, 'A'), P('b1', 8, 'B'), P('b2', 18, 'B')], 'fourball', { net: true });
  eq('fourball 90 off low', [r.players.a1, r.players.a2, r.players.b1, r.players.b2], [0, 5, 4, 13]);

  r = ENG.playingStrokes([P('a1', 5, 'A'), P('a2', 10, 'A'), P('b1', 8, 'B'), P('b2', 20, 'B')], 'foursomes', { net: true });
  eq('foursomes 50 combined', [r.sides.A, r.sides.B, r.kind], [0, 7, 'side']);

  r = ENG.playingStrokes([P('a1', 5, 'A'), P('a2', 10, 'A'), P('b1', 8, 'B'), P('b2', 20, 'B')], 'greensomes', { net: true });
  eq('greensomes 60/40', [r.sides.A, r.sides.B], [0, 6]);

  r = ENG.playingStrokes([P('a1', 10, 'A'), P('a2', 20, 'A'), P('b1', 0, 'B'), P('b2', 8, 'B')], 'scramble2', { net: true });
  eq('scramble 35/15', [r.sides.A, r.sides.B], [5, 0]); // A 3.5+3=6.5, B 0+1.2=1.2 → A round(5.3)=5

  r = ENG.playingStrokes([P('a1', 9, 'A'), P('b1', 4, 'B'), P('b2', 16, 'B')], 'foursomes', { net: true });
  eq('solo side in foursomes plays own ch', [r.sides.A, r.sides.B], [0, 1]); // B 50%(20)=10, A solo=9 → B gets 1

  eq('100pct override singles', ENG.playingStrokes([P('a', 6, 'A'), P('b', 10, 'B')], 'fourball', { net: true, pctOverride: 100 }).players.b, 4);
}

// ---- dots -----------------------------------------------------------------
{
  eq('dots basic', [ENG.dotsOnHole(7, 7, 18), ENG.dotsOnHole(7, 8, 18)], [1, 0]);
  eq('dots zero', ENG.dotsOnHole(0, 1, 18), 0);
  eq('dots 18 exact', [ENG.dotsOnHole(18, 18, 18), ENG.dotsOnHole(18, 1, 18)], [1, 1]);
  eq('dots 19 doubles SI1', [ENG.dotsOnHole(19, 1, 18), ENG.dotsOnHole(19, 2, 18)], [2, 1]);
  eq('dots 9-hole', [ENG.dotsOnHole(5, 5, 9), ENG.dotsOnHole(5, 6, 9), ENG.dotsOnHole(10, 1, 9)], [1, 0, 2]);
}

// ---- hole winner from strokes ---------------------------------------------
{
  const sidesPlayers = { A: ['a1', 'a2'], B: ['b1', 'b2'] };
  const si = 5, H = 18;
  const strokes = { kind: 'individual', players: { a1: 0, a2: 5, b1: 4, b2: 13 }, sides: { A: 0, B: 0 } };
  // b1 gets a dot on SI<=4? no: dotsOnHole(4,5)=0. a2 dotsOnHole(5,5)=1.
  // a2 gets a dot (5 strokes, SI 5): A best net = min(5, 5-1) = 4; B best = min(4, 6) = 4
  let w = ENG.holeWinnerFromStrokes('fourball', { players: { a1: 5, a2: 5, b1: 4, b2: 6 } }, sidesPlayers, strokes, si, H);
  eq('fourball best net halve', w, 'H');
  w = ENG.holeWinnerFromStrokes('fourball', { players: { a2: 4, b1: 5 } }, sidesPlayers, strokes, si, H);
  eq('fourball partial entries', w, 'A'); // a2 net 3 vs b1 net 5
  w = ENG.holeWinnerFromStrokes('fourball', { players: { b1: 6 } }, sidesPlayers, strokes, si, H);
  eq('side pickup loses', w, 'B');
  w = ENG.holeWinnerFromStrokes('fourball', { players: {} }, sidesPlayers, strokes, si, H);
  eq('nothing entered', w, null);

  const sideStrokes = { kind: 'side', players: {}, sides: { A: 0, B: 7 } };
  w = ENG.holeWinnerFromStrokes('foursomes', { sides: { A: 5, B: 5 } }, sidesPlayers, sideStrokes, 5, H);
  eq('foursomes net dot wins', w, 'B'); // B 5-1=4
  w = ENG.holeWinnerFromStrokes('foursomes', { sides: { A: 4 } }, sidesPlayers, sideStrokes, 5, H);
  eq('foursomes needs both', w, null);
}

// ---- cup targets ----------------------------------------------------------
{
  eq('8 pts → 4.5', ENG.cupTargets(8, null).win, 4.5);
  eq('8 pts holder retains at 4', ENG.cupTargets(8, 'red').retain, 4);
  eq('7 pts → 4', ENG.cupTargets(7, null).win, 4);
  eq('9.5 pts → 5', ENG.cupTargets(9.5, 'blue').win, 5);
  eq('9.5 pts no tie possible', ENG.cupTargets(9.5, 'blue').retain, null);
  eq('28 pts → 14.5 / 14', [ENG.cupTargets(28, 'eur').win, ENG.cupTargets(28, 'eur').retain], [14.5, 14]);
}

// ---- course handicap ------------------------------------------------------
{
  eq('course hcp formula', ENG.courseHandicap(10.4, 132, 71.2, 71), Math.round(10.4 * 132 / 113 + 0.2));
  eq('course hcp null index', ENG.courseHandicap(null, 132, 71.2, 71), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
