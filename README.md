# Footyline

An open-data football forecasting studio. Match probabilities for **11 competitions** and **2,782 fixtures**,
built from five seasons of results, explained market by market, and audited in public against the closing odds.

The interface is a deliberate departure from the dashboard genre: **a match-day programme set by a Swiss
typographer**. Warm paper instead of dark glass, near-black ink, a single vermilion signal colour, hairline rules
instead of cards, and dense tabular rows instead of tiles.

---

## Design direction

| Decision | Why |
| --- | --- |
| Warm paper (`#f1efe8`) + ink (`#14140f`) + one signal (`#ff3c00`) | Print economics: two inks and a spot colour. Instantly distinct from the dark-green/neon language every sports product uses. |
| Archivo (variable width) + IBM Plex Mono + Instrument Serif | Grotesque for structure, mono for every number, serif italic used once per page as an editorial accent. |
| Rules, not cards | Sections are separated by hairlines and numbered (`01`, `02`). Nothing floats, nothing has a shadow, so density reads as confidence rather than clutter. |
| Fixtures as rows | 2,782 matches cannot live in cards. A row carries kick-off, competition, both clubs, three probabilities, a proportional bar, reliability, and a save button — scannable at roughly 60 fixtures per screen. |
| A top masthead, not a sidebar | Navigation sits in a single 64px band with a competitions panel beneath it, so the content column gets the full width on desktop. |
| Two modes | Light is the primary "programme"; dark is the "night edition". Both are first-class and keep the same three-ink logic. |
| Motion only for state | A 300ms rise on route change, 140ms hover transitions, nothing decorative. |

---

## What is on the site

| Route | What it does |
| --- | --- |
| `/` | Hero with the live fixture count, next-fixture module, next three matchdays, competition index, public record |
| `/matches` | Every remaining fixture as a row, grouped by day; date range, competition, search, sort |
| `/match/:id` | Full forecast: three headline probabilities, 11×11 scoreline grid, ~24 modelled markets, team comparison, H2H, goal distribution |
| `/league/:id` | Live table with xG and promotion/relegation zones, Monte-Carlo projected finish, title race, upcoming fixtures |
| `/team/:id` | Attack/defence/Elo profile, season projection, recent results, season totals, upcoming rows |
| `/model` | Method, formula, reliability diagram, rolling Brier trend, per-league backtest, forecast log, limits |
| `/watchlist` | Saved fixtures and clubs (localStorage) |

Plus: `⌘K` / `Ctrl+K` command palette, `g` `o|m|t|w` shortcuts, a competitions panel, deep-linkable filters,
keyboard-accessible menus, and a skip link. Add `?theme=light` or `?theme=dark` to any URL to pin the theme.

Screenshots of each surface live in `preview/`.

## The model

A **time-decayed Dixon-Coles bivariate Poisson** model, fitted per league.

```
λ_home = exp(α_home + β_away + γ)
λ_away = exp(α_away + β_home)
P(x, y) ∝ τ(x, y) · Poisson(x; λ_home) · Poisson(y; λ_away)
```

* Five seasons of results (2021-22 → 2026-27) per league, weighted by a **two-part decay kernel**:
  `w = 0.5·0.5^(age/420) + 0.5·0.5^(age/60)`. The long component keeps a club's durable strength; the
  60-day component makes recent form count, so last month weighs about 2.6× ten months ago — it was 1.6×
  under a single 420-day half-life. Setting `a = 1` reduces the kernel to that old single decay.
* **xG blending.** Where expected goals are published (2026-27 onward), the fitted observation becomes
  `z = 0.6·goals + 0.4·xG·scale`, with `scale` the time-weighted goals-per-xG ratio (shrunk toward 1 and
  clipped to ±8%). A 5-1 built on 1.1 xG therefore counts for less than the scoreline suggests. Matches
  without xG keep `z = goals`, so pre-xG seasons are bit-for-bit unchanged and a missing feed degrades
  silently to the goals-only model.
* Ridge-regularised attack/defence ratings; thin evidence shrinks toward a conservative promoted-side prior.
* League-specific home advantage and low-score correction (`ρ`), both fitted per league.
* An independent Elo rating is computed for comparison and shown on club pages, but is *not* blended in.
* **No odds enter the forecast.** Closing prices are used only as an out-of-sample benchmark.

The 11×11 scoreline grid is computed in the browser (`assets/js/engine.js`) so every market on a match page is
derived from the same grid and can never contradict another.

### Validation

Walk-forward backtest: weekly refits, predictions made strictly before kick-off, scored on every completed match
since July 2025.

| | Footyline | Closing market |
| --- | --- | --- |
| Matches | 4,598 | 4,598 |
| Brier (lower better) | **0.200** | 0.196 |
| Log loss | **1.005** | 0.985 |
| Accuracy | 50.1% | 52.0% |
| Calibration error | 1.5% | 1.0% |

An honest summary: the model gets close to the hardest benchmark in football, and trails it by four thousandths of
a Brier point. The `/model` page says exactly that, and exposes the full forecast log.

A second, separate record is kept live: every published forecast is written to `data/ledger.jsonl` before kick-off
and scored when the result lands. That is the number that keeps the audit honest between weekly rebuilds.

## Repository layout

```
index.html                 app shell + icon sprite
assets/
  app.css                  design system and view styles (single stylesheet)
  favicon.svg
  js/
    main.js                bootstrap: theme, chrome, palette, watchlist, shortcuts
    router.js              History-API router
    store.js               data loading + indexes + search
    engine.js              client-side Dixon-Coles grid and markets
    ui.js                  shared markup helpers (badges, cards, probability rails)
    charts.js              hand-rolled SVG charts (heatmap, reliability, trend, goals)
    util.js                formatting and small helpers
    views/                 overview, matches, match, league, team, model, watchlist
data/
  feed.json                leagues, clubs, fixtures, tables, projections, head-to-head
  metrics.json             backtest summary, calibration, weekly trend, live record
  meta.json               small freshness/provenance file (build time, model hash)
  ledger.jsonl            append-only record of every forecast and its settlement
pipeline/
  seasons.py               all season arithmetic (nothing else hardcodes a season)
  config.py                leagues and model hyperparameters
  fetch.py                 conditional download, TTL cache, --force, fetch manifest
  model.py                 Dixon-Coles fit, scoreline grid, markets, Elo, metrics, backtest
  ledger.py                append-only forecast ledger: record, settle, summarise
  publish.py               validation gates + atomic writes
  check.py                 post-build verification used by CI
  build.py                 assembles the feed; --mode daily | weekly
  tune.py                  walk-forward grid search for half-life and ridge
  tune_xg.py               walk-forward sweep for the xG blend weight
  tune_form.py             walk-forward sweep for the decay kernel and ridge
  xg_report.py             shows how xG damping moves ratings around odd scorelines
  cache/                   cached CSVs/JSON, plus .fetch-state and fetch-manifest
.github/workflows/forecast.yml   scheduled refresh (daily ×2, weekly audit)
pipeline/requirements.txt  numpy
serve.mjs                  static server with SPA fallback for local preview
vercel.json                clean URLs, SPA rewrites, cache headers
.vercelignore              keeps the pipeline out of the deployment
```

## Running it

Preview (no build step):

```bash
node serve.mjs 4185
# http://127.0.0.1:4185
```

Rebuild the data (Python 3.12 with numpy):

```bash
cd pipeline

python fetch.py                  # conditional refresh; cached files revalidated
python fetch.py --force          # ignore TTL and validators, re-download everything
python fetch.py --leagues E0 --history 2   # narrow run for debugging

python build.py --mode daily     # refit + re-predict, reuse the last audit  (~40s)
python build.py --mode weekly    # also rerun the walk-forward backtest      (~4min)
python build.py --dry-run        # validate everything, write nothing

python check.py                  # verify the published artifacts (what CI runs)
python ledger.py                 # print the live track record
```

`build.py` is deterministic given the cache: the same inputs always produce the same ratings and probabilities.
The daily mode is the one that runs twice a day; the weekly mode is the audit.

## Automation

`.github/workflows/forecast.yml` runs the service:

| Trigger | Mode | What it does |
| --- | --- | --- |
| 06:10 UTC daily | daily | refresh results, refit, re-predict, settle finished games |
| 23:30 UTC daily | daily | catch same-evening results |
| Monday 05:15 UTC | weekly | full walk-forward audit, forced re-download |
| Manual | either | `workflow_dispatch` with a mode and force flag |

Each run fetches conditionally, builds, verifies with `check.py`, writes a job summary, then commits

* `data/ledger.jsonl` and `data/meta.json` — always, so the forecast record survives;
* `data/feed.json` and `data/metrics.json` — only when `VERCEL_TOKEN` is absent, so any git-connected host
  deploys on push. With the token set, the workflow deploys with the Vercel CLI instead and keeps the large
  artifacts out of git history.

To switch it on:

```bash
git init && git add -A && git commit -m "Footyline"
git remote add origin <your repo> && git push -u origin main
```

Nothing else is required — no season string, no league list, no manual rebuild. Promotion, relegation and the
1 July season rollover are handled by `pipeline/seasons.py` and the name-mapping in `model.py`.

**What is automated:** ingestion, refits, forecasts, projections, settlement, publishing, deployment, season
rollover. **What still needs a human:** adding a competition to `config.py`, replacing a dead upstream source, or
changing the model itself.

### Safety rails

* `fetch.py` degrades to the last good cache and records the failure rather than failing the build.
* `publish.py` validates the feed (resolvable ids, probabilities summing to 1, plausible kick-off dates, no
  duplicate ids, fixture count stability, no mass disappearance of clubs) and writes atomically. A failed
  validation leaves yesterday's site untouched and fails the workflow.
* `check.py` re-verifies what was written, cross-checks the feed hash against `meta.json`, and flags stale data.
* The ledger only appends when a probability actually moves by 2 points or the model version changes, so the
  record stays small (~50 KB for 250 forecasts) and diff-friendly.

## Data sources

* [football-data.co.uk](https://www.football-data.co.uk/) — results, half-time scores and closing odds.
* [fixturedownload.com](https://fixturedownload.com/) — the full-season fixture calendar.

Both are free, public datasets. Club names are normalised across the two sources in `pipeline/model.py`.

## Editorial note

The forecast is a probability, not a promise: a 68% favourite loses roughly one time in three. Footyline publishes
statistical analysis, not betting advice.
