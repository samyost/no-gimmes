# Ideas

Parking lot for things we want but haven't built. Newest at the top. Nothing
here is a commitment; it's here so it doesn't get lost between trips.

---

## Head-to-head day — stroke play, negotiated strokes, one bet per matchup

**Built** (Sept 2026, from the group chat). What shipped, and where it departs
from the design below:

- Lives on the Side action page (`#/ou/<day>`) above Over/Under, exactly as
  drawn: one row per matchup, tap to edit, **+ Matchup** and **🎲 Draw**.
  Data is `h2h/<day>/<id> = { a, b, give:{to, n}, stake, t }`; the trip
  default stake is `config.h2hStake` (Settings, next to the over/under max).
- Results are derived from `ouScore` (posted total beats card total) and
  settle even money player to player into `ouDayBook` / `ouTripBook`, so the
  day and trip ledgers carry over/under and head-to-head together; the book
  line only reflects over/under. Open matchups count as "riding".
- The live view is the gross running diff over the holes both players have
  posted, with the negotiated strokes shown as "to come" rather than applied
  mid-round.
- The draw pairs shuffled reds against shuffled blues; the long side plays in
  order and the short side is cycled, so on 4 v 3 exactly one blue doubles and
  who that is comes from the shuffle.
- Grudge matches are retired: `matchesFor` drops any `side:true` row and
  `theMatch` returns null for one, so stale data can't reach a renderer; the
  **+ Side bet** button, the board and cup-sheet grudge sections,
  `sideBetsFor`, and the `ouCardScore` fallback are gone. The `m.side`
  branches inside the match screen and its sheets are still in the source
  but unreachable — a later tidy, not behaviour.
- Tests: `dev/h2h.test.mjs`.

---

### The original proposal

### The ask

Ryder-Cup-spirit singles day: every player gets a head-to-head against someone
on the other team. Stroke play over the round. Any strokes given are negotiated
between the two players ("Mike gives Will 10"), not derived from handicaps. On
a 4 v 3 day one of the three, chosen at random, plays two matchups and
negotiates each separately. Each match is worth a point of value TBD.

### Derive it, don't score it

The app already collects every player's 18 gross scores (SCORES drawer or the
shot map) and already totals them for over/under (`ouCardScore` / `ouScore`,
posted total beating card total). A head-to-head is then pure arithmetic on
numbers we have: `a.gross − b.gross ± strokes`. No new scoring surface, no
new match entity, nothing hole-by-hole. That is the whole design.

- **Data:** `h2h/<day>/<id> = { a, b, give:{ to:<pid>, n:10 }, stake, t }`.
  `give.to` is who receives the strokes; `n` is a flat integer off the round
  total. No stroke-index allocation because it's stroke play.
- **Result:** both totals known → winner and margin, or PUSH on a tie. One
  total known → nothing yet. Neither → `thru N` with a live running diff over
  the holes both players have posted — the fun part on the course, and free.
- **Money:** `stake` in dollars per matchup, defaulting from one trip setting
  (`h2hStake`, next to `ouMax`) and editable per row. Settles even money into
  the same trip ledger as over/under so a person has one number for the trip.
- **Team tally:** the section header shows matchups won `RED 3 – BLUE 2`.
  Display only; the cup never sees it (same rule as over/under).
- **Handicaps:** never read. Gross plus negotiated strokes, full stop.

### Where it lives

The existing Side action page (`#/ou/<day>`) gains a Head-to-head section
above Over/Under. One row per matchup:

    Mike vs Will · Mike gives 10 · $20        Will by 2 ✓ · +$20 Will

Tap a row to change strokes, stake, or delete it. **+ Matchup** picks one red
and one blue player (today's teams via `effTeam`). **Draw matchups** pairs the
present reds and blues at random; on an uneven day it also draws which player
on the short side doubles up. Strokes start at 0 and get typed in after the
negotiation.

### What comes out: grudge matches

Grudge matches (`matches/sb*`, `side:true`) were the previous answer to "a
1v1 side game" and lose on every axis this feature cares about: match play
instead of stroke play, WHS net strokes instead of a negotiated number, and
their own hole-by-hole scoring in a separate match screen. `m.side` is
threaded through ~36 sites (match screen, concede and closure sheets, chips,
cup sheet, pick-a-fighter, the ouCardScore fallback). All of it goes:
the `+ Side bet` button, `sideBetsFor`, the SIDE branches, the Grudge
matches block on the cup sheet, and the `matches/sb*` fallback in
`ouCardScore`. Any `side:true` match already in the database is filtered out
on load so stale data can't reach the renderers.

### What stays: handicaps

The WHS allowance machinery drives the cup's net matches. Whether the trip
plays the cup net is a separate decision; this feature simply never touches
it. Trimming allowances, stroke cap and the percent sheet is a possible
follow-up, not part of this.

### Edge cases

- **Scramble / one-ball day:** no individual gross exists. Type the totals
  (already how over/under works). The feature is aimed at fourball/singles
  days anyway.
- **Doubled-up player:** two independent rows. Same gross, different strokes.
- **Strokes to the wrong guy:** `give.to` is a two-way toggle on the row's
  sheet ("Mike gives" / "Will gives"), so fixing it is one tap.
- **Not present today:** draw uses `presentIds(d)` only.

### Size

About 250 lines in (section render, matchup sheet, draw, settle), about 150
out (grudge). A `dev/h2h.test.mjs` shaped like `ou.test.mjs`: draw pairs
red with blue and doubles exactly one on 4 v 3; result flips with strokes;
push on a tie; ledger nets with over/under; grudge matches no longer render.

---

## Select a golfer, then score for them — three ways to count a hole

**Built** (Sept 2026). What shipped, and where it departs from the design
below. The original write-up is kept underneath because it records the
reasoning; the decisions here win where they disagree.

### Decisions taken

- **Selection is a chip row above the map**, one chip per golfer (per team in
  one-ball formats), defaulting to the phone's owner when they're in the match
  and to nobody otherwise. Tapping the selected chip deselects. Tapping a
  player's name in the strokes drawer selects them too. Selection lives in
  `ui.sel[matchId] = {n, key}` and falls back to the default whenever the hole
  changes — device-local, not persisted; a reload mid-hole just re-defaults.
- **The drawer keeps every row live.** The design floated collapsing it to one
  active row plus a picker. That makes the common case — one phone entering all
  four scores at the green — four taps slower and hides the other numbers.
  Rejected; the rows *are* the picker.
- **An in-progress trace is never a score.** `score ?? shots.length` as written
  would derive a hole result from three taps mid-hole. The effective gross is
  the posted score, else the trace length *only once the trace is complete*.
  Until then the drawer shows "3 on the map so far" and lights nothing.
- **Forward only** (revised Sept 2026). A list built forward from empty starts
  at the tee by construction, so there is no "tee shot" tap. The reverse
  putt-back-to-tee build shipped first and was retired the same week: IN THE
  HOLE silently flipping into a mode where the button reads TEE SHOT was the
  least intuitive thing on the screen. Now IN THE HOLE — or a tap on the flag
  itself — is always the holing stroke; on an empty trace that is an ace and
  comes with an UNDO snack. "Lost track" is handled by typing the number under
  SCORES. Old reverse traces (`r`/`t` flags) still render and still count.
- **Storage:** `matches/<id>/holes/<n>/trace/<key>` — a sibling of
  `strokes/<key>`, so a hole's posted score and its trace sit together and
  `clearHole` / commit-undo preserve both. Key is a player id, or `A`/`B` in
  one-ball formats. A trace is a list of `{x,y}` strokes with optional flags
  `h` (holed), `r` (built in reverse), `t` (tee shot, reverse only), `p`
  (penalty), `u` (tallied without a spot — Firebase drops empty objects, so a
  positionless stroke always carries a flag). The old single ball mark at
  `days/<d>/balls/<n>/<pid>` still renders as a one-stroke trace; nothing
  writes there any more.
- **One-ball formats select a team.** The scramble/foursomes ball is the team's;
  who swung is a different fact. If we ever want per-swing attribution it's a
  flag on the stroke, not a different selection model.
- **Anyone may score for anyone**, spectators included — they just get no
  default. Consistent with RED/HALVE/BLUE, which never checked identity either.
- **Posted beats mapped, visibly.** A hand-entered number lights the quick row;
  the sub-line says `mapped 12 · use 12`, and "use" clears the posted number
  rather than copying — the hole goes back to being map-derived. The ledger
  footnotes `posted 8, mapped 12`, the same way `overridden` / `drifted` annotate
  without overwriting.
- **Undo** is a device-local stack per trace (↶ in the tally bar); after a
  reload it falls back to peeling the most recent end. CLEAR wipes the trace
  with the usual snack UNDO.
- **Unplaceable putts** get `+1` (a positionless stroke); PENALTY is the same
  with a flag. Map zoom stays parked below.

### Still parked

- **Map enlarge / zoom.** `.hmap` is a plain `width:100%` SVG; a real pinch or
  tap-to-enlarge is new interaction work. `+1` covers the putts-you-can't-place
  case, so this is a nicety rather than a gap.
- **Edit history.** Still separable, still not needed for the flag question.

---

### The original design note

### The idea

When you open the scoring interface for a hole, there should be a notion of
*whose* strokes you're entering. If the phone's loaded identity is one of the
golfers in this match, that golfer starts out selected — visibly highlighted, the
way a picked chip looks. You can deselect and select somebody else, enter their
strokes or drop their ball positions, then hand the selection back. If the person
holding the phone isn't one of the golfers in the match (a spectator, `watch`
mode, or a player in a different match), nothing is selected by default.
**Selection resets to the default each hole** rather than carrying forward.

The map half is the part we can't do at all today, and it's the reason the idea
exists: tapping the hole map should place a ball for the *selected* golfer, one
tap per stroke, so a hole ends up with a shot-by-shot trace rather than a single
dot.

### Three ways to put a number on a hole

All three should coexist on the same hole, freely mixed, the way RED/HALVE/BLUE
and the strokes drawer already mix:

1. **Pick the total directly.** What the drawer does today — tap `5`.
2. **Tally as you play.** Add a stroke with a single tap, no position required.
   Just a counter that goes up.
3. **Tally via the map.** Each tap places a dot; the count is the number of dots.
   This works in **both directions** — some people play the hole forward, others
   get to the green, hole out, and then replay it backwards in their head from
   the putt to the drive. Both need to be first-class.

### The unifying model

These stop being three features if a player's hole entry is an **ordered list of
strokes**, where each stroke *optionally* carries a position:

- The **score is the length of the list**. Positions are optional decoration.
- Mode 2 appends a stroke with no `{x,y}`.
- Mode 3 appends a stroke with `{x,y}`.
- Mode 1 sets the length directly.
- Reverse mapping appends to the front instead of the back.

That also handles the cases that otherwise need special pleading:

- **Lost ball / penalty stroke.** A stroke that adds to the count but puts no new
  dot on the map. Same shape as a mode-2 tally entry, ideally flagged as a
  penalty so the trace reads honestly.
- **Putts you can't place.** On a green too small to aim at, tap the green over
  and over to tally them — positionless strokes again, or near-identical ones.
  Alternatively (or additionally) **let the hole map enlarge/zoom**, which is
  probably worth doing on its own merits.

### The posted score and the trace are two different fields

Per player, per hole, store both:

- `shots: [...]` — the ordered stroke list. The record of *what happened*.
- `score` — the posted number. **Only present when somebody set it by hand.**

The rule is `score ?? shots.length`. Map taps and tally taps append to `shots`
and never touch `score`. Typing a number in the drawer writes `score`.

This is what handles **adjusting the length downward**: the group gives you an 8
after you mapped 12, so `score: 8` gets written and all twelve shots stay exactly
where they are. Nothing is truncated and nothing is overwritten — the trace is a
record, not the source of truth. The drawer can show `8 · mapped 12` and the map
still draws all twelve dots. Same mechanism covers a conceded putt, a "pick it
up, we're done," or anyone just disagreeing with the count.

It also means **there is no "set by hand" flag** — the presence of `score` *is*
the flag. That's the only thing the flag was ever deciding (may the map keep
updating the posted number?), and splitting the fields answers it without a
separate bit to keep in sync.

**Offering the map score.** When `score` is set, `shots` is complete end to end,
and the two disagree, offer the derived count as a one-tap way to replace
`score`. Offer — never apply. Same for clearing `score` to go back to
map-derived.

### What `overridden` / `drifted` mean, and why it's the right precedent

Both live around L1009–L1055 and both hang off `h.via`, which stamps *how a hole's
winner got posted* — `'tap'` (somebody hit RED/HALVE/BLUE) or `'strokes'` (posted
from the entered numbers):

- **`overridden`** — posted by tap, but the entered strokes derive a *different*
  winner. Someone tapped a result the numbers disagree with.
- **`drifted`** — posted *from* the strokes and correct at the time, but a later
  settings change (tee, handicap, rotation) flipped what the numbers now derive.
  The record didn't change; the math underneath it did.

Neither one rewrites anything. They surface as footnotes in `ledgerHtml`
("set by hand — strokes say RED"). **The posted result is sovereign; derivations
annotate, they never overwrite.** That's already the house rule one level up, and
the `score` / `shots` split is the same rule applied one level down.

### Edit history instead of a flag?

They solve different problems and it's worth not conflating them:

- A **flag / provenance stamp** is a *control input* — it decides whether a
  derived value may overwrite a posted one. Needs to be true right now.
- An **edit history** is an *audit log* — who changed what, when, for settling
  arguments. Needs to be durable.

A history *can* serve as the flag (read the latest entry's provenance), but then
correctness depends on log retention and every read becomes a scan. In an app
where every phone writes to a wide-open shared tree and offline queues replay out
of order, the current state should be self-describing on its own.

So: the `score` / `shots` split makes the flag question moot, and a per-player,
per-hole history becomes an optional, separable thing we can add later purely for
disputes. The README already gestures at this ("the derived per-hole ledger is
the audit trail if somebody fat-fingers history") — worth deciding whether that
ledger grows into a real history or stays derived.

### Naming the two ends

Golfers say both **pin** and **flag**; "pin" is the usual one for position ("pin
high", "back pin"), "flagstick" is the Rules term, and the existing code already
calls the graphic `flag` in `holeMapHtml()`. Either reads fine for direction —
**tee → pin** and **pin → tee**.

The end markers themselves should name the *stroke*, not the geography:

- **"in the hole"** for the holing stroke.
- **"tee shot"** for the first one — deliberately not *"drive"*, since you don't
  drive a par 3, and the app very much knows about par 3s (the greenie junk type
  is gated on `h.par === 3`).

Both markers are required in both directions. Forward you tap them last; reverse
you tap "in the hole" first and "tee shot" last. Either way a hole is only
complete once both ends are marked.

### Where it lands in the code (all `index.html`)

- `strokesDrawerHtml()` (~L1723) renders one `qrow` per player — or per team in
  one-ball formats — and every row is always live. There's no selection concept;
  you aim at the right row. Selection would make the drawer one active row plus a
  golfer picker, which also buys back a lot of vertical space in the sun.
- `holeMapHtml()` (~L1585) and the `data-maptap` handler (~L2903) are hardcoded
  to `me = LS.get('id')`. You can only ever mark your own ball, and only one per
  hole. `ballclear` (~L2939) has the same assumption, as does the
  `tap where your ball is` hint.
- `days/<d>/balls/<n>/<pid>` is a single `{x,y}` today. The `shots` list is a
  shape change to live data — worth a migration/back-compat thought (a bare
  `{x,y}` reads as a one-element list).
- Gross scores live separately, at `m.holes[n].strokes[pid]` (see
  `strokesDrawerHtml`, `derivedWinner`), where the value is a number or the
  string `'pickup'`. So the posted `score` half of the model already exists and
  already has a non-numeric state — the new work is the `shots` list beside it
  and the `score ?? shots.length` fallback.
- The map is a plain `width:100%` inline SVG (`.hmap`, ~L452) with no transform,
  so zoom/enlarge is a genuinely new interaction, not a CSS tweak.
- Identity is `LS.get('id')`: a player id, the string `watch`, or `null`. The
  "is the loaded user one of the golfers here" test is `sideIds(m,'A')` /
  `sideIds(m,'B')` membership.

### Still open

- **One-ball formats.** Scramble/foursomes/greensomes/Chapman rows are per team,
  not per player, so "selected golfer" needs a meaning there. Unresolved. Likely
  the team is the selectable unit for the strokes drawer, while the map still
  wants to know which individual actually hit the shot — but that may just be a
  different feature wearing the same hat.
- **Where selection state lives.** Per-match `ui` state vs `LS`. Since it resets
  each hole anyway, `ui` is probably enough; `LS` only buys surviving a reload
  mid-hole.
- **Who may score for whom.** Opening this up matches the no-login honor system,
  but it does mean anyone can enter anyone's strokes. Probably fine; worth being
  deliberate about it rather than sliding into it.
