# PixelPicks — Plan and Courses of Action

A standalone, low-overhead app that shows the day's Pixel's Picks (3–10 bets),
tracks them daily, and focuses on Tennis, NCAAF and NFL — without re-running
the odds APIs or duplicating any keys.

---

## 1. What exists today (findings from PerpetualCode)

**perpetualpicks.com is a static GitHub Pages site** (PerpetualCode `/docs`).
It holds no data and no keys. Everything lives in the Cloudflare Worker at
`https://pixel-pick-odds.mgbouldering.workers.dev`, which:

- Holds the Odds API key and runs the daily **2am ET cron** that draws the
  board: daily learning review → Play of the Day (slate's #1) → Pixel's Picks
  (the next 5, `TOP5_COUNT = 5` in `worker/src/tracking.js`).
- Grades every pick **hourly** against real scores and snapshots **CLV**
  hourly, storing everything in KV for **90 days**.
- Serves that stored record over **public, read-only, no-auth JSON endpoints**
  that cost **zero odds credits** (KV reads only, edge-cached 5 minutes):

| Endpoint | Returns |
|---|---|
| `GET /top5` | Today's Pixel's Picks board: `{ picks[], leaning[] }` |
| `GET /top5-history` | Every tracked pick, up to 90 days, graded, with CLV |
| `GET /potd` | Today's Play of the Day with full write-up |
| `GET /potd-history` | Graded Play of the Day record |
| `GET /full-slate-history?days=N` | Raw one-pick-per-game record, every sport |
| `GET /learning`, `/algo-health`, `/stale-picks` | Learning + health reports |

**Each tracked pick record already carries everything a card needs**
(`pickRecordFrom()` in `worker/src/tracking.js`): `sportKey`, `home`/`away`,
`marketKey`, `outcomeName`, `point`, `selection`, `american`/`decimal`, `book`,
`score` (confidence), `consensusProb` (model win probability), `stakeUnits` +
`suggested_stake`, `commenceMs`, `status`, `result`, `clv` (open/close
American), `meetsStandard`/`flagReason`, and tennis `tier`.

**The one gate is CORS.** The worker only answers browsers from origins listed
in `ALLOWED_ORIGINS` (`worker/wrangler.toml`, currently
`perpetualpicks.com`, `www.perpetualpicks.com`, `localhost:8080`). Adding the
new app's origin is a one-line change plus a worker redeploy — no key changes,
no new billing.

### Answer to the core question

> "If it's possible to pull from perpetualpicks.com full slate and not have to
> re-run all the APIs and keys, that would be great."

**Yes — but from the worker, not the site.** The site is static; the worker
behind it already publishes the full daily board, the full slate, and 90 days
of graded history as free public JSON. The new app can be a pure reader.

---

## 2. Courses of action

### COA 1 — Thin static client (recommended starting point)

A single-page static app in this repo, deployed on GitHub Pages, that reads
`/top5`, `/potd`, and `/top5-history` and renders nothing else.

- **Today** view: Play of the Day as the hero card + the 5 Pixel's Picks —
  6 tracked bets a day, each with price, best book, stake in units,
  confidence, and the sharp-standard flag.
- **Record** view: W–L, net units, ROI, and CLV computed client-side from
  `/top5-history` (excluding `meetsStandard: false` picks from the summary,
  as the source repo's own convention requires), with 7/30/90-day windows
  and a by-sport breakdown.
- Tennis / NCAAF / NFL shown first and badged; other sports still visible
  below (see §4 on why hard-filtering is a trap).
- No build step, no framework, no backend, no keys. PWA manifest so it
  installs to a phone home screen like the original.

**Effort:** small. **Overhead:** zero (one static page). **New cost:** $0.
**Prerequisite:** add this app's origin to `ALLOWED_ORIGINS` and redeploy the
worker.

**Limits:** the day's count is fixed at 6 (5 + POTD) and the sport mix is
whatever the cross-sport engine chose that morning. Count/mix changes require
touching PerpetualCode.

### COA 2 — Thin client + one composed endpoint in the existing worker

Everything in COA 1, plus one new read-only route in the existing worker
(e.g. `GET /pixel-picks?min=3&max=10`) that composes the day's board from
data the cron already stores: POTD + Pixel's Picks first, then tops up from
the already-tracked full-slate pool by grade — with a sport preference for
tennis/NCAAF/NFL — up to 10, never below 3.

- True **3–10 flexible count**: thin days post 3–6, loaded days post up to 10.
- Sport weighting happens server-side where the whole pool is visible, so the
  focus sports are actually favored rather than just sorted first.
- Still one cron, one key, one tracked record — the new route only reads KV.

**Effort:** moderate (one route + selection function + tests in
PerpetualCode). **Overhead:** near zero ongoing. **New cost:** $0.

### COA 3 — Fully independent pipeline

Copy `engine.js` and stand up a second worker with its own Odds API key, own
cron, own KV tracking, tuned to 3–10 picks across tennis/NCAAF/NFL only.

- Full control of count, sports, and price bands without touching
  PerpetualCode.
- **But:** a second API subscription, a second cron/grading/CLV stack to
  babysit, and a second tracked record that will drift from the main site's.
  This is exactly the overhead the project is trying to shed.

**Effort:** large. **Overhead:** the highest. Only worth it if PixelPicks
must diverge from the main engine's philosophy (different markets, props,
its own learning loop).

### Recommendation

**Start with COA 1, graduate to COA 2.** COA 1 ships a clean 6-pick board
with real daily tracking in a day, on zero new infrastructure. COA 2 is the
right home for the two things COA 1 can't do — the flexible 3–10 count and
genuine tennis/NCAAF/NFL weighting — and it's a single route in the worker,
not a new system. COA 3 is not recommended.

---

## 3. Getting from "5 picks" to "3 to 10"

Today's board is exactly 5 + 1 POTD. Three levers, cheapest first:

1. **Show POTD + Pixel's Picks together** → a 6-bet board, available now
   (COA 1).
2. **The composed endpoint** (COA 2) → true 3–10, sized by how much edge the
   day actually offers, drawing from picks the worker already tracks.
3. **Raise `TOP5_COUNT` in PerpetualCode** → changes the main site too, and
   the file itself warns the name/count are load-bearing across KV keys and
   call sites. Not recommended as the first move.

## 4. The sport-focus trade-off (read before choosing "filter")

Picks are drawn cross-sport by grade. On a Tuesday in March there may be no
NCAAF/NFL at all and thin tennis — a hard filter to three sports can render
an empty board, and an empty board kills a daily-habit app. Options:

- **Badge-and-sort** (COA 1 default): focus sports pinned on top, everything
  else still shown. The board is never empty; the focus is visual.
- **Server-side weighting** (COA 2): focus sports win ties and get a scoring
  nudge, other sports fill remaining slots. Best of both.
- **Hard filter**: only acceptable with a visible "no qualifying
  tennis/NCAAF/NFL edge today" state — never a silent empty page.

In-season (Sep–Jan), NFL + NCAAF + tennis will dominate the board naturally;
the engine already favors whatever has the most liquid markets.

## 5. MVP build plan (COA 1)

1. **Worker config** (PerpetualCode, one line): add the Pages origin
   (`https://perpetualpixel.github.io` or a custom subdomain like
   `https://picks.perpetualpicks.com`) to `ALLOWED_ORIGINS` in
   `worker/wrangler.toml`; `wrangler deploy`.
2. **App shell** (this repo): `index.html` + `styles.css` + `app.js`,
   vanilla JS, two tabs (Today / Record), dark theme, PWA manifest.
3. **Today tab**: fetch `/potd` + `/top5` in parallel; render hero + cards;
   show `leaning` entries (pre-2am-ET slots) as "leaning" with a distinct
   style; flag `meetsStandard: false` picks exactly as the source does.
4. **Record tab**: fetch `/top5-history`; compute W–L, net units
   (`stakeUnits` × result), ROI, and average CLV client-side; 7/30/90-day
   windows; per-sport rows with tennis/NCAAF/NFL first.
5. **Deploy**: enable GitHub Pages on this repo; optionally point a
   `picks.` subdomain at it (CNAME) — a subdomain also keeps CORS tidy.
6. **Later (COA 2)**: add the composed `/pixel-picks` endpoint to
   PerpetualCode and switch the Today tab to it — the client change is one
   URL.

## 6. Decisions to make

| Decision | Options | Suggested default |
|---|---|---|
| Course of action | COA 1 / 2 / 3 | COA 1 now, COA 2 next |
| Hosting origin | `perpetualpixel.github.io/PixelPicks` vs `picks.perpetualpicks.com` | Subdomain (cleaner URL + CORS) |
| Sport focus behavior | badge-and-sort / weighted / hard filter | Badge-and-sort until COA 2 |
| Daily count | 6 (now) vs 3–10 (COA 2) | 6 now; 3–10 with COA 2 |
| POTD placement | Hero card vs just another pick | Hero card |
