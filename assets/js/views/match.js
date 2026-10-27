import { esc, pctOf, fmtKickoff, fmtDate, reliabilityTier, relativeDay } from "../util.js";
import { state, team as getTeam, league as getLeague, headToHead } from "../store.js";
import {
  fixtureCard, sectionHead, teamBadge, leagueTag, starButton, formChips, probBar,
} from "../ui.js";
import { buildMarkets, fixtureMatrix, goalDistribution } from "../engine.js";
import { scoreHeatmap, goalChart } from "../charts.js";

const bandNote = (probability) => {
  const bins = state.metrics?.calibration || [];
  const bin = bins.find((entry) => probability >= entry.low && probability < entry.high)
    || bins[bins.length - 1];
  if (!bin || !bin.count || bin.observed === null) return null;
  return {
    text: `In the backtest, forecasts in the ${Math.round(bin.low * 100)}–${Math.round(bin.high * 100)}% band landed ${Math.round(
      bin.observed * 100,
    )}% of the time.`,
    count: bin.count,
  };
};

const compareRow = (label, left, right, suffix = "") => `
  <div class="compare__row">
    <b>${left ?? "—"}${suffix}</b>
    <span>${esc(label)}</span>
    <b>${right ?? "—"}${suffix}</b>
  </div>`;

export default function matchView({ id }) {
  const fixture = state.fixtureById.get(id);
  if (!fixture) {
    return {
      html: `<div class="view"><div class="empty"><strong>Fixture not found</strong><span>It may have been played already. Head back to the match centre for the latest board.</span><a class="btn" href="/matches" data-link style="margin-top:12px">Match centre</a></div></div>`,
      title: "Not found — Footyline",
      crumb: "Not found",
      nav: "matches",
    };
  }

  const league = getLeague(state.leaguesByCode.get(fixture.league).id);
  const home = getTeam(fixture.home);
  const away = getTeam(fixture.away);
  const kickoff = fmtKickoff(fixture.date);
  const matrix = fixtureMatrix(fixture, league);
  const markets = buildMarkets(matrix);
  const { home: pHome, draw: pDraw, away: pAway } = markets;
  const best = Math.max(pHome, pDraw, pAway);
  const pick = best === pHome ? 0 : best === pAway ? 2 : 1;
  const tier = reliabilityTier(fixture.rel);
  const note = bandNote(best);
  const h2h = headToHead(home.id, away.id);

  const outcomeCard = (label, value, teamName, isLead) => `
    <div class="outcome ${isLead ? "outcome--lead" : ""}">
      <small>${esc(label)}</small>
      <b>${pctOf(value * 100)}</b>
      <em>${esc(teamName)}</em>
    </div>`;

  const marketsMarkup = markets.groups
    .map((group) => {
      const top = Math.max(...group.items.map((item) => item.value));
      return `<section class="market-group">
        <h3 class="market-group__title">${esc(group.title)}</h3>
        ${group.items
          .map(
            (item) => `<div class="market-row ${item.value === top ? "market-row--lead" : ""}">
              <div class="market-row__label"><span class="${item.value === top ? "sel" : ""}">${esc(item.label)}</span></div>
              <div class="market-row__value">${pctOf(item.value * 100)}</div>
              <div class="market-row__track"><i style="width:${Math.min(100, item.value * 100).toFixed(1)}%"></i></div>
            </div>`,
          )
          .join("")}
      </section>`;
    })
    .join("");

  const homeStats = home.stats;
  const awayStats = away.stats;
  const homeRow = state.tableByLeague.get(league.id)?.get(home.id);
  const awayRow = state.tableByLeague.get(league.id)?.get(away.id);

  const comparison = `<section class="card">
    <div class="panel-head"><h3>Season so far</h3><span class="eyebrow">${esc(league.name)}</span></div>
    <div class="compare">
      <header class="compare__head">
        <div>${teamBadge(home, "sm")}<span>${esc(home.name)}</span></div>
        <div><span>${esc(away.name)}</span>${teamBadge(away, "sm")}</div>
      </header>
      ${compareRow("Position", homeRow?.position ?? "—", awayRow?.position ?? "—")}
      ${compareRow("Points", homeStats?.points ?? "—", awayStats?.points ?? "—")}
      ${compareRow("Played", homeStats?.played ?? "—", awayStats?.played ?? "—")}
      ${compareRow("Goals for", homeStats?.gf ?? "—", awayStats?.gf ?? "—")}
      ${compareRow("Goals against", homeStats?.ga ?? "—", awayStats?.ga ?? "—")}
      ${compareRow("Points per game", homeStats?.ppg?.toFixed(2) ?? "—", awayStats?.ppg?.toFixed(2) ?? "—")}
      ${homeStats?.xg != null && awayStats?.xg != null ? compareRow("xG for", homeStats.xg.toFixed(2), awayStats.xg.toFixed(2)) : ""}
      ${homeStats?.xga != null && awayStats?.xga != null ? compareRow("xG against", homeStats.xga.toFixed(2), awayStats.xga.toFixed(2)) : ""}
      ${compareRow("Attack rating", (home.attack ?? 0).toFixed(2), (away.attack ?? 0).toFixed(2))}
      ${compareRow("Defence rating", (home.defence ?? 0).toFixed(2), (away.defence ?? 0).toFixed(2))}
      ${compareRow("Elo", home.elo ?? "—", away.elo ?? "—")}
    </div>
    <div class="compare__form">
      <div><small>HOME FORM</small>${formChips(home.form, 6)}</div>
      <div><small>AWAY FORM</small>${formChips(away.form, 6)}</div>
    </div>
  </section>`;

  const h2hMarkup = h2h
    ? `<section class="card">
        <div class="panel-head"><h3>Head to head</h3><span class="eyebrow">Last ${h2h.n}</span></div>
        <div class="panel-body">
          <div class="h2h">
            <div><b>${h2h.hw}</b><span>${esc(home.short)} wins</span></div>
            <div><b>${h2h.d}</b><span>Draws</span></div>
            <div><b>${h2h.aw}</b><span>${esc(away.short)} wins</span></div>
          </div>
          <div class="h2h__meta">
            <span>${h2h.gf + h2h.ga} goals in ${h2h.n} meetings</span>
            <span>Last played ${esc(fmtDate(h2h.last))}</span>
          </div>
        </div>
      </section>`
    : "";

  const related = state.fixturesByLeague
    .get(league.id)
    .filter((item) => item.id !== fixture.id && new Date(item.date) > new Date(fixture.date))
    .slice(0, 3);

  const html = `<div class="view">
    <div class="backrow">
      <a class="backlink" href="/matches" data-link><svg><use href="#i-back"/></svg>Match centre</a>
      <span class="backrow__sep">/</span>
      <a href="/league/${esc(league.id)}" data-link>${esc(league.name)}</a>
      ${starButton(fixture.id, "match")}
    </div>

    <section class="matchhead">
      <div class="matchhead__meta">
        ${leagueTag(league.id)}
        <span>${esc(kickoff.long)}</span>
        <span>${esc(kickoff.time)}</span>
        ${fixture.round ? `<span>Round ${fixture.round}</span>` : ""}
        ${fixture.venue ? `<span class="venue">${esc(fixture.venue)}</span>` : ""}
      </div>
      <div class="matchhead__board">
        <a class="matchhead__team" href="/team/${esc(home.id)}" data-link>
          ${teamBadge(home, "lg")}
          <h1>${esc(home.name)}</h1>
          <small>${homeRow ? `#${homeRow.position} · ${homeStats?.points ?? 0} pts` : "—"}</small>
        </a>
        <div class="matchhead__centre">
          <span class="matchhead__score">${esc(fixture.cs.replace("-", "–"))}</span>
          <small>Most likely score</small>
        </div>
        <a class="matchhead__team" href="/team/${esc(away.id)}" data-link>
          ${teamBadge(away, "lg")}
          <h1>${esc(away.name)}</h1>
          <small>${awayRow ? `#${awayRow.position} · ${awayStats?.points ?? 0} pts` : "—"}</small>
        </a>
      </div>

      <div class="outcome-row">
        ${outcomeCard("Home win", pHome, home.short, pick === 0)}
        ${outcomeCard("Draw", pDraw, "Level", pick === 1)}
        ${outcomeCard("Away win", pAway, away.short, pick === 2)}
      </div>
      ${probBar(fixture.p, "split-bar")}

      <div class="matchhead__foot">
        <span>Expected goals <b>${fixture.lh.toFixed(2)} – ${fixture.la.toFixed(2)}</b></span>
        <span>Total goals <b>${markets.expectedTotal.toFixed(2)}</b></span>
        <span>Reliability <b>${fixture.rel}/100 · ${tier.label}</b></span>
      </div>
    </section>

    <div class="detail-grid">
      <section class="card">
        <div class="panel-head"><h3>Scoreline probability</h3><span class="eyebrow">Dixon-Coles grid</span></div>
        <div class="matrix-wrap">${scoreHeatmap(matrix, home.short, away.short)}</div>
        <p class="matrix__cap">Each cell is the modelled chance of that exact score. Rows are ${esc(
          home.short,
        )} goals, columns ${esc(away.short)}.</p>
      </section>

      <section class="card">
        <div class="panel-head"><h3>How to read this forecast</h3><span class="eyebrow">Model notes</span></div>
        <div class="panel-body stack">
          <dl class="kv">
            <dt>Expected goals · ${esc(home.short)}</dt><dd>${fixture.lh.toFixed(2)}</dd>
            <dt>Expected goals · ${esc(away.short)}</dt><dd>${fixture.la.toFixed(2)}</dd>
            <dt>League home edge</dt><dd>+${league.homeAdvantage.toFixed(2)}</dd>
            <dt>Low-score correlation</dt><dd>${league.rho.toFixed(3)}</dd>
            <dt>Evidence (matches each)</dt><dd>${Math.round(fixture.ev)}%</dd>
          </dl>
          <div class="readnote">
            <p>${esc(tier.label)} reliability at ${fixture.rel}/100. ${esc(
              fixture.ev >= 100
                ? "Both sides carry a full season of evidence in this division."
                : "One or both sides are still building evidence, so ratings lean on their prior.",
            )}</p>
            ${note ? `<p>${esc(note.text)} <span class="dim">n = ${note.count.toLocaleString()} forecasts.</span></p>` : ""}
            <p class="dim">Probabilities assume the league's average home advantage and the ratings fitted after the last completed matchday.</p>
          </div>
          <div>
            <p class="eyebrow" style="margin-bottom:8px">Most likely scorelines</p>
            <div class="scorelist">
              ${markets.topScores
                .slice(0, 5)
                .map(
                  (score) =>
                    `<div class="scorelist__row"><span>${score.home}–${score.away}</span><b>${pctOf(score.p * 100)}</b></div>`,
                )
                .join("")}
            </div>
          </div>
        </div>
      </section>
    </div>

    <section class="section">
      ${sectionHead({ eyebrow: "Modelled markets", title: "Every market, from one grid" })}
      <div class="markets-grid">${marketsMarkup}</div>
    </section>

    <section class="section">
      ${sectionHead({ eyebrow: "Comparison", title: "The two sides" })}
      <div class="detail-grid">
        ${comparison}
        <div class="stack">
          ${h2hMarkup}
          <section class="card">
            <div class="panel-head"><h3>Goal distribution</h3><span class="eyebrow">Total goals</span></div>
            <div class="panel-body">
              ${goalChart(goalDistribution(matrix, 6), ["0", "1", "2", "3", "4", "5", "6+"])}
              <p class="chart-note">Most likely total: <b>${
                goalDistribution(matrix, 6).indexOf(Math.max(...goalDistribution(matrix, 6)))
              }</b> goals · expected <b>${markets.expectedTotal.toFixed(2)}</b></p>
            </div>
          </section>
        </div>
      </div>
    </section>

    ${
      related.length
        ? `<section class="section">
            ${sectionHead({ eyebrow: "Elsewhere in " + league.name, title: "Next in this competition" })}
            <div class="fixture-grid">${related.map((item) => fixtureCard(item)).join("")}</div>
          </section>`
        : ""
    }

    <p class="disclaimer"><strong>Reminder.</strong> This is a probability, not a prediction of certainty.
    A 60% favourite loses two times in five. Footyline is statistical information, not betting advice.</p>
  </div>`;

  return {
    html,
    title: `${home.name} vs ${away.name} — Footyline`,
    crumb: `${home.short} v ${away.short}`,
    nav: "matches",
    scrollTop: true,
  };
}
