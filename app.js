/**
 * PixelPicks — a thin read-only client over the PerpetualCode worker.
 *
 * Two views:
 *   Today  — GET /potd + /top5: the day's board (POTD hero + Pixel's Picks,
 *            plus "leaning" previews for any slot not locked yet).
 *   Record — GET /top5-history + /potd-history: W-L, net units, ROI and CLV
 *            computed client-side, 7/30/90-day windows, by-sport breakdown.
 *
 * All math mirrors the source repo's own conventions (docs/learning.js
 * summarizePicks, docs/app.js top5ClvPct): voids are settled-but-not-money,
 * flagged fallback picks (meetsStandard === false) never count toward the
 * headline record but stay visible in the day-by-day history.
 */
import { CONFIG } from './config.js';

const $ = (sel) => document.querySelector(sel);

/* ---------------- formatting + math helpers ---------------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtAmerican(a) {
  if (a == null || !Number.isFinite(Number(a))) return '—';
  return Number(a) > 0 ? `+${a}` : `${a}`;
}

function impliedProb(american) {
  const a = Number(american);
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? 100 / (a + 100) : -a / (-a + 100);
}

/** CLV%, positive means the tracked price beat the close — same math as the source app. */
function clvPct(pick) {
  if (!pick.clv) return null;
  const open = impliedProb(pick.clv.openAmerican);
  const close = impliedProb(pick.clv.closeAmerican);
  if (open == null || close == null) return null;
  return (close - open) * 100;
}

/** Sport group label from a sportKey. */
function sportGroup(key = '') {
  if (key.startsWith('americanfootball_nfl')) return 'NFL';
  if (key === 'americanfootball_ncaaf') return 'NCAAF';
  if (key.startsWith('americanfootball')) return 'Football';
  if (key.startsWith('tennis_atp')) return 'ATP';
  if (key.startsWith('tennis_wta')) return 'WTA';
  if (key.startsWith('tennis')) return 'Tennis';
  if (key === 'baseball_mlb') return 'MLB';
  if (key === 'basketball_nba') return 'NBA';
  if (key === 'basketball_wnba') return 'WNBA';
  if (key === 'icehockey_nhl') return 'NHL';
  if (key.startsWith('mma')) return 'MMA';
  if (key.startsWith('soccer')) return 'Soccer';
  const tail = key.split('_').pop();
  return tail ? tail.toUpperCase() : 'Other';
}

function isFocus(pick) {
  return CONFIG.FOCUS_SPORTS.includes(sportGroup(pick.sportKey));
}

function isTennisKey(key = '') {
  return key.startsWith('tennis');
}

function matchupText(pick) {
  const joiner = isTennisKey(pick.sportKey) || (pick.sportKey ?? '').startsWith('mma') ? 'vs' : '@';
  return `${pick.away} ${joiner} ${pick.home}`;
}

/** Dollar value of one unit for this pick; falls back to the global basis. */
function unitDollars(pick) {
  if (pick.stakeUnits > 0 && pick.suggested_stake > 0) return pick.suggested_stake / pick.stakeUnits;
  return CONFIG.UNIT_DOLLARS;
}

function netUnits(pick) {
  const payout = pick.result?.payout;
  if (payout == null) return 0;
  return payout / unitDollars(pick);
}

function fmtUnits(u, { sign = false } = {}) {
  const rounded = Math.round(u * 100) / 100;
  const body = `${Math.abs(rounded) % 1 === 0 ? Math.abs(rounded) : Math.abs(rounded).toFixed(2)}U`;
  if (!sign) return body;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${body}`;
}

function fmtStartTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString([], {
    weekday: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function fmtDayKey(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Today's date key in ET minus `daysBack`, matching the worker's own day bucketing. */
function etDateKey(daysBack = 0) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() - daysBack * 86400000));
}

function statusOf(pick) {
  if (pick.status === 'won' || pick.status === 'lost' || pick.status === 'pending') return pick.status;
  return 'void'; // void, retracted, or anything else settled-but-not-money
}

function statusPill(pick) {
  const s = statusOf(pick);
  if (s === 'won') return '<span class="pill pill-won">Won</span>';
  if (s === 'lost') return '<span class="pill pill-lost">Lost</span>';
  if (s === 'void') return '<span class="pill pill-void">Void</span>';
  return '<span class="pill pill-pending">Pending</span>';
}

function sportPill(pick) {
  const focus = isFocus(pick) ? ' is-focus' : '';
  return `<span class="pill pill-sport${focus}">${esc(sportGroup(pick.sportKey))}</span>`;
}

/* ---------------- data access ---------------- */

async function getJson(path) {
  const res = await fetch(`${CONFIG.WORKER_URL}${path}`);
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json();
}

function corsHint(err) {
  return `
    <b>Couldn’t reach the picks worker.</b> (${esc(err.message)})<br>
    If this keeps happening, this app’s origin (<code>${esc(location.origin)}</code>)
    is probably missing from the worker’s <code>ALLOWED_ORIGINS</code>
    (PerpetualCode → <code>worker/wrangler.toml</code>) — add it and redeploy the worker.`;
}

/* ---------------- Today ---------------- */

function pickCard(pick, { lean = false } = {}) {
  const s = statusOf(pick);
  const flagged = pick.meetsStandard === false;
  const resultLine = s === 'won' || s === 'lost'
    ? `<div class="result-line">Net <b class="${netUnits(pick) >= 0 ? 'pos' : 'neg'}">${fmtUnits(netUnits(pick), { sign: true })}</b>${pick.result?.detail ? ` · ${esc(pick.result.detail)}` : ''}</div>`
    : s === 'void'
      ? `<div class="result-line">Voided${pick.result?.voidReason ? ` — ${esc(pick.result.voidReason)}` : ''} · stake returned</div>`
      : '';
  return `
    <article class="card${lean ? ' is-lean' : ''}">
      <div class="card-top">
        ${sportPill(pick)}
        ${lean ? '<span class="pill pill-lean">Leaning</span>' : statusPill(pick)}
        <span class="spacer"></span>
        <span class="card-time">${esc(fmtStartTime(pick.commenceMs))}</span>
      </div>
      <div class="matchup">${esc(matchupText(pick))}</div>
      <div class="selection">${esc(pick.selection)} <span class="price">${esc(fmtAmerican(pick.american))}</span></div>
      <div class="meta-row">
        <span>Stake <b>${fmtUnits(pick.stakeUnits ?? 1)}</b></span>
        <span>Confidence <b>${Math.round(pick.score ?? 0)}</b></span>
        ${pick.book ? `<span>Best price <b>${esc(pick.book)}</b></span>` : ''}
      </div>
      ${flagged ? `<div class="flag-note">⚠ Outside the sharp standard${pick.flagReason ? ` — ${esc(pick.flagReason)}` : ''}</div>` : ''}
      ${resultLine}
    </article>`;
}

function writeupHtml(writeup) {
  if (!writeup) return '';
  const parts = [];
  if (writeup.analysis) parts.push(`<p>${esc(writeup.analysis)}</p>`);
  for (const section of writeup.sections ?? []) {
    const bullets = (section.bullets ?? [])
      .map((b) => `<li>${esc(typeof b === 'string' ? b : b?.text ?? '')}</li>`)
      .join('');
    if (bullets) parts.push(`<h3>${esc(section.title)}</h3><ul>${bullets}</ul>`);
  }
  if (writeup.devilsAdvocate) parts.push(`<h3>Devil’s advocate</h3><p>${esc(writeup.devilsAdvocate)}</p>`);
  if (!parts.length) return '';
  return `<details><summary>Full write-up</summary><div class="writeup">${parts.join('')}</div></details>`;
}

function renderPotd(payload) {
  const slot = $('#potdSlot');
  const record = payload?.potd;
  if (!record?.pick) {
    if (payload?.leaning) {
      slot.innerHTML = `
        <div class="hero">
          <div class="hero-label">Play of the Day <span class="pill pill-lean">Leaning</span></div>
          ${pickCard(payload.leaning, { lean: true })}
          <p class="hero-headline">Today’s pick locks around 2am ET — this is where the board is leaning.</p>
        </div>`;
    } else {
      slot.innerHTML = '';
    }
    return;
  }
  const { pick, writeup, stale } = record;
  const headline = writeup?.headline ? `<p class="hero-headline">${esc(writeup.headline)}</p>` : '';
  const quickTake = writeup?.reasons ? `<p class="hero-headline">${esc(writeup.reasons)}</p>` : '';
  slot.innerHTML = `
    <div class="hero">
      <div class="hero-label">Play of the Day ${stale ? '<span class="pill pill-lean">Yesterday’s — today posts ~2am ET</span>' : ''}</div>
      ${pickCard(pick)}
      ${headline}
      ${quickTake}
      ${writeupHtml(writeup)}
    </div>`;
}

function renderPicks(payload) {
  const slot = $('#picksSlot');
  const picks = payload?.picks ?? [];
  const leaning = payload?.leaning ?? [];
  if (!picks.length && !leaning.length) {
    slot.innerHTML = '<div class="empty">No picks on the board yet — the day’s board posts around 2am ET.</div>';
    return;
  }
  // Badge-and-sort: focus sports pinned first, otherwise the server's own order.
  const ordered = picks
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (isFocus(b.p) - isFocus(a.p)) || (a.i - b.i))
    .map(({ p }) => p);
  const settled = picks.filter((p) => statusOf(p) !== 'pending');
  const wins = settled.filter((p) => statusOf(p) === 'won').length;
  const losses = settled.filter((p) => statusOf(p) === 'lost').length;
  const soFar = settled.length ? ` · ${wins}–${losses} so far today` : '';
  slot.innerHTML = `
    <div class="section-title">Pixel’s Picks — ${picks.length} pick${picks.length === 1 ? '' : 's'}${soFar}</div>
    ${ordered.map((p) => pickCard(p)).join('')}
    ${leaning.length ? `
      <div class="section-title">Leaning — not locked yet</div>
      ${leaning.map((p) => pickCard(p, { lean: true })).join('')}` : ''}`;
}

async function loadToday() {
  const loading = $('#todayLoading');
  const errBox = $('#todayError');
  errBox.hidden = true;
  loading.hidden = false;
  try {
    const [potd, top5] = await Promise.all([getJson('/potd'), getJson('/top5')]);
    renderPotd(potd);
    renderPicks(top5);
    const status = $('#todayStatus');
    status.textContent = `Board for ${fmtDayKey(top5?.picks?.[0]?.dateKey ?? etDateKey())} · updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    status.hidden = false;
  } catch (err) {
    errBox.innerHTML = corsHint(err);
    errBox.hidden = false;
  } finally {
    loading.hidden = true;
  }
}

/* ---------------- Record ---------------- */

const recordState = {
  days: 30,
  board: 'all',
  top5: null,
  potd: null,
};

/** Same buckets as the source repo's summarizePicks. */
function summarize(picks) {
  const settled = picks.filter((p) => statusOf(p) !== 'pending');
  const voided = settled.filter((p) => statusOf(p) === 'void');
  const graded = settled.filter((p) => statusOf(p) !== 'void');
  const wins = graded.filter((p) => statusOf(p) === 'won').length;
  const losses = graded.length - wins;
  const staked = graded.reduce((sum, p) => sum + (p.suggested_stake ?? 0), 0);
  const net = graded.reduce((sum, p) => sum + (p.result?.payout ?? 0), 0);
  const units = graded.reduce((sum, p) => sum + netUnits(p), 0);
  const clvValues = picks.map(clvPct).filter((v) => v != null);
  return {
    total: picks.length,
    pending: picks.length - settled.length,
    voided: voided.length,
    graded: graded.length,
    wins,
    losses,
    staked,
    net,
    units,
    roi: staked ? (net / staked) * 100 : 0,
    winRate: graded.length ? (wins / graded.length) * 100 : 0,
    avgClv: clvValues.length ? clvValues.reduce((a, b) => a + b, 0) / clvValues.length : null,
  };
}

function windowedPicks() {
  const cutoff = etDateKey(recordState.days - 1);
  const top5 = (recordState.top5 ?? []).map((p) => ({ ...p, board: 'picks' }));
  const potd = (recordState.potd ?? []).map((p) => ({ ...(p.pick ?? p), board: 'potd' }));
  let all = [...top5, ...potd].filter((p) => p.dateKey >= cutoff);
  if (recordState.board !== 'all') all = all.filter((p) => p.board === recordState.board);
  return all;
}

function renderRecord() {
  if (!recordState.top5 && !recordState.potd) return;
  const all = windowedPicks();
  const standard = all.filter((p) => p.meetsStandard !== false);
  const flaggedCount = all.length - standard.length;
  const s = summarize(standard);

  const signClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  $('#recordSummary').innerHTML = all.length ? `
    <div class="tiles">
      <div class="tile">
        <div class="k">Record</div>
        <div class="v">${s.wins}–${s.losses}</div>
        <div class="sub">${s.voided ? `${s.voided} void · ` : ''}${s.pending} pending</div>
      </div>
      <div class="tile">
        <div class="k">Win rate</div>
        <div class="v">${s.graded ? `${s.winRate.toFixed(0)}%` : '—'}</div>
        <div class="sub">${s.graded} graded</div>
      </div>
      <div class="tile">
        <div class="k">Net</div>
        <div class="v ${signClass(s.units)}">${fmtUnits(s.units, { sign: true })}</div>
        <div class="sub">$${s.net.toFixed(0)} at $${CONFIG.UNIT_DOLLARS}/U</div>
      </div>
      <div class="tile">
        <div class="k">ROI</div>
        <div class="v ${signClass(s.roi)}">${s.graded ? `${s.roi > 0 ? '+' : ''}${s.roi.toFixed(1)}%` : '—'}</div>
        <div class="sub">on $${s.staked.toFixed(0)} staked</div>
      </div>
      <div class="tile">
        <div class="k">Avg CLV</div>
        <div class="v ${signClass(s.avgClv ?? 0)}">${s.avgClv == null ? '—' : `${s.avgClv > 0 ? '+' : ''}${s.avgClv.toFixed(1)}%`}</div>
        <div class="sub">price vs close</div>
      </div>
    </div>
    <div class="note-line">Headline record covers standard picks only${flaggedCount ? ` — ${flaggedCount} flagged fallback pick${flaggedCount === 1 ? '' : 's'} excluded from the math but shown in the history below` : ''}.</div>
  ` : '<div class="empty">No tracked picks in this window yet.</div>';

  renderBySport(standard);
  renderDays(all);
}

function renderBySport(picks) {
  const bySport = new Map();
  for (const p of picks) {
    const g = sportGroup(p.sportKey);
    if (!bySport.has(g)) bySport.set(g, []);
    bySport.get(g).push(p);
  }
  const rows = [...bySport.entries()]
    .map(([sport, sportPicks]) => ({ sport, s: summarize(sportPicks), focus: CONFIG.FOCUS_SPORTS.includes(sport) }))
    .filter((r) => r.s.graded > 0 || r.s.pending > 0)
    .sort((a, b) => (b.focus - a.focus) || (b.s.graded - a.s.graded));
  if (!rows.length) { $('#recordBySport').innerHTML = ''; return; }
  $('#recordBySport').innerHTML = `
    <div class="section-title">By sport</div>
    <table class="sport-table">
      <thead><tr><th>Sport</th><th class="num">Record</th><th class="num">Net</th><th class="num">ROI</th></tr></thead>
      <tbody>
        ${rows.map(({ sport, s, focus }) => `
          <tr>
            <td><span class="pill pill-sport${focus ? ' is-focus' : ''}">${esc(sport)}</span></td>
            <td class="num">${s.wins}–${s.losses}${s.pending ? ` <small>(${s.pending}p)</small>` : ''}</td>
            <td class="num ${s.units > 0 ? 'pos' : s.units < 0 ? 'neg' : ''}">${fmtUnits(s.units, { sign: true })}</td>
            <td class="num ${s.roi > 0 ? 'pos' : s.roi < 0 ? 'neg' : ''}">${s.graded ? `${s.roi > 0 ? '+' : ''}${s.roi.toFixed(0)}%` : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderDays(all) {
  const byDay = new Map();
  for (const p of all) {
    if (!byDay.has(p.dateKey)) byDay.set(p.dateKey, []);
    byDay.get(p.dateKey).push(p);
  }
  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  if (!days.length) { $('#recordDays').innerHTML = ''; return; }
  $('#recordDays').innerHTML = `
    <div class="section-title">Day by day</div>
    ${days.map(([dateKey, picks], idx) => {
      const s = summarize(picks.filter((p) => p.meetsStandard !== false));
      const net = s.units;
      return `
        <div class="day-block">
          <details ${idx === 0 ? 'open' : ''}>
            <summary>
              <span class="d">${esc(fmtDayKey(dateKey))}</span>
              <span class="rec">${s.wins}–${s.losses}${s.pending ? ` · ${s.pending} pending` : ''}</span>
              <span class="spacer"></span>
              <span class="net ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${s.graded ? fmtUnits(net, { sign: true }) : ''}</span>
            </summary>
            <div class="day-picks">
              ${picks.map((p) => `
                <div class="day-pick">
                  ${sportPill(p)}
                  ${p.board === 'potd' ? '<span class="pill pill-sport">POTD</span>' : ''}
                  <span class="sel">${esc(p.selection)} ${esc(fmtAmerican(p.american))}</span>
                  <span class="spacer"></span>
                  ${statusPill(p)}
                  <span class="sub">${esc(matchupText(p))} · ${fmtUnits(p.stakeUnits ?? 1)}${p.meetsStandard === false ? ' · ⚠ flagged' : ''}${statusOf(p) === 'won' || statusOf(p) === 'lost' ? ` · ${fmtUnits(netUnits(p), { sign: true })}` : ''}</span>
                </div>`).join('')}
            </div>
          </details>
        </div>`;
    }).join('')}`;
}

async function loadRecord() {
  if (recordState.top5) { renderRecord(); return; }
  const loading = $('#recordLoading');
  const errBox = $('#recordError');
  errBox.hidden = true;
  loading.hidden = false;
  try {
    const [top5, potd] = await Promise.all([getJson('/top5-history'), getJson('/potd-history')]);
    recordState.top5 = top5?.picks ?? [];
    recordState.potd = potd?.picks ?? [];
    renderRecord();
  } catch (err) {
    errBox.innerHTML = corsHint(err);
    errBox.hidden = false;
  } finally {
    loading.hidden = true;
  }
}

/* ---------------- tabs + controls ---------------- */

function selectTab(name) {
  const today = name === 'today';
  $('#tabToday').classList.toggle('is-active', today);
  $('#tabToday').setAttribute('aria-selected', String(today));
  $('#tabRecord').classList.toggle('is-active', !today);
  $('#tabRecord').setAttribute('aria-selected', String(!today));
  $('#panelToday').hidden = !today;
  $('#panelRecord').hidden = today;
  if (!today) loadRecord();
}

$('#tabToday').addEventListener('click', () => selectTab('today'));
$('#tabRecord').addEventListener('click', () => selectTab('record'));

$('#windowSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-days]');
  if (!btn) return;
  recordState.days = Number(btn.dataset.days);
  for (const b of $('#windowSeg').querySelectorAll('button')) b.classList.toggle('is-active', b === btn);
  renderRecord();
});

$('#boardSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-board]');
  if (!btn) return;
  recordState.board = btn.dataset.board;
  for (const b of $('#boardSeg').querySelectorAll('button')) b.classList.toggle('is-active', b === btn);
  renderRecord();
});

/* Refresh today's board when the app comes back to the foreground (the
   worker edge-caches these routes for 5 minutes, so this stays cheap). */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('#panelToday').hidden) loadToday();
});

loadToday();
