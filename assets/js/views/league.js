import { esc, pctOf, plural, fmtKickoff, relativeDay } from "../util.js";
import { state, team as getTeam, projection as getProjection } from "../store.js";
import { sectionHead, teamBadge, formChips, fixtureCard, leagueTint } from "../ui.js";

const zoneFor = (league, position) => {
  const teams = league.teams;
  if (league.code === "SC0") {
    if (position === 1) return "zone--ucl";
    if (position <= 3) return "zone--euro";
    if (position === teams) return "zone--drop";
    return "";
  }
  if (league.code === "E1" || league.code === "F2") {
    if (position <= 2) return "zone--ucl";
    if (position <= 6) return "zone--euro";
    if (position >= teams - 2) return "zone--drop";
    return "";
  }
  if (position <= 4) return "zone--ucl";
  if (position <= 6) return "zone--euro";
  if (position >= teams - 2) return "zone--drop";
  return "";
};

const zoneLegend = (league) => {
  if (league.code === "E1" || league.code === "F2") {
    return `<span><i style="background:var(--mint)"></i>Automatic promotion</span>
      <span><i style="background:var(--sand)"></i>Play-offs</span>
      <span><i style="background:var(--bad)"></i>Relegation</span>`;
  }
  if (league.code === "SC0") {
    return `<span><i style="background:var(--mint)"></i>Champions</span>
      <span><i style="background:var(--sand)"></i>European places</span>
      <span><i style="background:var(--bad)"></i>Relegation</span>`;
  }
  return `<span><i style="background:var(--mint)"></i>Champions League</span>
    <span><i style="background:var(--sand)"></i>Europe</span>
    <span><i style="background:var(--bad)"></i>Relegation</span>`;
};

export default function leagueView({ id }) {
  const league = state.leagues.get(id);
  if (!league) {
    return {
      html: `<div class="view"><div class="empty"><strong>Competition not found</strong><span>Pick a league from the rail to see its table, projections and fixtures.</span></div></div>`,
      title: "Not found — Footyline",
      crumb: "Not found",
      nav: "matches",
    };
  }

  const fixtures = state.fixturesByLeague.get(league.id);
  const next = fixtures.slice(0, 6);
  const projectionRows = (league.projection || [])
    .map((row) => ({ ...row, team: getTeam(row.team) }))
    .sort((a, b) => a.expPos - b.expPos);

  const tableRows = league.table
    .map((row) => {
      const team = getTeam(row.team);
      return `<tr>
        <td class="pos"><i class="zone ${zoneFor(league, row.position)}"></i>${row.position}</td>
        <td class="left"><a class="team-cell" href="/team/${esc(team.id)}" data-link>${teamBadge(
          team,
          "sm",
        )}<span>${esc(team.name)}</span></a></td>
        <td>${row.played}</td>
        <td class="dim">${row.won}</td>
        <td class="dim">${row.drawn}</td>
        <td class="dim">${row.lost}</td>
        <td>${row.gf}</td>
        <td>${row.ga}</td>
        <td class="dim">${row.gd > 0 ? "+" : ""}${row.gd}</td>
        <td class="strong">${row.points}</td>
        <td class="hide-sm">${row.xg != null ? row.xg.toFixed(2) : "—"}</td>
        <td class="hide-sm">${row.xga != null ? row.xga.toFixed(2) : "—"}</td>
        <td class="hide-sm form-cell">${formChips(row.form, 5)}</td>
      </tr>`;
    })
    .join("");

  const projectionMarkup = projectionRows
    .map(
      (row) => `<tr>
        <td class="pos">${row.expPos.toFixed(1)}</td>
        <td class="left"><a class="team-cell" href="/team/${esc(row.team.id)}" data-link>${teamBadge(
          row.team,
          "sm",
        )}<span>${esc(row.team.name)}</span></a></td>
        <td>${row.expPts.toFixed(0)}</td>
        <td><div class="prob-cell"><span>${row.title.toFixed(1)}%</span><span class="table__bar"><i style="width:${row.title}%"></i></span></div></td>
        <td><div class="prob-cell"><span>${row.top4.toFixed(0)}%</span><span class="table__bar"><i style="width:${row.top4}%"></i></span></div></td>
        <td><div class="prob-cell"><span>${row.bottom3.toFixed(0)}%</span><span class="table__bar"><i style="width:${row.bottom3}%"></i></span></div></td>
      </tr>`,
    )
    .join("");

  const leaders = projectionRows.slice(0, 5);

  return {
    html: `<div class="view">
      <div class="pagehead">
        <div class="pagehead__id">
          <span class="league-crest" style="--league:${leagueTint(league.code)}">${esc(league.short)}</span>
          <div>
            <p class="eyebrow">${esc(league.country)} · Tier ${league.tier}</p>
            <h1>${esc(league.name)}</h1>
            <small>${league.matchesPlayed} played · ${league.matchesRemaining} to come · ${league.teams} clubs</small>
          </div>
        </div>
        <div class="pagehead__stats">
          <div class="pagehead__stat"><small>Goals / game</small><b>${league.goalsPerGame.toFixed(2)}</b></div>
          <div class="pagehead__stat"><small>Home wins</small><b>${pctOf(league.homeWinRate * 100, 0)}</b></div>
          <div class="pagehead__stat"><small>Draws</small><b>${pctOf(league.drawRate * 100, 0)}</b></div>
        </div>
      </div>

      <section class="card">
        <div class="panel-head"><h3>Table</h3><div class="legend">${zoneLegend(league)}</div></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th>#</th><th class="left">Club</th><th>P</th><th>W</th><th>D</th><th>L</th>
              <th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th class="hide-sm">xG</th><th class="hide-sm">xGA</th><th class="hide-sm">Form</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </section>

      <section class="section">
        ${sectionHead({ eyebrow: "Monte Carlo · 4,000 seasons", title: "Where this season is heading" })}
        <div class="detail-grid">
          <section class="card">
            <div class="panel-head"><h3>Projected finish</h3><span class="eyebrow">Remaining fixtures simulated</span></div>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Exp.</th><th class="left">Club</th><th>Pts</th><th>Title</th><th>Top 4</th><th>Bottom 3</th></tr></thead>
                <tbody>${projectionMarkup}</tbody>
              </table>
            </div>
            <p class="matrix__cap">Probabilities come from simulating every remaining fixture in this league 4,000 times using the same scoreline model.</p>
          </section>

          <section class="card">
            <div class="panel-head"><h3>Title race</h3><span class="eyebrow">Chance of finishing first</span></div>
            <div class="panel-body stack">
              ${leaders
                .map(
                  (row) => `<div class="race">
                    <div class="race__head">${teamBadge(row.team, "sm")}<span>${esc(row.team.name)}</span><b>${row.title.toFixed(1)}%</b></div>
                    <div class="race__track"><i style="width:${Math.max(1.5, row.title)}%"></i></div>
                  </div>`,
                )
                .join("")}
              <p class="chart-note">Expected points: <b>${leaders[0] ? leaders[0].expPts.toFixed(0) : "—"}</b> for the leader.</p>
            </div>
          </section>
        </div>
      </section>

      <section class="section">
        ${sectionHead({
          eyebrow: "Fixture board",
          title: "Next in the " + league.name,
          href: `/matches?league=${encodeURIComponent(league.id)}`,
          linkLabel: "Filter match centre",
        })}
        <div class="fixture-grid">${next.map((fixture) => fixtureCard(fixture)).join("")}</div>
      </section>
    </div>`,
    title: `${league.name} — Footyline`,
    crumb: league.name,
    nav: "matches",
  };
}
