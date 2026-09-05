# No Gimmes

A phone-first web app for running a Ryder-Cup-style golf weekend: set up teams,
carts, and matches in minutes, score on the course with one thumb in bright sun,
and watch the red/blue cup race update live on every phone. No logins, no
accounts, no app store — one link.

Built for the Sept 4–7, 2026 Summit County trip (Vail GC · Breckenridge ·
Keystone), but every date, course, roster, and rule is editable in the app.

## Going live (one time, ~2 minutes)

The app is a single file, `index.html`, meant for GitHub Pages:

1. Merge this branch into `main`.
2. On GitHub: **Settings → Pages → Source: Deploy from a branch → `main` /
   `/ (root)` → Save.**
3. Your app is at `https://<user>.github.io/no-gimmes/` a minute later.

Shared storage is a Firebase Realtime Database, already baked in
(`https://no-gimmes-default-rtdb.firebaseio.com` — see `CONFIG` at the top of
`index.html`). Nothing else to deploy. To point at a different database, edit
that constant, or open the app → gear → *Extras & data* → paste a URL, or share
a link with `?db=<url>`.

**Smoke test after deploy:** open the link on two phones, enter a score on one,
watch it appear on the other. That's the whole stack verified.

## How it works on the trip

- **First open**: "Who are you?" — tap your name. That phone remembers you and
  opens straight to your own match on game days.
- **Scoring**: one row at the bottom of every hole — tap **RED / HALVE /
  BLUE** and the app moves to the next hole. Gross scores live behind the
  small **SCORES** toggle above that row; enter them and the app applies net
  strokes and lights up the derived winner for you to confirm. Mix both
  freely. Tap any hole in the rail to fix it; nothing ever locks.
- **Shot by shot**: pick a golfer (you, by default), then tap the hole map
  where each shot stopped, tee to pin — **+1 SHOT** for one you can't place.
  A tap on the flag is a putt that stayed out; the **⛳ IN** button right
  beside the flag is the one that dropped. The count becomes
  that golfer's gross score unless somebody types a number over it under
  **SCORES**; the trace stays either way. Lost track? Just type the number.
- **The board**: pinned cup score with the tug-of-war bar and the magic number,
  live match chips (`2UP · THRU 12`, `DORMIE`, `4&3 ✓`), tee times and carts.
  It opens to today; the day pill under the cup score switches days.
- **Setup** (the ⚙ top-right, on every screen): per-day attendance (4–8 players), per-day team draws (Red
  and Blue are permanent; membership can change daily), carts → two tee times,
  cart-vs-cart match maker, formats (four-ball, foursomes, greensomes, Chapman,
  scramble, shamble, singles, mixer — a different game every few holes, with
  the rotations built as named mixes in a shared library, not tied to any day,
  and each mixer day picking one), gross/net with editable WHS allowances, points
  per match, double singles, gimme policy, tie rule, junk dots, skins.
- **Offline**: scores save on the phone instantly and sync when signal returns
  (the pill in the corner tells the truth: `LIVE` / `3 QUEUED`).
- **Over / under** (gear → *Side action*): its own page, its own game, one per
  day. Every player gets a line on their gross score for the round; anyone sets
  it, anyone bets over or under it, up to the max per bet in Settings ($10 by
  default). One rule: you can't take the over on yourself. Even money against
  the book. The score fills in from the card once all 18 gross scores are
  posted, or type the total; the day's book and the trip total settle
  underneath. *Bets by* (or a tap on anyone in the book) lists every bet one
  person has placed across the trip — what's riding, what settled, tap to
  change or pull. Handicaps, the cup, and the match screens never see any of it.

## Honesty box

Anyone with the link can read *and write* everything — that's the no-login
trade. The database rules are wide open on purpose; don't reuse it for anything
you care about, and don't post the link publicly. The derived per-hole ledger
is the audit trail if somebody fat-fingers history.

## Course data

Verified scorecards (par, stroke index, yardages, ratings/slopes) are embedded
for **Vail Golf Club**, **Breckenridge Golf Club** (all three nines — Beaver,
Bear, Elk — with per-rotation handicap allocation as printed on the actual
cards), **The River Course at Keystone**, and **Keystone Ranch**. The
Bear→Elk rotation has no printed card anywhere we could find, so its stroke
allocation is derived from the other two cards (the app says so in the UI).
A minimal custom-course card covers everywhere else.

Lo-fi **hole maps** — fairway, rough, green, tees, bunkers, water, and the
playing line — are traced from OpenStreetMap for Vail, Willis Case,
Breckenridge (all 27 holes), The River Course, and Keystone Ranch. They render
above the scoring buttons and double as the tap surface for ball marks.

Two wrinkles worth knowing about. Keystone's two courses sit close enough that
one Overpass bounding box catches a few of the neighbour's holes under a hole
number it already owns — River's file carries Ranch 1 and 2, Ranch's carries
River 16 and 17 — so the builder keeps whichever line sits with the rest of the
course and records the OSM way it kept.

The other is Breckenridge. OSM has centerlines for only two of its three nines;
measured against the printed cards those two are Beaver (holes 1-9) and Bear
(10-18). Someone later traced Elk's greens, tees, fairways and bunkers but
never drew its hole lines, so `dev/osm/derive-elk.mjs` reconstructs them: the
features left over once Beaver, Bear and the practice ground are accounted for
are Elk's — and they come to exactly nine greens — then a search assigns each
green and tee complex to a hole number by fitting the printed Elk card and the
walk between holes, and threads each line through its fairway so doglegs bend
the right way. The result averages 13.8 yards off the card and is never worse
than 31 on any hole; the runner-up routing averages 25.9 and needs a 311-yard
walk between two holes. For comparison, OSM's own Beaver and Bear lines are up
to 97 yards off the Gold column, because a few were traced from a forward tee.
`dev/osm/breck.elk.json` is the committed result; rerunning the script reprints
the card-versus-built table and warns if either margin erodes.

## Development

```
node dev/engine.test.mjs   # unit tests for the scoring engine
node dev/features.test.mjs # mixer / mix library / side-bet browser tests (needs: cd dev && npm i)
node dev/sync.test.mjs     # two-browser integration tests (needs: cd dev && npm i)
node dev/maps.test.mjs     # hole maps / ball marks / hole notes (needs: cd dev && npm i)
node dev/ou.test.mjs       # over/under lines, bets, the max, settlement (needs: cd dev && npm i)
node dev/mock-rtdb.js      # local Firebase RTDB imitation (REST + SSE)
```

Hole maps are built offline and embedded, so the app fetches nothing at play
time. Overpass is only reachable from the `osm-fetch` GitHub Action; the rest
runs anywhere:

```
node dev/osm/fetch.mjs          # refresh dev/osm/<key>.json from Overpass (CI only)
node dev/osm/derive-elk.mjs     # rebuild Breckenridge's missing Elk centerlines
node dev/osm/build-maps.mjs <k> # <key>.json -> <key>.maps.json (SVG path data)
node dev/osm/embed.mjs <k>      # splice that into index.html as HOLEMAPS.<key>
```

The scoring engine ships inline in `index.html` between `ENGINE` markers;
`dev/engine-draft.js` is the standalone draft, and the test runner prefers the
copy inside `index.html` so the shipped code is what's tested.
