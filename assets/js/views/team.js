import { esc, fmtDate } from "../util.js";
import { state, team as getTeam, league as getLeague, projection as getProjection, teamFixtures, teamByFd } from "../store.js";
import { bandHead, matchRow, teamBadge, starButton } from "../ui.js";

const scale = (value, low, high) => {
  if (high === low) return 50;
  return Math.max(3, Math.min(100, ((value - low) / (high - low)) * 100));
};

const rating = (label, value, percent, note) => `
  <div>
    <div class="rating__head"><span>${esc(label)}</span><b>${esc(value)}</b></div>
    <div class="rating__track"><i style="width:${percent.toFixed(1)}%"></i></div>
    <p class="rating__note">${esc(note)}</p>
  </div>`;

export default function teamView({ id }) {
  const team = state.teams.get(id);
  if (!team) {
    return {
      html: `<div class="view"><div class="empty"><strong>Club not found</strong><span>Search with ⌘K, or browse a competition.</span></div></div>`,
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
  const upcoming = teamFixtures(team.id).slice(0, 8);

  const facts = [
    ["Played", row?.played ?? "—"],
    ["Won", row?.won ?? "—"],
    ["Drawn", row?.drawn ?? "—"],
    ["Lost", row?.lost ?? "—"],
    ["Goals for", row?.gf ?? "—"],
    ["Goals against", row?.ga ?? "—"],
    ["xG for", row?.xg != null ? row.xg.toFixed(2) : "—"],
    ["xG against", row?.xga != null ? row.xga.toFixed(2) : "—"],
    ["Points / game", row ? row.ppg.toFixed(2) : "—"],
  ];

  return {
    html: `<div class="view">
      <div class="backrow">
        <a href="/league/${esc(league.id)}" data-link>${esc(league.name)}</a>
        <span class="backrow__sep">/</span>
        <span>${esc(team.name)}</span>
      </div>

      <div class="pagehead">
        <div class="pagehead__row">
          <div class="pagehead__id">
            ${teamBadge(team, "lg")}
            <div>
              <p class="label">${esc(league.name)} · ${esc(league.country)}</p>
              <h1 style="margin-top:8px">${esc(team.name)}</h1>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;padding-bottom:6px">
            ${row ? `<span class="label">#${row.position} · ${row.points} pts</span>` : ""}
            ${starButton(team.id, "club")}
          </div>
        </div>
        <div class="pagehead__meta">
          <div><small>Points / game</small><b>${row ? row.ppg.toFixed(2) : "—"}</b></div>
          <div><small>Goals</small><b>${row ? `${row.gf}:${row.ga}` : "—"}</b></div>
          <div><small>Elo</small><b>${team.elo ?? "—"}</b></div>
          <div><small>Strength</small><b>${(team.strength ?? 0).toFixed(2)}</b></div>
        </div>
      </div>

      <section class="band band--ink">
        <div class="split">
          <div class="panel" style="border-top:0;padding-top:0">
            <h3>Rating profile</h3>
            <div class="ratings">
              ${rating("Attack", `+${(team.attack ?? 0).toFixed(2)}`, scale(team.attack ?? 0, ...attackRange), "Goals created relative to the league average.")}
              ${rating("Defence", (team.defence ?? 0).toFixed(2), 100 - scale(team.defence ?? 0, ...defenceRange), "Goals conceded; the bar is inverted so further right is better.")}
              ${rating("Elo", String(team.elo ?? 1500), scale(team.elo ?? 1500, ...eloRange), "Season-regressed Elo, an independent check on strength.")}
            </div>
          </div>

          <div class="panel" style="border-top:0;padding-top:0">
            <h3>Season projection</h3>
            ${
              projection
                ? `<div class="pagehead__meta" style="padding-top:0;margin-bottom:18px">
                    <div><small>Expected finish</small><b>${projection.expPos.toFixed(1)}</b></div>
                    <div><small>Expected points</small><b>${projection.expPts.toFixed(0)}</b></div>
                  </div>
                  <div class="race">
                    <div class="race__row"><span>Title</span><em>${projection.title.toFixed(1)}%</em>
                      <span class="race__track"><i style="width:${Math.max(1, projection.title)}%"></i></span></div>
                    <div class="race__row"><span>Top four</span><em>${projection.top4.toFixed(1)}%</em>
                      <span class="race__track"><i style="width:${Math.max(1, projection.top4)}%"></i></span></div>
                    <div class="race__row"><span>Bottom three</span><em>${projection.bottom3.toFixed(1)}%</em>
                      <span class="race__track"><i style="width:${Math.max(1, projection.bottom3)}%"></i></span></div>
                  </div>
                  <p class="panel__note">Ten to ninety percent range: ${projection.posSpread[0].toFixed(0)}–${projection.posSpread[1].toFixed(0)}.</p>`
                : `<p class="panel__note">No projection available.</p>`
            }
          </div>
        </div>
      </section>

      <section class="band">
        <div class="split">
          <div>
            <div class="bandhead"><div class="bandhead__title"><h2>Recent results</h2></div>
              <span class="label">Last ${results.length}</span></div>
            <div class="rows">
              ${
                results.length
                  ? results
                      .map((entry) => {
                        const opponent = teamByFd(team.league, entry.opponent);
                        return `<div class="resultrow">
                          <span class="formstrip"><i class="${entry.result.toLowerCase()}">${entry.result}</i></span>
                          <time datetime="${esc(entry.date)}">${esc(fmtDate(entry.date))}</time>
                          <span>${entry.venue === "H" ? "vs" : "at"} ${esc(opponent?.name || entry.opponent)}</span>
                          <b>${esc(entry.score)}</b>
                        </div>`;
                      })
                      .join("")
                  : `<p class="panel__note">No results yet this season.</p>`
              }
            </div>
          </div>

          <div class="panel" style="border-top:0;padding-top:0">
            <h3>Season so far</h3>
            <div class="facts">
              ${facts.map(([label, value]) => `<div><span>${esc(label)}</span><b>${esc(String(value))}</b></div>`).join("")}
            </div>
            <p class="panel__note">Evidence: ${team.played} matches in this division.</p>
          </div>
        </div>
      </section>

      <section class="band">
        ${bandHead({ idx: "01", title: "Upcoming fixtures", href: "/matches", label: "Fixture board" })}
        <div class="matchlist">${upcoming.map((fixture) => matchRow(fixture)).join("")}</div>
      </section>
    </div>`,
    title: `${team.name} — Footyline`,
    crumb: team.name,
    nav: "matches",
  };
}
