import { esc, pctOf, plural } from "../util.js";
import { state, team as getTeam } from "../store.js";
import { bandHead, teamBadge, formStrip, matchRow, leagueTint } from "../ui.js";

const zoneFor = (league, position) => {
  const teams = league.teams;
  if (league.code === "SC0") {
    if (position === 1) return "zone--up";
    if (position <= 3) return "zone--euro";
    if (position === teams) return "zone--down";
    return "";
  }
  if (league.code === "E1" || league.code === "F2") {
    if (position <= 2) return "zone--up";
    if (position <= 6) return "zone--euro";
    if (position >= teams - 2) return "zone--down";
    return "";
  }
  if (position <= 4) return "zone--up";
  if (position <= 6) return "zone--euro";
  if (position >= teams - 2) return "zone--down";
  return "";
};

const zoneLegend = (league) => {
  const secondary = league.code === "E1" || league.code === "F2" ? "Play-offs" : league.code === "SC0" ? "Europe" : "Europe";
  return `<span class="tag"><i style="background:var(--ink)"></i>${
    league.code === "E1" || league.code === "F2" ? "Promotion" : "Champions League"
  }</span>
  <span class="tag"><i style="background:var(--draw)"></i>${secondary}</span>
  <span class="tag"><i style="background:var(--signal)"></i>Relegation</span>`;
};

export default function leagueView({ id }) {
  const league = state.leagues.get(id);
  if (!league) {
    return {
      html: `<div class="view"><div class="empty"><strong>Competition not found</strong><span>Pick a league from the competitions panel.</span></div></div>`,
      title: "Not found — Footyline",
      crumb: "Not found",
      nav: "matches",
    };
  }

  const fixtures = state.fixturesByLeague.get(league.id) || [];
  const projectionRows = (league.projection || [])
    .map((row) => ({ ...row, team: getTeam(row.team) }))
    .sort((a, b) => a.expPos - b.expPos);
  const leaders = projectionRows.slice(0, 5);

  const tableRows = league.table
    .map((row) => {
      const team = getTeam(row.team);
      return `<tr>
        <td class="pos"><i class="zone ${zoneFor(league, row.position)}"></i>${row.position}</td>
        <td class="left"><a class="teamcell" href="/team/${esc(team.id)}" data-link>${teamBadge(team, "sm")}<span>${esc(
          team.name,
        )}</span></a></td>
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
        <td class="hide-sm">${formStrip(row.form, 5)}</td>
      </tr>`;
    })
    .join("");

  const projectionMarkup = projectionRows
    .map(
      (row) => `<tr>
        <td class="pos">${row.expPos.toFixed(1)}</td>
        <td class="left"><a class="teamcell" href="/team/${esc(row.team.id)}" data-link>${teamBadge(
          row.team,
          "sm",
        )}<span>${esc(row.team.name)}</span></a></td>
        <td>${row.expPts.toFixed(0)}</td>
        <td>${row.title.toFixed(1)}</td>
        <td class="hide-sm">${row.top4.toFixed(0)}</td>
        <td>${row.bottom3.toFixed(0)}</td>
      </tr>`,
    )
    .join("");

  return {
    html: `<div class="view">
      <div class="pagehead">
        <div class="pagehead__row">
          <div class="pagehead__id">
            <i class="swatch" style="--tone:${leagueTint(league.code)};width:10px;height:34px"></i>
            <div>
              <p class="label">${esc(league.country)} · tier ${league.tier}</p>
              <h1 style="margin-top:8px">${esc(league.name)}</h1>
            </div>
          </div>
          <p class="label" style="padding-bottom:6px">${league.matchesPlayed} played · ${league.matchesRemaining} to come</p>
        </div>
        <div class="pagehead__meta">
          <div><small>Clubs</small><b>${league.teams}</b></div>
          <div><small>Goals / game</small><b>${league.goalsPerGame.toFixed(2)}</b></div>
          <div><small>Home wins</small><b>${pctOf(league.homeWinRate * 100, 0)}</b></div>
          <div><small>Draws</small><b>${pctOf(league.drawRate * 100, 0)}</b></div>
          <div><small>Home edge</small><b>+${league.homeAdvantage.toFixed(2)}</b></div>
        </div>
      </div>

      <section style="padding-bottom:6px;display:flex;flex-wrap:wrap;gap:14px;align-items:center">
        ${zoneLegend(league)}
      </section>

      <table class="table">
        <thead><tr>
          <th>#</th><th class="left">Club</th><th>P</th><th>W</th><th>D</th><th>L</th>
          <th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th class="hide-sm">xG</th><th class="hide-sm">xGA</th><th class="hide-sm">Form</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>

      <section class="band">
        ${bandHead({ idx: "01", title: "Where it ends up", label: "4,000 simulations" })}
        <div class="split">
          <div>
            <table class="table">
              <thead><tr><th>Exp.</th><th class="left">Club</th><th>Pts</th><th>Title %</th><th class="hide-sm">Top 4 %</th><th>Bottom 3 %</th></tr></thead>
              <tbody>${projectionMarkup}</tbody>
            </table>
            <p class="panel__note">Every remaining fixture in this league simulated 4,000 times on the same scoreline model.</p>
          </div>
          <div class="panel" style="border-top:0;padding-top:0">
            <h3>Title race</h3>
            <div class="race">
              ${leaders
                .map(
                  (row) => `<div class="race__row">
                    <span>${teamBadge(row.team, "sm")}<b>${esc(row.team.name)}</b></span>
                    <em>${row.title.toFixed(1)}%</em>
                    <span class="race__track"><i style="width:${Math.max(1.2, row.title)}%"></i></span>
                  </div>`,
                )
                .join("")}
            </div>
            <p class="panel__note">Expected points for the leader: <b>${leaders[0] ? leaders[0].expPts.toFixed(0) : "—"}</b>.</p>
          </div>
        </div>
      </section>

      <section class="band">
        ${bandHead({
          idx: "02",
          title: "Next in this competition",
          href: `/matches?league=${encodeURIComponent(league.id)}`,
          label: "All fixtures",
        })}
        <div class="matchlist">${fixtures.slice(0, 8).map((fixture) => matchRow(fixture)).join("")}</div>
      </section>
    </div>`,
    title: `${league.name} — Footyline`,
    crumb: league.name,
    nav: "matches",
  };
}
