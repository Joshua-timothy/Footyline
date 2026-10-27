import { esc, dayKey, fmtKickoff, plural } from "../util.js";
import { state, team as getTeam } from "../store.js";
import { fixtureCard, teamBadge, leagueTag, emptyState } from "../ui.js";

const PAGE = 24;
const DAY = 86_400_000;

const RANGES = [
  { id: "today", label: "Today" },
  { id: "weekend", label: "Weekend" },
  { id: "week", label: "7 days" },
  { id: "all", label: "All season" },
];

const SORTS = [
  { id: "kickoff", label: "Kick-off" },
  { id: "certain", label: "Most certain" },
  { id: "close", label: "Closest call" },
  { id: "goals", label: "Most goals" },
];

const options = { range: "week", league: "ALL", sort: "kickoff", query: "", view: "cards", limit: PAGE };

const withinRange = (fixture, range) => {
  const kickoff = new Date(fixture.date);
  const now = new Date();
  if (kickoff < now) return false;
  if (range === "today") return kickoff.toDateString() === now.toDateString();
  if (range === "week") return kickoff.getTime() - now.getTime() < 7 * DAY;
  if (range === "weekend") {
    const day = kickoff.getDay();
    const delta = kickoff.getTime() - now.getTime();
    return (day === 0 || day === 5 || day === 6) && delta < 5 * DAY;
  }
  return true;
};

function filtered() {
  const needle = options.query.trim().toLowerCase();
  const rows = state.fixtures.filter((fixture) => {
    if (!withinRange(fixture, options.range)) return false;
    if (options.league !== "ALL") {
      const league = state.leaguesByCode.get(fixture.league);
      if (!league || league.id !== options.league) return false;
    }
    if (needle) {
      const home = getTeam(fixture.home).name.toLowerCase();
      const away = getTeam(fixture.away).name.toLowerCase();
      if (!home.includes(needle) && !away.includes(needle)) return false;
    }
    return true;
  });

  if (options.sort === "certain") rows.sort((a, b) => Math.max(...b.p) - Math.max(...a.p));
  else if (options.sort === "close") rows.sort((a, b) => Math.max(...a.p) - Math.max(...b.p));
  else if (options.sort === "goals") rows.sort((a, b) => b.lh + b.la - (a.lh + a.la));
  else rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

const pickName = (fixture) => {
  const [home, draw, away] = fixture.p;
  const best = Math.max(home, draw, away);
  if (best === home) return `${getTeam(fixture.home).short} win`;
  if (best === away) return `${getTeam(fixture.away).short} win`;
  return "Draw";
};

function tableRow(fixture) {
  const home = getTeam(fixture.home);
  const away = getTeam(fixture.away);
  const time = fmtKickoff(fixture.date).time;
  const [h, d, a] = fixture.p.map((p) => p * 100);
  const top = Math.max(h, d, a);
  return `<tr>
    <td class="mono dim">${time}</td>
    <td class="left">${leagueTag(state.leaguesByCode.get(fixture.league).id)}</td>
    <td class="left"><a class="team-cell" href="/match/${esc(fixture.id)}" data-link>
      ${teamBadge(home, "sm")}<span>${esc(home.name)}</span>
      <i style="color:var(--faint);font-style:normal;padding:0 4px">v</i>
      ${teamBadge(away, "sm")}<span>${esc(away.name)}</span>
    </a></td>
    <td class="${h === top ? "strong" : ""}">${h.toFixed(0)}</td>
    <td class="${d === top ? "strong" : ""}">${d.toFixed(0)}</td>
    <td class="${a === top ? "strong" : ""}">${a.toFixed(0)}</td>
    <td class="dim">${pickName(fixture)}</td>
    <td class="dim">${(fixture.lh + fixture.la).toFixed(2)}</td>
    <td class="dim">${Math.round(fixture.rel)}</td>
  </tr>`;
}

function listMarkup(rows) {
  if (!rows.length) {
    return emptyState("No fixtures match this view", "Try a wider date range, another competition, or clear the search.");
  }
  const visible = rows.slice(0, options.limit);
  const groups = new Map();
  for (const fixture of visible) {
    const key = dayKey(fixture.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fixture);
  }

  const blocks = [...groups.entries()]
    .map(([key, fixtures]) => {
      const heading = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(
        new Date(`${key}T12:00:00`),
      );
      const body =
        options.view === "table"
          ? `<div class="table-wrap card"><table class="table">
              <thead><tr><th>Time</th><th class="left">Comp</th><th class="left">Fixture</th>
              <th>1</th><th>X</th><th>2</th><th class="left">Pick</th><th>Goals</th><th>Rel</th></tr></thead>
              <tbody>${fixtures.map(tableRow).join("")}</tbody></table></div>`
          : `<div class="fixture-grid">${fixtures.map((fixture) => fixtureCard(fixture)).join("")}</div>`;
      return `<section class="daygroup" aria-label="${esc(heading)}">
        <header class="daygroup__head"><h2>${esc(heading)}</h2><span>${plural(fixtures.length, "fixture")}</span></header>
        ${body}
      </section>`;
    })
    .join("");

  const more =
    rows.length > options.limit
      ? `<div class="loadmore"><button class="btn btn--ghost" type="button" data-more>
          Show ${Math.min(PAGE, rows.length - options.limit)} more
        </button><span>${rows.length - options.limit} still to come</span></div>`
      : "";
  return blocks + more;
}

const toolbar = () => `<div class="toolbar">
    <div class="segmented" role="group" aria-label="Date range">
      ${RANGES.map(
        (range) =>
          `<button type="button" data-range="${range.id}" aria-pressed="${options.range === range.id}">${range.label}</button>`,
      ).join("")}
    </div>
    <label class="sr-only" for="leagueFilter">Competition</label>
    <select class="select" id="leagueFilter">
      <option value="ALL">All competitions</option>
      ${[...state.leagues.values()]
        .map((league) => `<option value="${esc(league.id)}">${esc(league.name)}</option>`)
        .join("")}
    </select>
    <label class="sr-only" for="fixtureSearch">Search fixtures</label>
    <input class="input" id="fixtureSearch" type="search" placeholder="Team…" autocomplete="off">
    <label class="sr-only" for="sortFilter">Sort</label>
    <select class="select" id="sortFilter">
      ${SORTS.map((sort) => `<option value="${sort.id}">${sort.label}</option>`).join("")}
    </select>
    <div class="segmented toolbar__spacer" role="group" aria-label="Layout">
      <button type="button" data-view="cards" aria-pressed="${options.view === "cards"}">Cards</button>
      <button type="button" data-view="table" aria-pressed="${options.view === "table"}">Table</button>
    </div>
  </div>`;

export default function matches({ path }) {
  const initial = new URLSearchParams(location.search);
  options.range = initial.get("range") || "week";
  options.league = initial.get("league") || "ALL";
  options.sort = initial.get("sort") || "kickoff";
  options.query = initial.get("q") || "";
  options.limit = PAGE;

  const rows = filtered();
  const leagueName = options.league === "ALL" ? null : state.leagues.get(options.league)?.name;

  return {
    html: `<div class="view">
      <div class="pagehead">
        <div class="pagehead__id">
          <div>
            <p class="eyebrow">Match centre</p>
            <h1>${leagueName ? esc(leagueName) : "Every fixture"}</h1>
            <small>Probabilities for the rest of the 2026–27 season, modelled fixture by fixture.</small>
          </div>
        </div>
      </div>
      <div id="matchesControls">${toolbar()}<p class="result-count" id="resultCount"></p></div>
      <div id="matchesList">${listMarkup(rows)}</div>
    </div>`,
    title: "Match centre — Footyline",
    crumb: "Match centre",
    nav: "matches",
    mount(root) {
      const controlsEl = root.querySelector("#matchesControls");
      const listEl = root.querySelector("#matchesList");
      const countEl = root.querySelector("#resultCount");
      const leagueSelect = controlsEl.querySelector("#leagueFilter");
      const sortSelect = controlsEl.querySelector("#sortFilter");
      const searchInput = controlsEl.querySelector("#fixtureSearch");
      leagueSelect.value = options.league;
      sortSelect.value = options.sort;
      searchInput.value = options.query;

      const syncUrl = () => {
        const params = new URLSearchParams();
        if (options.range !== "week") params.set("range", options.range);
        if (options.league !== "ALL") params.set("league", options.league);
        if (options.sort !== "kickoff") params.set("sort", options.sort);
        if (options.query) params.set("q", options.query);
        const query = params.toString();
        history.replaceState({}, "", `${path}${query ? `?${query}` : ""}`);
      };

      const paint = () => {
        const next = filtered();
        listEl.innerHTML = listMarkup(next);
        countEl.textContent = `${plural(next.length, "fixture")} in view`;
        controlsEl.querySelectorAll("[data-range]").forEach((button) => {
          button.setAttribute("aria-pressed", String(button.dataset.range === options.range));
        });
        controlsEl.querySelectorAll("[data-view]").forEach((button) => {
          button.setAttribute("aria-pressed", String(button.dataset.view === options.view));
        });
        syncUrl();
      };

      const reset = () => {
        options.limit = PAGE;
        paint();
      };

      controlsEl.addEventListener("click", (event) => {
        const range = event.target.closest("[data-range]");
        if (range) {
          options.range = range.dataset.range;
          reset();
          return;
        }
        const view = event.target.closest("[data-view]");
        if (view) {
          options.view = view.dataset.view;
          paint();
        }
      });

      leagueSelect.addEventListener("change", () => {
        options.league = leagueSelect.value;
        reset();
      });
      sortSelect.addEventListener("change", () => {
        options.sort = sortSelect.value;
        reset();
      });

      let timer;
      searchInput.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          options.query = searchInput.value;
          reset();
        }, 180);
      });

      listEl.addEventListener("click", (event) => {
        if (!event.target.closest("[data-more]")) return;
        options.limit += PAGE;
        listEl.innerHTML = listMarkup(filtered());
      });

      paint();
    },
  };
}
