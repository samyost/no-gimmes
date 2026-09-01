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
- **Scoring**: tap **RED / HALVE / BLUE** for each hole — or open the
  **STROKES** drawer and enter gross scores; the app applies net strokes and
  lights up the derived winner for you to confirm. Mix both freely. Tap any
  hole in the rail to fix it; nothing ever locks.
- **Shot by shot**: pick a golfer (you, by default), then tap the hole map
  where each shot finished — or **+1** for one you can't place — and **IN THE
  HOLE** when it drops. The count becomes that golfer's gross score unless
  somebody types a number over it; the trace stays either way. Lost track?
  Tap **IN THE HOLE** first and replay the hole backwards to the tee.
- **The board**: pinned cup score with the tug-of-war bar and the magic number,
  day tabs (opens to today), live match chips (`2UP · THRU 12`, `DORMIE`,
  `4&3 ✓`), tee times and carts.
- **Setup** (gear): per-day attendance (4–8 players), per-day team draws (Red
  and Blue are permanent; membership can change daily), carts → two tee times,
  cart-vs-cart match maker, formats (four-ball, foursomes, greensomes, Chapman,
  scramble, shamble, singles, mixer — a different game every few holes, with
  the rotations built as named mixes in a shared library, not tied to any day,
  and each mixer day picking one), gross/net with editable WHS allowances, points
  per match, double singles, gimme policy, tie rule, junk dots, skins.
- **Offline**: scores save on the phone instantly and sync when signal returns
  (the pill in the corner tells the truth: `LIVE` / `3 QUEUED`).

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

## Development

```
node dev/engine.test.mjs   # unit tests for the scoring engine
node dev/features.test.mjs # mixer / mix library / side-bet browser tests (needs: cd dev && npm i)
node dev/sync.test.mjs     # two-browser integration tests (needs: cd dev && npm i)
node dev/mock-rtdb.js      # local Firebase RTDB imitation (REST + SSE)
```

The scoring engine ships inline in `index.html` between `ENGINE` markers;
`dev/engine-draft.js` is the standalone draft, and the test runner prefers the
copy inside `index.html` so the shipped code is what's tested.
