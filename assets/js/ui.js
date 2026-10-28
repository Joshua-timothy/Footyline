/* Shared markup helpers for the "Programme" design. */

import { esc, inkFor, fmtKickoff, relativeDay, reliabilityTier, pctOf } from "./util.js";
import { isWatched, state } from "./store.js";

/* Muted, print-like competition tints. */
const LEAGUE_INK = {
  E0: "#14140f", E1: "#6d6b5f", SP1: "#b3261e", I1: "#1f3a8a", D1: "#7a4b8f",
  F1: "#0f6b43", F2: "#4d6b3a", N1: "#a15c00", P1: "#0d6b6b", T1: "#8f2d56", SC0: "#3a5a8f",
};

export const leagueTint = (code) => LEAGUE_INK[code] || "var(--muted)";

export const teamBadge = (team, size = "") => {
  if (!team) return "";
  const ink = inkFor(team.color || "#333");
  return `<span class="badge ${size ? `badge--${size}` : ""}" style="--badge:${esc(team.color)};--badge-ink:${ink}" aria-hidden="true">${esc(team.short)}</span>`;
};

export const leagueTag = (leagueId) => {
  const league = state.leagues.get(leagueId);
  if (!league) return "";
  return `<span class="tag" style="--tone:${leagueTint(league.code)}"><i></i>${esc(league.short || league.name)}</span>`;
};

export const formStrip = (form = [], count = 5) => {
  const slice = form.slice(-count);
  if (!slice.length) return `<span class="formstrip"></span>`;
  return `<span class="formstrip" role="img" aria-label="Recent form: ${slice
    .map((entry) => `${entry.result} ${entry.score} vs ${entry.opponent}`)
    .join(", ")}">${slice
    .map(
      (entry) =>
        `<i class="${entry.result.toLowerCase()}" title="${esc(
          `${entry.result} ${entry.score} ${entry.venue === "H" ? "vs" : "at"} ${entry.opponent}`,
        )}">${entry.result}</i>`,
    )
    .join("")}</span>`;
};

export const starButton = (id, label = "match") => {
  const active = isWatched(id);
  return `<button class="iconbtn match-row__star" type="button" data-watch="${esc(id)}" aria-pressed="${active}"
    aria-label="${active ? "Remove from" : "Add to"} saved" title="${active ? "Saved" : "Save"} ${label}">
    <svg fill="${active ? "currentColor" : "none"}"><use href="#i-star"/></svg>
  </button>`;
};

export const triBar = (probabilities, className = "match-row__bar") => {
  const [home, draw, away] = probabilities;
  return `<span class="${className}" role="img" aria-label="Home ${pctOf(home * 100)}, draw ${pctOf(
    draw * 100,
  )}, away ${pctOf(away * 100)}">
    <i class="h" style="width:${(home * 100).toFixed(2)}%"></i>
    <i class="d" style="width:${(draw * 100).toFixed(2)}%"></i>
    <i class="a" style="width:${(away * 100).toFixed(2)}%"></i>
  </span>`;
};

const nums = (p) => {
  const values = p.map((value) => Math.round(value * 100));
  const top = Math.max(...values);
  return values
    .map((value) => `<b class="${value === top ? "lead" : ""}">${value}</b>`)
    .join("");
};

/** The workhorse: one fixture as a dense, linkable row. */
export function matchRow(fixture, { showStar = true, showComp = true, showRel = true } = {}) {
  const home = state.teams.get(fixture.home);
  const away = state.teams.get(fixture.away);
  const league = state.leaguesByCode.get(fixture.league);
  const kickoff = fmtKickoff(fixture.date);
  const tier = reliabilityTier(fixture.rel);

  return `<div class="match-row">
    <a class="match-row__link" href="/match/${esc(fixture.id)}" data-link
       aria-label="${esc(`${home?.name} versus ${away?.name}, ${kickoff.day} ${kickoff.time}, ${league?.name || ""}`)}">
      <span class="match-row__time">${kickoff.time}</span>
      ${showComp ? `<span class="match-row__comp">${leagueTag(league?.id || "")}</span>` : ""}
      <span class="match-row__home">${teamBadge(home)}<span>${esc(home?.name || "")}</span></span>
      <span class="match-row__nums">${nums(fixture.p)}</span>
      <span class="match-row__away"><span>${esc(away?.name || "")}</span>${teamBadge(away)}</span>
      ${showRel ? `<span class="match-row__rel" title="Reliability ${fixture.rel}/100 · ${tier.label}">${Math.round(fixture.rel)}</span>` : ""}
      ${triBar(fixture.p)}
    </a>
    ${showStar ? starButton(fixture.id) : ""}
  </div>`;
}

export const bandHead = ({ idx, title, href, label = "All fixtures" }) => `
  <div class="bandhead">
    <div class="bandhead__title">
      ${idx ? `<span class="bandhead__idx">${esc(idx)}</span>` : ""}
      <h2>${esc(title)}</h2>
    </div>
    ${href ? `<a class="bandhead__link" href="${esc(href)}" data-link>${esc(label)}</a>` : ""}
  </div>`;

export const emptyState = (title, body) => `
  <div class="empty"><strong>${esc(title)}</strong><span>${esc(body)}</span></div>`;

export const notice = (html) => `<div class="notice">${html}</div>`;

export const statLine = (items) => `
  <div class="stats">
    ${items
      .map(
        (item) => `<div class="stat">
          <small>${esc(item.label)}</small>
          <b>${item.value}${item.em ? ` <em>${item.em}</em>` : ""}</b>
          <span>${esc(item.note || "")}</span>
        </div>`,
      )
      .join("")}
  </div>`;

export const dayLabel = (iso) =>
  new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${iso}T12:00:00`),
  );

export { relativeDay };
