# PixelPicks

A standalone, low-overhead board for the day's Pixel's Picks — the daily
tracked bets, one board, no noise — with a focus on Tennis, NCAAF and NFL.

**Live at:** https://perpetualpixel.github.io/PixelPicks/

Data comes from the existing PerpetualCode Cloudflare Worker (the same one
behind [perpetualpicks.com](https://perpetualpicks.com)) via its public
read-only JSON routes — `/potd`, `/top5`, `/top5-history`, `/potd-history`.
No API keys, no odds credits, no backend, no build step in this repo.

- **Today** — Play of the Day hero + the day's Pixel's Picks, with price,
  best book, stake in units, confidence, and live graded status. Slots not
  locked yet (before ~2am ET) show as "leaning."
- **Record** — W–L, net units, ROI and average CLV over 7/30/90 days,
  by-sport breakdown, and a day-by-day history. Flagged fallback picks are
  shown but excluded from the headline math, matching the source repo's own
  convention.

See [PLAN.md](PLAN.md) for the architecture and courses of action.

## Deploying

1. **Allow this origin on the worker** (one line in PerpetualCode):
   in `worker/wrangler.toml`, add `https://perpetualpixel.github.io` to
   `ALLOWED_ORIGINS`, then `wrangler deploy` from `worker/`. Until this is
   done, every fetch from the live page fails CORS and the app shows an
   error box saying exactly that.
2. **Enable GitHub Pages** on this repo: Settings → Pages → Source: “Deploy
   from a branch”, pick the default branch, folder `/ (root)`. The site
   appears at https://perpetualpixel.github.io/PixelPicks/ a minute later.
3. On a phone, open it and tap **Share → Add to Home Screen** — it installs
   and runs full-screen like the original app.

## Local development

Any static server works:

```bash
python3 -m http.server 8080
```

`http://localhost:8080` is already in the worker's `ALLOWED_ORIGINS`, so
local development gets live data with no extra setup.

## Configuration

Everything adjustable lives in [`config.js`](config.js): the worker URL, the
focus sports pinned to the top of the board, and the $/unit accounting basis.
