import { esc, plural, fmtKickoff, relativeDay } from "../util.js";
import { state, team as getTeam, league as getLeague } from "../store.js";
import { fixtureCard, sectionHead, teamBadge, leagueTint } from "../ui.js";

export default function watchlistView() {
  const ids = [...state.watch];
  const fixtures = ids
    .map((id) => state.fixtureById.get(id))
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  const teams = ids.map((id) => state.teams.get(id)).filter(Boolean);

  const empty =
    !fixtures.length && !teams.length
      ? `<div class="empty" style="margin-top:28px">
          <strong>Nothing saved yet</strong>
          <span>Tap the star on any fixture, or save a club from its page. Your list lives in this browser only.</span>
          <a class="btn" href="/matches" data-link style="margin-top:12px">Browse fixtures</a>
        </div>`
      : "";

  return {
    html: `<div class="view">
      <div class="pagehead">
        <div class="pagehead__id">
          <div>
            <p class="eyebrow">Watchlist</p>
            <h1>Saved for later</h1>
            <small>${plural(fixtures.length, "fixture")} · ${plural(teams.length, "club")} · stored locally, never uploaded.</small>
          </div>
        </div>
      </div>

      ${empty}

      ${
        fixtures.length
          ? `<section class="section">
              ${sectionHead({ eyebrow: "Fixtures", title: "Your board" })}
              <div class="fixture-grid">${fixtures.map((fixture) => fixtureCard(fixture, { showForm: true })).join("")}</div>
            </section>`
          : ""
      }

      ${
        teams.length
          ? `<section class="section">
              ${sectionHead({ eyebrow: "Clubs", title: "Followed clubs" })}
              <div class="club-grid">${teams
                .map((club) => {
                  const league = getLeague(state.leaguesByCode.get(club.league)?.id || club.league);
                  const isHomeNext = (state.upcomingByTeam.get(club.id) || [])[0];
                  return `<a class="club-card" href="/team/${esc(club.id)}" data-link>
                    <span class="club-card__badge" style="--badge:${esc(club.color)}"></span>
                    ${teamBadge(club, "lg")}
                    <strong>${esc(club.name)}</strong>
                    <small>${esc(league.name)}${club.position ? ` · #${club.position}` : ""}</small>
                    ${
                      isHomeNext
                        ? `<span class="club-card__next">Next: ${esc(relativeDay(isHomeNext.date))} · ${esc(
                            fmtKickoff(isHomeNext.date).time,
                          )}</span>`
                        : ""
                    }
                  </a>`;
                })
                .join("")}</div>
            </section>`
          : ""
      }
    </div>`,
    title: "Watchlist — Footyline",
    crumb: "Watchlist",
    nav: "watchlist",
  };
}
