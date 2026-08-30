# Ideas

Parking lot for things we want but haven't built. Newest at the top. Nothing
here is a commitment; it's here so it doesn't get lost between trips.

---

## Select a golfer, then score for them — three ways to count a hole

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

### Map score vs. hand-entered score

- The dot/stroke count **feeds the drawer score** by default.
- Unless the drawer score was **modified directly** — a hand-entered number wins
  and stops being overwritten. (Needs a per-player, per-hole "set by hand" flag,
  same spirit as the existing `overridden()` / `drifted()` ledger notes.)
- If someone hand-enters a score and *then* maps the hole, and the map disagrees,
  **offer the map-derived score** as a one-tap way to set the official score —
  but only once the hole is **completely mapped**.

### Knowing the hole is completely mapped

This is the load-bearing bit and it's asymmetric between the two directions:

- **Forward:** you need a way to mark that a stroke **went in the hole**. The
  last tap needs to say "this one was the holed putt," or there's a separate
  "in the hole" action. Without it we can never tell a finished hole from a hole
  you stopped tracking halfway up the fairway.
- **Reverse:** the *first* tap is the holed stroke, which is free — but the
  completion signal is now "I've reached the tee shot," which is fuzzier. Likely
  needs its own explicit marker ("that was the drive") rather than being inferred.

Either way, only a hole marked complete on both ends is allowed to offer its
count as the official score.

### Where it lands in the code (all `index.html`)

- `strokesDrawerHtml()` (~L1723) renders one `qrow` per player — or per team in
  one-ball formats — and every row is always live. There's no selection concept;
  you aim at the right row. Selection would make the drawer one active row plus a
  golfer picker, which also buys back a lot of vertical space in the sun.
- `holeMapHtml()` (~L1585) and the `data-maptap` handler (~L2903) are hardcoded
  to `me = LS.get('id')`. You can only ever mark your own ball, and only one per
  hole. `ballclear` (~L2939) has the same assumption, as does the
  `tap where your ball is` hint.
- `days/<d>/balls/<n>/<pid>` is a single `{x,y}` today. The ordered-stroke-list
  model is a shape change to live data — worth a migration/back-compat thought
  (a bare `{x,y}` reads as a one-element list).
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
