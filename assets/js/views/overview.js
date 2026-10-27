import { esc, pctOf, relativeDay } from "../util.js";
import { state, team as getTeam } from "../store.js";
import { fixtureCard, sectionHead, teamBadge, leagueTint, probBar } from "../ui.js";
import { reliabilityChart } from "../charts.js";

const DAY = 86_400_000;

const within = (days) => state.fixtures.filter((f) => new Date(f.date).getTime() - Date.now() < days * DAY);

function statstrip() {
  const summary = state.metrics?.summary;
  const fixtures = state.fixtures.length;
  const leagues = state.leagues.size;
  return `<div class="statstrip">
    <div class="stat"><small>Fixtures modelled</small><b>${fixtures.toLocaleString()}</b><span>rest of 2026–27</span></div>
    <div class="stat"><small>Competitions</small><b>${leagues}</b><span>England to Turkey</span></div>
    <div class="stat"><small>Model Brier</small><b>${summary ? summary.brier.toFixed(3) : "—"}</b><span>${summary ? `${summary.matches.toLocaleString()} backtested matches` : "walk-forward"}</span></div>
    <div class="stat"><small>Market Brier</small><b>${summary?.marketBrier ? summary.marketBrier.toFixed(3) : "—"}</b><span>closing odds benchmark</span></div>
  </div>`;
}

function signalCards() {
  const soon = within(6).filter((fixture) => new Date(fixture.date) > new Date());
  if (!soon.length) return "";
  const sharpest = soon.reduce((best, item) =>
    Math.max(...item.p) > Math.max(...best.p) ? item : best, soon[0]);
  const tightest = soon.reduce((best, item) =>
    Math.max(...item.p) < Math.max(...best.p) ? item : best, soon[0]);
  const goalfest = soon.reduce((best, item) =>
    item.lh + item.la > best.lh + best.la ? item : best, soon[0]);

  const card = (label, fixture, value, caption, tone) => {
    const home = getTeam(fixture.home);
    const away = getTeam(fixture.away);
    return `<a class="signal" href="/match/${esc(fixture.id)}" data-link>
      <span class="signal__label" style="--tone:${tone}">${esc(label)}</span>
      <span class="signal__value mono">${esc(value)}</span>
      <span class="signal__match">${teamBadge(home, "sm")}${esc(home.short)} <i>–</i> ${esc(away.short)}${teamBadge(away, "sm")}</span>
      <span class="signal__note">${esc(caption)}</span>
      ${probBar(fixture.p)}
    </a>`;
  };

  const pickName = (fixture) => {
    const [home, draw, away] = fixture.p;
    const max = Math.max(home, draw, away);
    if (max === home) return `${getTeam(fixture.home).short} win`;
    if (max === away) return `${getTeam(fixture.away).short} win`;
    return "Draw";
  };

  return `<div class="signal-grid">
    ${card(
      "Sharpest call",
      sharpest,
      pctOf(Math.max(...sharpest.p) * 100),
      `${pickName(sharpest)} · ${relativeDay(sharpest.date)}`,
      "var(--accent)",
    )}
    ${card(
      "Tightest call",
      tightest,
      pctOf(Math.max(...tightest.p) * 100),
      `No clear favourite · ${relativeDay(tightest.date)}`,
      "var(--sand)",
    )}
    ${card(
      "Most goals expected",
      goalfest,
      (goalfest.lh + goalfest.la).toFixed(2),
      `${getTeam(goalfest.home).short} ${goalfest.lh.toFixed(2)} – ${goalfest.la.toFixed(2)} ${getTeam(goalfest.away).short}`,
      "var(--mint)",
    )}
  </div>`;
}

function leagueCards() {
  return `<div class="league-grid">${[...state.leagues.values()]
    .map((league) => {
      const leaderRow = league.table[0];
      const leader = leaderRow ? getTeam(leaderRow.team) : null;
      const favourite = (league.projection || [])[0];
      const favTeam = favourite ? getTeam(favourite.team) : null;
      const tint = leagueTint(league.code);
      return `<a class="league-card" href="/league/${esc(league.id)}" data-link style="--league:${tint}">
        <div class="league-card__top">
          <span class="league-card__code">${esc(league.short)}</span>
          <span class="league-card__country">${esc(league.country)}</span>
          <span class="league-card__teams">${league.teams}</span>
        </div>
        <h3>${esc(league.name)}</h3>
        <div class="league-card__leader">
          ${leader ? `${teamBadge(leader, "sm")}<span>${esc(leader.name)}</span><b>${leaderRow.points} pts</b>` : "<span>No matches played</span>"}
        </div>
        <div class="league-card__foot">
          <span>${favTeam ? `Title lean · ${esc(favTeam.short)} ${favourite.title.toFixed(0)}%` : "Projection pending"}</span>
          <span>${league.matchesRemaining} left</span>
        </div>
      </a>`;
    })
    .join("")}</div>`;
}

function modelPanel() {
  const metrics = state.metrics;
  if (!metrics) return "";
  const summary = metrics.summary;
  return `<div class="card">
    <div class="panel-head">
      <h3>The receipts</h3>
      <a class="section__link" href="/model" data-link>Full audit<svg><use href="#i-arrow"/></svg></a>
    </div>
    <div class="panel-body model-panel">
      <div class="model-panel__copy">
        <p class="prose">Every forecast on this site is walked forward and scored against what actually happened.
        Across <strong>${summary.matches.toLocaleString()} matches</strong> the model lands at a Brier score of
        <strong>${summary.brier.toFixed(3)}</strong> — the closing market manages
        <strong>${summary.marketBrier?.toFixed(3) ?? "—"}</strong> on the same fixtures.</p>
        <div class="model-panel__stats">
          <div><small>Accuracy</small><b>${summary.accuracy.toFixed(1)}%</b><span>vs ${summary.marketAccuracy?.toFixed(1) ?? "—"}% market</span></div>
          <div><small>Log loss</small><b>${summary.logLoss.toFixed(3)}</b><span>vs ${summary.marketLogLoss?.toFixed(3) ?? "—"} market</span></div>
          <div><small>Calibration</small><b>${(summary.ece * 100).toFixed(1)}%</b><span>expected calibration error</span></div>
        </div>
      </div>
      <figure class="model-panel__chart">
        ${reliabilityChart(metrics.calibration, metrics.marketCalibration)}
        <figcaption>
          <span><i class="key key--model"></i>Footyline</span>
          <span><i class="key key--market"></i>Closing market</span>
        </figcaption>
      </figure>
    </div>
  </div>`;
}

export default function overview() {
  const pool = within(10).filter((fixture) => new Date(fixture.date) > new Date());
  const seen = new Set();
  const upcoming = [];
  for (const fixture of pool) {
    const leagueId = state.leaguesByCode.get(fixture.league)?.id;
    if (!leagueId || seen.has(leagueId)) continue;
    seen.add(leagueId);
    upcoming.push(fixture);
    if (upcoming.length === 6) break;
  }
  for (const fixture of pool) {
    if (upcoming.length >= 6) break;
    if (!upcoming.includes(fixture)) upcoming.push(fixture);
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  const html = `<div class="view">
    <section class="hero">
      <div class="hero__grid">
        <div>
          <p class="eyebrow">Open-data football forecasts</p>
          <h1 class="display">Every match,<br><em>made legible.</em></h1>
          <p class="hero__lede">Probabilities for the next fortnight of fixtures across eleven leagues —
          modelled from five seasons of results, explained line by line, and graded against the closing market.</p>
        </div>
        <div class="hero__aside">${statstrip()}</div>
      </div>
    </section>

    <section class="section">
      ${sectionHead({
        eyebrow: "Next off the board",
        title: "The next few matches",
        href: "/matches",
        linkLabel: "Match centre",
      })}
      <div class="rail-scroll">${upcoming.map((fixture) => fixtureCard(fixture, { showForm: true })).join("")}</div>
    </section>

    <section class="section">
      ${sectionHead({ eyebrow: "Signals", title: "What stands out this week" })}
      ${signalCards()}
    </section>

    <section class="section">
      ${sectionHead({ eyebrow: "Competitions", title: "Eleven leagues, one method", href: "/matches", linkLabel: "All fixtures" })}
      ${leagueCards()}
    </section>

    <section class="section">${modelPanel()}</section>

    <p class="disclaimer"><strong>What this is.</strong> Footyline publishes statistical forecasts. Every number is
    a probability, not a promise: a 68% favourite loses roughly one time in three. Forecasts are generated from
    public results data and are not betting advice. If gambling costs you more than money, seek support.</p>
  </div>`;

  return {
    html,
    title: "Footyline — football forecasts with the receipts",
    crumb: "Overview",
    nav: "overview",
  };
}
