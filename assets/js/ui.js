/* Shared markup helpers. All user-facing strings are escaped. */

import { esc, inkFor, pctOf, reliabilityTier, fmtKickoff, relativeDay, resultLabel } from "./util.js";
import { isWatched, league as getLeague, team as getTeam, state } from "./store.js";

const LEAGUE_TINT = {
  E0: "#d8b25a", E1: "#93a97c", SP1: "#e0704f", I1: "#5b9bd5", D1: "#b07cc9",
  F1: "#63b3a0", F2: "#a3b07a", N1: "#e0914a", P1: "#3fae8f", T1: "#cf7180", SC0: "#8c9be0",
};

export const leagueTint = (code) => LEAGUE_TINT[code] || "var(--faint)";

export const teamBadge = (team, size = "") => {
  if (!team) return "";
  const ink = inkFor(team.color || "#33513f");
  return `<span class="badge ${size ? `badge--${size}` : ""}" style="--badge:${esc(team.color)};--badge-ink:${ink}" aria-hidden="true">${esc(team.short)}</span>`;
};

export const leagueTag = (leagueId) => {
  const league = getLeague(leagueId);
  return `<span class="league-tag" style="--league:${leagueTint(league.code)}"><i></i>${esc(league.short || league.name)}</span>`;
};

export const formChips = (form = [], count = 5) => {
  const slice = form.slice(-count);
  if (!slice.length) return `<span class="formline" aria-label="No recent matches"></span>`;
  return `<span class="formline" role="img" aria-label="Recent form: ${slice
    .map((entry) => `${entry.result} ${entry.score} vs ${entry.opponent}`)
    .join(", ")}">${slice
    .map(
      (entry) =>
        `<i class="form-chip form-chip--${entry.result.toLowerCase()}" title="${esc(
          `${entry.result} ${entry.score} ${entry.venue === "H" ? "vs" : "at"} ${entry.opponent}`,
        )}">${entry.result}</i>`,
    )
    .join("")}</span>`;
};

const meter = (score) => {
  const tier = reliabilityTier(score);
  const bars = Array.from({ length: 4 }, (_, index) =>
    `<i class="${index < tier.level ? "on" : ""}"></i>`,
  ).join("");
  return `<span class="meter ${tier.level <= 2 ? "meter--low" : ""}" title="Model reliability ${score}/100 · ${tier.label}" aria-label="Reliability ${tier.label}">${bars}</span>`;
};

export const probCells = (fixture) => {
  const [home, draw, away] = fixture.p;
  const leading = Math.max(home, draw, away);
  const cell = (label, value) =>
    `<div class="prob__cell ${value === leading ? "prob__cell--lead" : ""}">
      <small>${label}</small><b>${pctOf(value * 100)}</b>
    </div>`;
  return `<div class="prob">${cell("1", home)}${cell("X", draw)}${cell("2", away)}</div>`;
};

export const probBar = (p, className = "bar") => {
  const [home, draw, away] = p;
  return `<div class="${className}" role="img" aria-label="Home ${pctOf(home * 100)}, draw ${pctOf(
    draw * 100,
  )}, away ${pctOf(away * 100)}">
    <span class="bar__seg bar__seg--home" style="width:${(home * 100).toFixed(2)}%"></span>
    <span class="bar__seg bar__seg--draw" style="width:${(draw * 100).toFixed(2)}%"></span>
    <span class="bar__seg bar__seg--away" style="width:${(away * 100).toFixed(2)}%"></span>
  </div>`;
};

export const starButton = (id, label = "fixture") => {
  const active = isWatched(id);
  return `<button class="icon-btn" type="button" data-watch="${esc(id)}" aria-pressed="${active}" aria-label="${
    active ? "Remove from" : "Add to"
  } watchlist" title="${active ? "Saved" : "Save"} ${label}">
    <svg width="14" height="14" fill="${active ? "currentColor" : "none"}" style="color:${
      active ? "var(--accent)" : "currentColor"
    }"><use href="#i-star"/></svg>
  </button>`;
};

export function fixtureCard(fixture, options = {}) {
  const home = getTeam(fixture.home);
  const away = getTeam(fixture.away);
  const league = getLeague(state.leaguesByCode.get(fixture.league)?.id || fixture.league);
  const kickoff = fmtKickoff(fixture.date);
  const [home_, draw, away_] = fixture.p;
  const best = Math.max(home_, draw, away_);
  const pick = best === home_ ? "Home" : best === away_ ? "Away" : "Draw";
  const showForm = options.showForm ?? false;
  const over = options.markets ?? null;

  return `<article class="card fixture ${options.className || ""}" data-fixture="${esc(fixture.id)}">
    <div class="fixture__top">
      ${leagueTag(league.id)}
      <time datetime="${esc(fixture.date)}">${esc(relativeDay(fixture.date))} · ${kickoff.time}</time>
      <span class="spacer"></span>
      ${starButton(fixture.id)}
    </div>
    <a class="fixture__teams" href="/match/${esc(fixture.id)}" data-link aria-label="${esc(
      `${home.name} versus ${away.name}, ${pick} most likely at ${pctOf(best * 100)}`,
    )}">
      <span class="team-line">${teamBadge(home)}<strong>${esc(home.name)}</strong></span>
      <span class="fixture__kickoff">vs</span>
      <span class="team-line team-line--away">${teamBadge(away)}<strong>${esc(away.name)}</strong></span>
    </a>
    ${showForm
      ? `<div class="fixture__form">
          <div>${formChips(home.form)}</div>
          <div>${formChips(away.form)}</div>
        </div>`
      : ""}
    ${probCells(fixture)}
    ${probBar(fixture.p)}
    <div class="fixture__meta">
      <span>Exp. goals <b>${Number(fixture.lh).toFixed(2)}–${Number(fixture.la).toFixed(2)}</b></span>
      <span class="spacer"></span>
      <span title="Most likely correct score">${esc(fixture.cs)}</span>
      ${meter(fixture.rel)}
    </div>
  </article>`;
}

export function sectionHead({ eyebrow, title, href, linkLabel = "View all" }) {
  return `<div class="section__head">
    <div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ""}<h2>${esc(title)}</h2></div>
    ${
      href
        ? `<a class="section__link" href="${esc(href)}" data-link>${esc(linkLabel)}<svg><use href="#i-arrow"/></svg></a>`
        : ""
    }
  </div>`;
}

export const emptyState = (title, body) =>
  `<div class="empty"><strong>${esc(title)}</strong><span>${esc(body)}</span></div>`;

export const probabilityRow = (label, value, { muted = false, max = 1 } = {}) => `
  <div class="market-row ${muted ? "market-row--muted" : ""}">
    <div class="market-row__label"><span>${esc(label)}</span></div>
    <div class="market-row__value">${pctOf(value * 100)}</div>
    <div class="market-row__track"><i style="width:${Math.min(100, (value / max) * 100).toFixed(1)}%"></i></div>
  </div>`;

export const outcomeName = (index) => resultLabel(index);

export const dateChip = (iso) => {
  const { day, time } = fmtKickoff(iso);
  return `${day} · ${time}`;
};
