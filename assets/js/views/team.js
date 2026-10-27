import { esc, pctOf, fmtDate, fmtKickoff, relativeDay, plural } from "../util.js";
import { state, team as getTeam, league as getLeague, projection as getProjection, teamFixtures, teamByFd } from "../store.js";
import { sectionHead, teamBadge, formChips, fixtureCard, leagueTint, starButton } from "../ui.js";

const scale = (value, low, high) => {
  if (high === low) return 50;
  return Math.max(3, Math.min(100, ((value - low) / (high - low)) * 100));
};

export default function teamView({ id }) {
  const team = state.teams.get(id);
  if (!team) {
    return {
      html: `<div class="view"><div class="empty"><strong>Club not found</strong><span>Search for a club with ⌘K, or browse a competition from the rail.</span></div></div>`,
      title: "Not found — Footyline",
      crumb: "Not found",
      nav: "matches",
    };
  }

  const league = getLeague(state.leaguesByCode.get(team.league)?.id || team.league);
  const row = state.tableByLeague.get(league.id)?.get(team.id);
  const projection = getProjection(league.id, team.id);
  const peers = (league.table || []).map((entry) => getTeam(entry.team)).filter(Boolean);
  const attacks = peers.map((entry) => entry.attack ?? 0);
  const defences = peers.map((entry) => entry.defence ?? 0);
  const elos = peers.map((entry) => entry.elo ?? 1500);
  const attackRange = [Math.min(...attacks), Math.max(...attacks)];
  const defenceRange = [Math.min(...defences), Math.max(...defences)];
  const eloRange = [Math.min(...elos), Math.max(...elos)];

  const results = [...(team.form || [])].reverse();
  const upcoming = teamFixtures(team.id).slice(0, 6);

  const bar = (label, value, percent, hint) => `
    <div class="rating-item">
      <div class="rating-bar">
        <span>${esc(label)}</span>
        <span class="rating-bar__track"><i style="width:${percent.toFixed(1)}%"></i></span>
        <b>${esc(value)}</b>
      </div>
      ${hint ? `<p class="rating-hint">${esc(hint)}</p>` : ""}
    </div>`;

  const projectionMarkup = projection
    ? `<div class="projection">
        <div class="projection__stat"><small>Expected finish</small><b>${projection.expPos.toFixed(1)}</b><span>10th–90th: ${projection.posSpread[0].toFixed(0)}–${projection.posSpread[1].toFixed(0)}</span></div>
        <div class="projection__stat"><small>Expected points</small><b>${projection.expPts.toFixed(0)}</b><span>from 4,000 simulations</span></div>
        <div class="projection__bars">
          <div><span>Title</span><span class="table__bar"><i style="width:${projection.title}%"></i></span><b>${projection.title.toFixed(1)}%</b></div>
          <div><span>Top four</span><span class="table__bar"><i style="width:${projection.top4}%"></i></span><b>${projection.top4.toFixed(1)}%</b></div>
          <div><span>Bottom three</span><span class="table__bar"><i style="width:${projection.bottom3}%"></i></span><b>${projection.bottom3.toFixed(1)}%</b></div>
        </div>
      </div>`
    : "";

  return {
    html: `<div class="view">
      <div class="backrow">
        <a class="backlink" href="/league/${esc(league.id)}" data-link><svg><use href="#i-back"/></svg>${esc(league.name)}</a>
        ${starButton(team.id, "club")}
      </div>

      <div class="pagehead">
        <div class="pagehead__id">
          ${teamBadge(team, "lg")}
          <div>
            <p class="eyebrow"><a href="/league/${esc(league.id)}" data-link>${esc(league.name)}</a> · ${esc(league.country)}</p>
            <h1>${esc(team.name)}</h1>
            <small>${row ? `#${row.position} · ${row.points} points from ${row.played}` : "No matches played this season"}</small>
          </div>
        </div>
        <div class="pagehead__stats">
          <div class="pagehead__stat"><small>Points / game</small><b>${row ? row.ppg.toFixed(2) : "—"}</b></div>
          <div class="pagehead__stat"><small>Goals</small><b>${row ? `${row.gf}:${row.ga}` : "—"}</b></div>
          <div class="pagehead__stat"><small>Elo</small><b>${team.elo ?? "—"}</b></div>
        </div>
      </div>

      <div class="detail-grid">
        <section class="card">
          <div class="panel-head"><h3>Rating profile</h3><span class="eyebrow">Fitted after the last matchday</span></div>
          <div class="panel-body stack">
            ${bar("Attack", `+${(team.attack ?? 0).toFixed(2)}`, scale(team.attack ?? 0, ...attackRange), "Higher means more goals created than the league average.")}
            ${bar("Defence", (team.defence ?? 0).toFixed(2), 100 - scale(team.defence ?? 0, ...defenceRange), "Lower means fewer goals conceded; the bar is inverted.")}
            ${bar("Elo", String(team.elo ?? 1500), scale(team.elo ?? 1500, ...eloRange), "Season-regressed Elo, an independent strength check.")}
            <div class="rating-foot">
              <span>Evidence <b>${team.played} matches</b></span>
              <span>Strength <b>${(team.strength ?? 0).toFixed(2)}</b></span>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="panel-head"><h3>Season projection</h3><span class="eyebrow">Monte Carlo</span></div>
          <div class="panel-body">${projectionMarkup || `<p class="dim">No projection available.</p>`}</div>
        </section>
      </div>

      <div class="detail-grid">
        <section class="card">
          <div class="panel-head"><h3>Recent results</h3><span class="eyebrow">Last ${results.length}</span></div>
          ${
            results.length
              ? results
                  .map((entry) => {
                    const opponent = teamByFd(team.league, entry.opponent);
                    return `<div class="result-row">
                      <i class="form-chip form-chip--${entry.result.toLowerCase()}">${entry.result}</i>
                      <time datetime="${esc(entry.date)}">${esc(fmtDate(entry.date))}</time>
                      <span>${entry.venue === "H" ? "vs" : "at"} ${esc(opponent?.name || entry.opponent)}</span>
                      <span class="score">${esc(entry.score)}</span>
                    </div>`;
                  })
                  .join("")
              : `<div class="panel-body dim">No results yet this season.</div>`
          }
        </section>

        <section class="card">
          <div class="panel-head"><h3>Next fixtures</h3><span class="eyebrow">${plural(upcoming.length, "match")}</span></div>
          ${
            upcoming.length
              ? upcoming
                  .map((fixture) => {
                    const isHome = fixture.home === team.id;
                    const opponent = getTeam(isHome ? fixture.away : fixture.home);
                    const probability = isHome ? fixture.p[0] : fixture.p[2];
                    const kickoff = fmtKickoff(fixture.date);
                    return `<a class="result-row result-row--link" href="/match/${esc(fixture.id)}" data-link>
                      <time datetime="${esc(fixture.date)}">${esc(kickoff.time)}</time>
                      <span class="result-row__when">${esc(relativeDay(fixture.date))}</span>
                      <span class="result-row__team">${isHome ? "vs" : "at"} ${teamBadge(opponent, "sm")}<span>${esc(opponent.name)}</span></span>
                      <span class="score">${pctOf(probability * 100)}</span>
                    </a>`;
                  })
                  .join("")
              : `<div class="panel-body dim">Season complete.</div>`
          }
        </section>
      </div>

      <section class="section">
        ${sectionHead({ eyebrow: "Full schedule", title: `${esc(team.name)} fixtures`, href: "/matches", linkLabel: "Match centre" })}
        <div class="fixture-grid">${upcoming.slice(0, 3).map((fixture) => fixtureCard(fixture)).join("")}</div>
      </section>
    </div>`,
    title: `${team.name} — Footyline`,
    crumb: team.name,
    nav: "matches",
  };
}
