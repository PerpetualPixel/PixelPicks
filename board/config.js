/**
 * PixelPicks configuration.
 *
 * WORKER_URL points at the existing PerpetualCode Cloudflare Worker — the
 * same one behind perpetualpicks.com. This app only ever calls its public,
 * read-only, KV-backed routes (/potd, /top5, /top5-history, /potd-history),
 * which burn zero odds credits. No API keys live anywhere in this repo.
 *
 * The worker answers browsers only from origins listed in its
 * ALLOWED_ORIGINS (PerpetualCode: worker/wrangler.toml) — this app's origin
 * (https://perpetualpixel.github.io) must be in that list or every fetch
 * fails CORS. See README.md.
 */
export const CONFIG = {
  WORKER_URL: 'https://pixel-pick-odds.mgbouldering.workers.dev',

  // Sports pinned to the top of the board and listed first in the Record
  // tab. Matched against each pick's sportKey by sportGroup() in app.js —
  // 'tennis' covers every ATP/WTA tournament key.
  FOCUS_SPORTS: ['NFL', 'NCAAF', 'ATP', 'WTA'],

  // The tracked record's accounting basis, mirroring the worker's
  // UNIT_DOLLARS. Only a fallback — each pick's own suggested_stake /
  // stakeUnits ratio is preferred when both are present.
  UNIT_DOLLARS: 25,
};
