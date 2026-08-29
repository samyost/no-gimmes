// No Gimmes scoring engine — pure functions, no DOM, no I/O.
// Drafted standalone; shipped inline in index.html between the ENGINE
// section markers (dev/engine.test.mjs extracts and tests whichever copy
// index.html carries once it exists).

/* ===ENGINE=== */
const ENG = (() => {
  // ---- match play status ------------------------------------------------
  // holes: object {holeNo: {w: 'A'|'B'|'H'}} — only entered holes present.
  // order: array of hole numbers in play order (e.g. [1..18] or [10..18,1..9]).
  // concession: null | {by:'A'|'B', afterThru:int} — side that conceded the match.
  // Returns the full derived state; "for fun" holes after the match is decided
  // are ignored for the result but still counted in wonA/wonB display tallies.
  function matchState(holes, order, concession) {
    const n = order.length;
    let up = 0; // + means A leads
    let thru = 0; // holes with a result, counting in play order up to first gap
    let decidedAt = 0; // holes played when the match became decided (0 = live)
    let result = null; // {winner:'A'|'B'|null, text, margin, closed}
    let wonA = 0, wonB = 0, halved = 0;
    let i = 0;
    for (; i < n; i++) {
      const h = holes[order[i]];
      if (!h || !h.w) break;
      if (h.w === 'A') { wonA++; up++; } else if (h.w === 'B') { wonB++; up--; } else halved++;
      thru = i + 1;
      const remaining = n - thru;
      if (!result && Math.abs(up) > remaining) {
        decidedAt = thru;
        const margin = Math.abs(up);
        result = {
          winner: up > 0 ? 'A' : 'B',
          margin,
          closed: remaining > 0,
          text: remaining > 0 ? `${margin}&${remaining}` : (margin === 1 ? '1UP' : `${margin}UP`),
        };
      }
      if (!result && thru === n) {
        decidedAt = thru;
        result = up === 0
          ? { winner: null, margin: 0, closed: false, text: 'HALVED' }
          : { winner: up > 0 ? 'A' : 'B', margin: Math.abs(up), closed: false, text: `${Math.abs(up)}UP` };
      }
    }
    if (concession && !result) {
      result = {
        winner: concession.by === 'A' ? 'B' : 'A',
        margin: Math.abs(up),
        closed: true,
        conceded: true,
        text: 'CONC',
      };
      decidedAt = thru;
    }
    const remaining = n - thru;
    const dormie = !result && up !== 0 && Math.abs(up) === remaining && remaining > 0;
    return {
      up, thru, remaining, wonA, wonB, halved, dormie,
      done: !!result, result,
      statusText: result ? result.text
        : up === 0 ? 'A/S'
        : `${Math.abs(up)}UP`,
      leader: result ? result.winner : (up > 0 ? 'A' : up < 0 ? 'B' : null),
    };
  }

  // Points a finished match yields: [ptsA, ptsB] out of `worth`.
  function matchPoints(state, worth) {
    if (!state.done) return [0, 0];
    if (state.result.winner === 'A') return [worth, 0];
    if (state.result.winner === 'B') return [0, worth];
    return [worth / 2, worth / 2];
  }

  // Projected points while live: leader gets the full match, A/S splits.
  function projectedPoints(state, worth) {
    if (state.done) return matchPoints(state, worth);
    if (state.leader === 'A') return [worth, 0];
    if (state.leader === 'B') return [0, worth];
    return [worth / 2, worth / 2];
  }

  // ---- handicaps --------------------------------------------------------
  // WHS allowance presets by format (percent of course handicap).
  // side handicap construction differs by format:
  //   fourball: each player 90% individually, then all off the low PLAYER in match
  //   singles: 100% individually, off the low
  //   foursomes: side = 50% of (sum of both partners), diff to higher side
  //   greensomes/chapman: side = 60% low + 40% high
  //   scramble2: side = 35% low + 15% high
  //   shamble: commonly played like fourball (own ball from the drive): 90% off low
  const ALLOWANCES = {
    singles:   { kind: 'individual', pct: 100 },
    fourball:  { kind: 'individual', pct: 90 },
    shamble:   { kind: 'individual', pct: 90 },
    foursomes: { kind: 'side', calc: (lo, hi) => 0.5 * (lo + hi) },
    greensomes:{ kind: 'side', calc: (lo, hi) => 0.6 * lo + 0.4 * hi },
    chapman:   { kind: 'side', calc: (lo, hi) => 0.6 * lo + 0.4 * hi },
    scramble2: { kind: 'side', calc: (lo, hi) => 0.35 * lo + 0.15 * hi },
  };

  // players: [{id, ch, side}] ch = course handicap (int, may be negative).
  // format + options {net:bool, pctOverride?} →
  // map playerId (individual formats) or side (side formats) → strokes received (int >= 0).
  function playingStrokes(players, format, options) {
    const out = { players: {}, sides: {}, kind: 'individual' };
    if (!options || !options.net) {
      players.forEach((p) => { out.players[p.id] = 0; });
      out.sides = { A: 0, B: 0 };
      return out;
    }
    const spec = ALLOWANCES[format] || ALLOWANCES.singles;
    const pct = options.pctOverride != null ? options.pctOverride : (spec.kind === 'individual' ? spec.pct : null);
    if (spec.kind === 'individual') {
      const allowed = players.map((p) => ({ id: p.id, a: (p.ch || 0) * (pct / 100) }));
      const low = Math.min(...allowed.map((x) => x.a));
      allowed.forEach((x) => { out.players[x.id] = Math.max(0, Math.round(x.a - low)); });
      out.sides = { A: 0, B: 0 };
      return out;
    }
    out.kind = 'side';
    const bySide = { A: [], B: [] };
    players.forEach((p) => bySide[p.side].push(p.ch || 0));
    const sideH = {};
    for (const s of ['A', 'B']) {
      const chs = bySide[s];
      if (chs.length === 0) { sideH[s] = 0; continue; }
      const lo = Math.min(...chs), hi = Math.max(...chs);
      let h = chs.length === 1 ? lo : spec.calc(lo, hi);
      if (options.pctOverride != null) h = h * (options.pctOverride / 100) / 1; // override scales the side handicap
      sideH[s] = h;
    }
    const low = Math.min(sideH.A, sideH.B);
    out.sides = { A: Math.max(0, Math.round(sideH.A - low)), B: Math.max(0, Math.round(sideH.B - low)) };
    players.forEach((p) => { out.players[p.id] = 0; });
    return out;
  }

  // Strokes on a given hole for someone receiving `strokes` total, given the
  // hole's stroke index si (1..18) over `holesInRound` (18): 1 dot on the
  // hardest `strokes` holes, second dot where strokes > 18, etc.
  function dotsOnHole(strokes, si, holesInRound) {
    if (!strokes || !si) return 0;
    const H = holesInRound || 18;
    let dots = Math.floor(strokes / H);
    if (si <= (strokes % H)) dots++;
    return dots;
  }

  // ---- deriving a hole result from strokes ------------------------------
  // grossBySide for team-ball formats: {A: n|null, B: n|null}
  // grossByPlayer for own-ball formats: {playerId: n|null} (missing = picked up)
  // strokesInfo = output of playingStrokes; si = hole stroke index.
  // Returns 'A'|'B'|'H'|null (null = not derivable yet).
  function holeWinnerFromStrokes(fmt, entry, sidesPlayers, strokesInfo, si, holesInRound) {
    const sideNet = { A: null, B: null };
    if (strokesInfo.kind === 'side' || fmt === 'foursomes' || fmt === 'greensomes' || fmt === 'chapman' || fmt === 'scramble2') {
      for (const s of ['A', 'B']) {
        const g = entry.sides && entry.sides[s];
        if (g == null) return null;
        sideNet[s] = g - dotsOnHole(strokesInfo.sides[s], si, holesInRound);
      }
    } else {
      // own-ball: best net among entered balls per side; a side with no ball
      // entered has picked up ONLY if the other side has at least one ball.
      for (const s of ['A', 'B']) {
        const ids = sidesPlayers[s];
        let best = null;
        for (const id of ids) {
          const g = entry.players && entry.players[id];
          if (g == null) continue;
          const net = g - dotsOnHole(strokesInfo.players[id], si, holesInRound);
          if (best === null || net < best) best = net;
        }
        sideNet[s] = best;
      }
      if (sideNet.A === null && sideNet.B === null) return null;
      if (sideNet.A === null) return 'B';
      if (sideNet.B === null) return 'A';
    }
    if (sideNet.A < sideNet.B) return 'A';
    if (sideNet.B < sideNet.A) return 'B';
    return 'H';
  }

  // ---- cup math ---------------------------------------------------------
  function cupTargets(totalPoints, holderTeam) {
    // smallest half-point step strictly above half the pool
    const win = Math.floor(totalPoints / 2 / 0.5) * 0.5 + 0.5;
    // a tie (and thus "holder retains") only exists when the pool splits evenly
    const tiePossible = (totalPoints * 2) % 2 === 0;
    return { win, retain: holderTeam && tiePossible ? totalPoints / 2 : null };
  }

  // course handicap from index (optional convenience): WHS full formula.
  function courseHandicap(index, slope, rating, par) {
    if (index == null || slope == null) return null;
    const cr = rating != null && par != null ? rating - par : 0;
    return Math.round(index * (slope / 113) + cr);
  }

  return { matchState, matchPoints, projectedPoints, playingStrokes, dotsOnHole,
           holeWinnerFromStrokes, cupTargets, courseHandicap, ALLOWANCES };
})();
/* ===END ENGINE=== */

if (typeof module !== 'undefined') module.exports = ENG;
