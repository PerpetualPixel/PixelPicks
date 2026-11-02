# PixelPicks

**https://perpetualpixel.github.io/PixelPicks/** — a mirror of
[perpetualpicks.com](https://perpetualpicks.com), the Perpetual Picks app,
served from this repo's GitHub Pages so it is reachable at the github.io URL
as well as at the custom domain.

- **`/`** — the full site, copied from
  [PerpetualCode](https://github.com/PerpetualPixel/PerpetualCode)'s `docs/`
  on `main` by [`.github/workflows/mirror.yml`](.github/workflows/mirror.yml).
  Same pages, same worker, same data. Sign-ins are per origin, so an account
  signed in on perpetualpicks.com signs in again here (same credentials).
- **`/board/`** — the standalone Pixel's Picks board that used to be this
  repo's whole site: Play of the Day + the day's picks, and the tracked
  record (W–L, units, ROI, CLV) over the worker's public JSON routes. Its
  source is [`board/`](board/); see [PLAN.md](PLAN.md) for how it came to be.
- [`mirror.json`](https://perpetualpixel.github.io/PixelPicks/mirror.json)
  on the live site says which PerpetualCode commit is being served and when
  it was copied.

## No extra API spend

Nothing in this repo calls The Odds API, ESPN or the worker on a schedule.
The mirror is a copy of static files; the pages read the same Cloudflare
worker as perpetualpicks.com, whose odds cache is keyed by sport and market,
not by the visiting page's origin, and whose boards are drawn by its own
cron once a day. A browser on this mirror reads the same cached answer a
browser on the custom domain reads, so moving traffic here does not add
upstream calls. PerpetualCode's scheduled jobs (ESPN bundle, UFC card,
tracking export) are deliberately **not** copied here.

The worker already allows this origin (`https://perpetualpixel.github.io`
is in `ALLOWED_ORIGINS` in PerpetualCode's `worker/wrangler.toml`).

## How the mirror stays current

`mirror.yml` runs every half hour, on a `mirror` repository dispatch, on a
push to this repo's default branch, and by hand (Actions → Mirror
perpetualpicks.com → Run workflow). A scheduled run that finds the live
`mirror.json` already at PerpetualCode's current `main` commit does nothing.

Left out of the copy: `CNAME` (it would claim perpetualpicks.com for this
repo and break both sites) and `sitemap.xml`; `robots.txt` is replaced by one
that keeps the mirror out of search engines, so the custom domain stays the
only indexed copy.

**Faster than half-hourly (optional):** PerpetualCode's
`.github/workflows/mirror-dispatch.yml` pokes this repo on every `docs/`
change to `main` if that repo has a `MIRROR_DISPATCH_TOKEN` secret — a
fine-grained personal access token with *Contents: Read and write* on this
repo. Without it the schedule is the only trigger.

## One-time setup

Settings → Pages → Build and deployment → **Source: GitHub Actions**. The
workflow's first run tries to set this itself; if its Deploy step says
Pages is not configured for Actions, set it there and re-run the workflow.
The old "Deploy from a branch" setting (which served `board/`'s files from
the repo root) is replaced by this.

## Local development

```bash
python3 -m http.server 8080 -d board     # the board alone
```

For the full site, run PerpetualCode's `docs/` the same way. Both origins
(`http://localhost:8080`) are in the worker's `ALLOWED_ORIGINS`.

Everything adjustable in the board lives in [`board/config.js`](board/config.js):
the worker URL, the focus sports pinned to the top, and the $/unit basis.
