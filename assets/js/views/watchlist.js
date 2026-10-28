import { esc, plural, fmtKickoff, relativeDay } from "../util.js";
import { state, team as getTeam, league as getLeague } from "../store.js";
import { bandHead, matchRow, teamBadge } from "../ui.js";

export default function watchlistView() {
  const ids = [...state.watch];
  const fixtures = ids
    .map((id) => state.fixtureById.get(id))
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  const clubs = ids.map((id) => state.teams.get(id)).filter(Boolean);

  const empty =
    !fixtures.length && !clubs.length
      ? `<div class="empty" style="margin-top:24px">
          <strong>Nothing saved yet</strong>
          <span>Use the star on any fixture row or club page. The list lives in this browser and is never uploaded.</span>
          <div style="margin-top:14px"><a class="btn" href="/matches" data-link>Browse fixtures</a></div>
        </div>`
      : "";

  return {
    html: `<div class="view">
      <div class="pagehead">
        <p class="label">Saved</p>
        <h1 style="margin-top:10px">Your board</h1>
        <p class="lede" style="margin-top:14px">${plural(fixtures.length, "fixture")} and ${plural(
          clubs.length,
          "club",
        )} kept locally.</p>
      </div>

      ${empty}

      ${
        fixtures.length
          ? `<section class="band band--ink">
              ${bandHead({ idx: "01", title: "Fixtures" })}
              <div class="matchlist">${fixtures.map((fixture) => matchRow(fixture)).join("")}</div>
            </section>`
          : ""
      }

      ${
        clubs.length
          ? `<section class="band">
              ${bandHead({ idx: "02", title: "Clubs" })}
              <div class="clubs">${clubs
                .map((club) => {
                  const league = getLeague(state.leaguesByCode.get(club.league)?.id || club.league);
                  const next = (state.upcomingByTeam.get(club.id) || [])[0];
                  return `<a class="club" href="/team/${esc(club.id)}" data-link>
                    ${teamBadge(club, "lg")}
                    <span class="club__text">
                      <strong>${esc(club.name)}</strong>
                      <small>${esc(league.name)}${club.position ? ` · #${club.position}` : ""}${
                        next ? ` · next ${relativeDay(next.date)} ${fmtKickoff(next.date).time}` : ""
                      }</small>
                    </span>
                  </a>`;
                })
                .join("")}</div>
            </section>`
          : ""
      }
    </div>`,
    title: "Saved — Footyline",
    crumb: "Saved",
    nav: "watchlist",
  };
}
