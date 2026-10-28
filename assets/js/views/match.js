import { esc, pctOf, fmtKickoff, reliabilityTier, fmtDate } from "../util.js";
import { state, team as getTeam, headToHead } from "../store.js";
import { matchRow, teamBadge, leagueTag, starButton, triBar, formStrip } from "../ui.js";
import { buildMarkets, fixtureMatrix, goalDistribution } from "../engine.js";
import { heatGrid, goalChart } from "../charts.js";

const bandNote = (probability) => {
  const bins = state.metrics?.calibration || [];
  const bin = bins.find((entry) => probability >= entry.low && probability < entry.high) || bins[bins.length - 1];
  if (!bin || !bin.count || bin.observed === null) return null;
  return {
    text: `Forecasts in the ${Math.round(bin.low * 100)}–${Math.round(bin.high * 100)}% band landed ${Math.round(
      bin.observed * 100,
    )}% of the time in the backtest.`,
    count: bin.count,
  };
};

const cmpRow = (label, left, right, higherWins = true) => {
  const a = left === "—" || left === null ? null : Number(left);
  const b = right === "—" || right === null ? null : Number(right);
  const leftWins = a !== null && b !== null && (higherWins ? a > b : a < b);
  const rightWins = a !== null && b !== null && (higherWins ? b > a : b < a);
  return `<tr>
    <td${leftWins ? ' class="win"' : ""}>${left}</td>
    <th scope="row" style="text-align:center;border:0;padding:7px 0;font:400 12px var(--display);letter-spacing:0;text-transform:none;color:var(--muted)">${esc(label)}</th>
    <td${rightWins ? ' class="win"' : ""}>${right}</td>
  </tr>`;
};

export default function matchView({ id }) {
  const fixture = state.fixtureById.get(id);
  if (!fixture) {
    return {
      html: `<div class="view"><div class="empty"><strong>Fixture not found</strong><span>It may already have been played. The board only lists matches still to come.</span><div style="margin-top:12px"><a class="btn" href="/matches" data-link>Fixtures</a></div></div></div>`,
      title: "Not found — Footyline",
      crumb: "Not found",
      nav: "matches",
    };
  }

  const league = state.leagues.get(state.leaguesByCode.get(fixture.league).id);
  const home = getTeam(fixture.home);
  const away = getTeam(fixture.away);
  const kickoff = fmtKickoff(fixture.date);
  const matrix = fixtureMatrix(fixture, league);
  const markets = buildMarkets(matrix);
  const { home: pHome, draw: pDraw, away: pAway } = markets;
  const best = Math.max(pHome, pDraw, pAway);
  const tier = reliabilityTier(fixture.rel);
  const note = bandNote(best);
  const h2h = headToHead(home.id, away.id);
  const homeRow = state.tableByLeague.get(league.id)?.get(home.id);
  const awayRow = state.tableByLeague.get(league.id)?.get(away.id);
  const homeStats = home.stats;
  const awayStats = away.stats;

  const marketsMarkup = markets.groups
    .map((group) => {
      const top = Math.max(...group.items.map((item) => item.value));
      return `<div class="marketgroup">
        <h3>${esc(group.title)}</h3>
        ${group.items
          .map(
            (item) => `<div class="market ${item.value === top ? "market--lead" : ""}">
              <span>${esc(item.label)}</span><b>${pctOf(item.value * 100)}</b>
            </div>`,
          )
          .join("")}
      </div>`;
    })
    .join("");

  const related = state.fixturesByLeague
    .get(league.id)
    .filter((item) => item.id !== fixture.id && new Date(item.date) > new Date(fixture.date))
    .slice(0, 4);

  return {
    html: `<div class="view">
      <div class="backrow">
        <a href="/matches" data-link>Fixtures</a>
        <span class="backrow__sep">/</span>
        <a href="/league/${esc(league.id)}" data-link>${esc(league.name)}</a>
      </div>

      <section class="scorecard" style="margin-top:16px">
        <div class="scorecard__meta">
          <span>${esc(kickoff.long)}</span>
          <span>${esc(kickoff.time)}</span>
          ${fixture.round ? `<span>Round ${fixture.round}</span>` : ""}
          ${fixture.venue ? `<span>${esc(fixture.venue)}</span>` : ""}
          <span style="margin-left:auto">${leagueTag(league.id)}</span>
        </div>

        <div class="scorecard__teams">
          <a class="scorecard__team" href="/team/${esc(home.id)}" data-link>
            ${teamBadge(home, "lg")}
            <span>
              <h1>${esc(home.name)}</h1>
              <small>${homeRow ? `#${homeRow.position} · ${homeStats?.points ?? 0} pts` : "—"}</small>
            </span>
          </a>
          <div style="text-align:center">
            <div class="scorecard__vs">${esc(kickoff.time)}</div>
            <small class="label" style="display:block;margin-top:6px">Most likely ${esc(fixture.cs.replace("-", "–"))}</small>
          </div>
          <a class="scorecard__team scorecard__team--away" href="/team/${esc(away.id)}" data-link>
            ${teamBadge(away, "lg")}
            <span>
              <h1>${esc(away.name)}</h1>
              <small>${awayRow ? `#${awayRow.position} · ${awayStats?.points ?? 0} pts` : "—"}</small>
            </span>
          </a>
        </div>

        <div class="outcomes">
          <div class="outcome ${best === pHome ? "outcome--lead" : ""}">
            <small>Home win</small><b>${pctOf(pHome * 100)}</b><em>${esc(home.short)}</em>
          </div>
          <div class="outcome ${best === pDraw ? "outcome--lead" : ""}">
            <small>Draw</small><b>${pctOf(pDraw * 100)}</b><em>Level</em>
          </div>
          <div class="outcome ${best === pAway ? "outcome--lead" : ""}">
            <small>Away win</small><b>${pctOf(pAway * 100)}</b><em>${esc(away.short)}</em>
          </div>
        </div>
        ${triBar(fixture.p, "splitbar")}
        <div class="factbar">
          <span>Expected goals <b>${fixture.lh.toFixed(2)} – ${fixture.la.toFixed(2)}</b></span>
          <span>Total goals <b>${markets.expectedTotal.toFixed(2)}</b></span>
          <span>Reliability <b>${fixture.rel}/100 · ${tier.label}</b></span>
          <span style="margin-left:auto">${starButton(fixture.id, "match")}</span>
        </div>
      </section>

      <section class="band">
        <div class="split">
          <div class="panel" style="border-top:0;padding-top:0">
            <h3>Scoreline grid</h3>
            ${heatGrid(matrix, home.short, away.short)}
            <div style="margin-top:18px;max-width:420px">
              <h3 style="margin-bottom:10px">Total goals</h3>
              ${goalChart(goalDistribution(matrix, 6), ["0", "1", "2", "3", "4", "5", "6+"])}
            </div>
          </div>

          <div>
            <div class="panel" style="border-top:0;padding-top:0">
              <h3>Reading it</h3>
              <dl class="kv">
                <dt>Expected goals · ${esc(home.short)}</dt><dd>${fixture.lh.toFixed(2)}</dd>
                <dt>Expected goals · ${esc(away.short)}</dt><dd>${fixture.la.toFixed(2)}</dd>
                <dt>League home edge</dt><dd>+${league.homeAdvantage.toFixed(2)}</dd>
                <dt>Low-score correlation</dt><dd>${league.rho.toFixed(3)}</dd>
                <dt>Evidence</dt><dd>${Math.round(fixture.ev)}%</dd>
              </dl>
              <p class="panel__note">${esc(tier.label)} reliability at ${fixture.rel}/100. ${
                fixture.ev >= 100
                  ? "Both sides carry a full season of evidence in this division."
                  : "One or both sides are still building evidence, so ratings lean on their prior."
              }</p>
              ${note ? `<p class="panel__note">${esc(note.text)} <span class="dim">n = ${note.count.toLocaleString()}.</span></p>` : ""}
            </div>

            ${
              h2h
                ? `<div class="panel" style="margin-top:26px">
                    <h3>Head to head</h3>
                    <div class="h2h">
                      <div><b>${h2h.hw}</b><span>${esc(home.short)} wins</span></div>
                      <div><b>${h2h.d}</b><span>Draws</span></div>
                      <div><b>${h2h.aw}</b><span>${esc(away.short)} wins</span></div>
                    </div>
                    <p class="panel__note">${h2h.gf + h2h.ga} goals in ${h2h.n} meetings · last played ${esc(fmtDate(h2h.last))}</p>
                  </div>`
                : ""
            }
          </div>
        </div>
      </section>

      <section class="band">
        <div class="bandhead"><div class="bandhead__title"><h2>Markets</h2></div>
          <span class="label">Every price from one grid</span>
        </div>
        <div class="markets">${marketsMarkup}</div>
      </section>

      <section class="band">
        <div class="bandhead"><div class="bandhead__title"><h2>The two sides</h2></div></div>
        <div class="split">
          <table class="compare">
            <thead><tr><th>${esc(home.short)}</th><th></th><th>${esc(away.short)}</th></tr></thead>
            <tbody>
              ${cmpRow("Position", homeRow?.position ?? "—", awayRow?.position ?? "—", false)}
              ${cmpRow("Points", homeStats?.points ?? "—", awayStats?.points ?? "—")}
              ${cmpRow("Played", homeStats?.played ?? "—", awayStats?.played ?? "—")}
              ${cmpRow("Goals for", homeStats?.gf ?? "—", awayStats?.gf ?? "—")}
              ${cmpRow("Goals against", homeStats?.ga ?? "—", awayStats?.ga ?? "—", false)}
              ${cmpRow("Points per game", homeStats?.ppg?.toFixed(2) ?? "—", awayStats?.ppg?.toFixed(2) ?? "—")}
              ${homeStats?.xg != null && awayStats?.xg != null ? cmpRow("xG for", homeStats.xg.toFixed(2), awayStats.xg.toFixed(2)) : ""}
              ${homeStats?.xga != null && awayStats?.xga != null ? cmpRow("xG against", homeStats.xga.toFixed(2), awayStats.xga.toFixed(2), false) : ""}
              ${cmpRow("Attack rating", (home.attack ?? 0).toFixed(2), (away.attack ?? 0).toFixed(2))}
              ${cmpRow("Defence rating", (home.defence ?? 0).toFixed(2), (away.defence ?? 0).toFixed(2), false)}
              ${cmpRow("Elo", home.elo ?? "—", away.elo ?? "—")}
            </tbody>
          </table>
          <div>
            <div class="panel" style="border-top:0;padding-top:0">
              <h3>Recent form</h3>
              <div style="display:flex;justify-content:space-between;gap:16px;padding:6px 0 12px;border-bottom:1px solid var(--rule)">
                <span class="label">${esc(home.short)}</span>${formStrip(home.form, 6)}
              </div>
              <div style="display:flex;justify-content:space-between;gap:16px;padding:12px 0">
                <span class="label">${esc(away.short)}</span>${formStrip(away.form, 6)}
              </div>
            </div>
            <p class="disclaimer">A probability, not a promise. A 60% favourite loses two times in five.</p>
          </div>
        </div>
      </section>

      ${
        related.length
          ? `<section class="band">
              <div class="bandhead"><div class="bandhead__title"><h2>Elsewhere in ${esc(league.name)}</h2></div>
                <a class="bandhead__link" href="/matches?league=${encodeURIComponent(league.id)}" data-link>Filter</a>
              </div>
              <div class="matchlist">${related.map((item) => matchRow(item)).join("")}</div>
            </section>`
          : ""
      }
    </div>`,
    title: `${home.name} vs ${away.name} — Footyline`,
    crumb: `${home.short} v ${away.short}`,
    nav: "matches",
  };
}
