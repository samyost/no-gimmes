# Ideas

Parking lot for things we want but haven't built. Newest at the top. Nothing
here is a commitment; it's here so it doesn't get lost between trips.

---

## Select a golfer, then score for them (strokes + map)

**The idea.** When you open the scoring interface for a hole, there should be a
notion of *whose* strokes you're entering. If the phone's loaded identity is one
of the golfers in this match, that golfer starts out selected — visibly
highlighted, the way a picked chip looks. You can deselect yourself and select
somebody else, enter their strokes or drop their ball positions, then hand the
selection back. If the person holding the phone isn't one of the golfers in the
match (a spectator, `watch` mode, or a player in a different match), nothing is
selected by default.

The map half of this is the part we can't do at all today, and it's the reason
the idea exists: tapping the hole map should place a ball for the *selected*
golfer, one tap per stroke, so a hole ends up with a shot-by-shot trace rather
than a single dot.

**Where it lands in the code** (all `index.html`):

- `strokesDrawerHtml()` (~L1723) renders one `qrow` per player — or per team in
  one-ball formats — and every row is always live. There's no selection concept;
  you aim at the right row. Selection would make the drawer one active row plus a
  golfer picker, which also buys back a lot of vertical space in the sun.
- `holeMapHtml()` (~L1585) and the `data-maptap` handler (~L2903) are hardcoded
  to `me = LS.get('id')`. You can only ever mark your own ball, and only one per
  hole. `ballclear` (~L2939) has the same assumption, as does the
  `tap where your ball is` hint.
- Identity is `LS.get('id')`: a player id, the string `watch`, or `null`. The
  "is the loaded user one of the golfers here" test is `sideIds(m,'A')` /
  `sideIds(m,'B')` membership.

**Open questions to settle before building:**

- *Data model for multi-shot.* `days/<d>/balls/<n>/<pid>` is a single `{x,y}`
  today. Per-stroke tracing needs an ordered list, which is a shape change to
  live data. Worth deciding whether the number of dots and the gross score in
  the drawer are the same number (auto-fill each other) or stay independent.
- *Where selection lives.* Per-match `ui` state (resets on reload) or `LS`
  (survives a phone locking in a cart pocket). Probably `LS`, keyed per match.
- *Whether selection persists across holes* as you advance, or resets to the
  loaded user each hole.
- *One-ball formats.* Scramble/foursomes/greensomes/Chapman rows are per team,
  not per player, so "selected golfer" needs a meaning there — likely the team is
  the selectable unit for strokes, while the map still wants individuals.
- *Who may score for whom.* Opening this up matches the no-login honor system,
  but it does mean anyone can enter anyone's strokes. Probably fine; worth being
  deliberate about it rather than sliding into it.
