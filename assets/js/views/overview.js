import { esc, pctOf, relativeDay, fmtKickoff, dayKey, plural } from "../util.js";
import { state, team as getTeam } from "../store.js";
import { bandHead, matchRow, teamBadge, triBar, statLine, dayLabel, leagueTint } from "../ui.js";
import { reliabilityChart } from "../charts.js";

const upcoming = () => state.fixtures.filter((f) => new Date(f.date) > new Date());

function nextUpModule() {
  const fixture = upcoming()[0];
  if (!fixture) return "";
  const home = getTeam(fixture.home);
  const away = getTeam(fixture.away);
  const league = state.leaguesByCode.get(fixture.league);
  const kickoff = fmtKickoff(fixture.date);
  const [h, d, a] = fixture.p;
  const best = Math.max(h, d, a);

  return `<div class="nextup">
    <div class="nextup__meta">
      <span>Next fixture</span>
      <span>${esc(relativeDay(fixture.date))} · ${kickoff.time}</span>
    </div>
    <p class="label" style="margin-top:10px">${esc(league?.name || "")}</p>
    <div class="nextup__teams">
      <div>${teamBadge(home)}<span>${esc(home.name)}</span></div>
      <div>${teamBadge(away)}<span>${esc(away.name)}</span></div>
    </div>
    ${triBar(fixture.p, "splitbar")}
    <div class="nextup__nums">
      <div class="${h === best ? "lead" : ""}"><b>${pctOf(h * 100, 0)}</b><span>Home</span></div>
      <div class="${d === best ? "lead" : ""}"><b>${pctOf(d * 100, 0)}</b><span>Draw</span></div>
      <div class="${a === best ? "lead" : ""}"><b>${pctOf(a * 100, 0)}</b><span>Away</span></div>
    </div>
    <a class="nextup__link" href="/match/${esc(fixture.id)}" data-link>
      <span>Full forecast</span><span>→</span>
    </a>
  </div>`;
}

function fixtureBoard() {
  const pool = upcoming();
  const groups = new Map();
  for (const fixture of pool) {
    const key = dayKey(fixture.date);
    if (!groups.has(key)) {
      if (groups.size >= 3) break;
      groups.set(key, []);
    }
    const bucket = groups.get(key);
    if (bucket.length < 4) bucket.push(fixture);
  }
  const blocks = [...groups.entries()]
    .slice(0, 3)
    .map(
      ([key, fixtures]) => `<div class="match-row__day">${esc(dayLabel(key))}<span>${plural(
        fixtures.length,
        "fixture",
      )}</span></div>${fixtures.map((fixture) => matchRow(fixture)).join("")}`,
    )
    .join("");
  return `<div class="matchlist">${blocks}</div>`;
}

function competitionIndex() {
  const rows = [...state.leagues.values()]
    .map((league) => {
      const leaderRow = league.table[0];
      const leader = leaderRow ? getTeam(leaderRow.team) : null;
      const favourite = (league.projection || [])[0];
      const favTeam = favourite ? getTeam(favourite.team) : null;
      return `<a class="comprow" href="/league/${esc(league.id)}" data-link>
        <span class="comprow__name">
          <i class="swatch" style="--tone:${leagueTint(league.code)}"></i>
          <span>${esc(league.name)}</span>
        </span>
        <span class="comprow__leader">${
          leader ? `${teamBadge(leader, "sm")}<span>${esc(leader.name)}</span>` : "<span>No matches yet</span>"
        }</span>
        <span class="comprow__odds">${
          favourite ? `${esc(favTeam.short)} <b>${favourite.title.toFixed(0)}%</b>` : "—"
        }</span>
        <span class="comprow__odds">${league.matchesRemaining} left</span>
        <span class="comprow__sub">${esc(league.country)} · tier ${league.tier} · ${league.teams} clubs</span>
      </a>`;
    })
    .join("");
  return `<div class="complist">${rows}</div>`;
}

function recordPanel() {
  const metrics = state.metrics;
  if (!metrics) return "";
  const summary = metrics.summary;
  const gap = summary.marketBrier ? summary.brier - summary.marketBrier : null;
  return `<div class="split">
    <div class="prose">
      <p>Every forecast is written down before kick-off and scored afterwards. The audit below is a
      walk-forward replay: the model refits weekly, predicts the week ahead, and is graded on what happened.</p>
      <p>Across <strong>${summary.matches.toLocaleString()} matches</strong> the model scores
      <strong>${summary.brier.toFixed(3)}</strong> on the Brier scale, against
      <strong>${summary.marketBrier?.toFixed(3) ?? "—"}</strong> for the closing market — a gap of
      ${gap != null ? `${(gap * 1000).toFixed(0)} points per thousand` : "—"}. That is close, and it is the
      honest way to describe it: not better than the market, but within reach of it, with every input visible.</p>
      <p class="mt-sm"><a class="bandhead__link" href="/model" data-link>Read the full audit</a></p>
    </div>
    <div class="panel">
      <h3>Reliability</h3>
      ${reliabilityChart(metrics.calibration, metrics.marketCalibration)}
      <div class="chart-legend">
        <span><i style="background:var(--ink)"></i>Footyline</span>
        <span><i style="background:var(--signal)"></i>Closing market</span>
      </div>
    </div>
  </div>`;
}

export default function overview() {
  const summary = state.metrics?.summary;
  return {
    html: `<div class="view">
      <section class="hero">
        <div class="hero__grid">
          <div>
            <p class="label">Programme · ${esc(state.feed?.season || "2026–27")}</p>
            <h1 class="display"><span class="num">${state.fixtures.length.toLocaleString()}</span> fixtures.<br><em>One forecast each.</em></h1>
            <p class="lede hero__lede">Eleven competitions, every market derived from a single scoreline model,
            refreshed twice a day and graded in public against the closing market.</p>
          </div>
          <aside class="hero__aside">${nextUpModule()}</aside>
        </div>
      </section>

      ${statLine([
        { label: "Fixtures modelled", value: state.fixtures.length.toLocaleString(), note: "rest of the season" },
        { label: "Competitions", value: String(state.leagues.size), note: "eleven countries and tiers" },
        { label: "Model Brier", value: summary ? summary.brier.toFixed(3) : "—", note: summary ? `${summary.matches.toLocaleString()} matches graded` : "walk-forward" },
        { label: "Closing market", value: summary?.marketBrier ? summary.marketBrier.toFixed(3) : "—", note: "same fixtures, de-vigged" },
      ])}

      <section class="band">
        ${bandHead({ idx: "01", title: "Next up", href: "/matches", label: "All fixtures" })}
        ${fixtureBoard()}
      </section>

      <section class="band">
        ${bandHead({ idx: "02", title: "Competitions", href: "/matches", label: "Fixture board" })}
        ${competitionIndex()}
      </section>

      <section class="band">
        ${bandHead({ idx: "03", title: "The record", href: "/model", label: "Full audit" })}
        ${recordPanel()}
      </section>

      <p class="disclaimer"><strong>What this is.</strong> Footyline publishes statistical forecasts. Every number is a
      probability, not a promise: a 68% favourite loses roughly one time in three. Nothing here is betting advice.</p>
    </div>`,
    title: "Footyline — every match, modelled",
    crumb: "Index",
    nav: "overview",
  };
}
