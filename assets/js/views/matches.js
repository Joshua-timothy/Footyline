import { esc, dayKey, plural } from "../util.js";
import { state, team as getTeam } from "../store.js";
import { matchRow, emptyState, dayLabel } from "../ui.js";

const PAGE = 26;
const DAY = 86_400_000;

const RANGES = [
  { id: "today", label: "Today" },
  { id: "weekend", label: "Weekend" },
  { id: "week", label: "7 days" },
  { id: "all", label: "Season" },
];

const SORTS = [
  { id: "kickoff", label: "Kick-off" },
  { id: "certain", label: "Most certain" },
  { id: "close", label: "Closest" },
  { id: "goals", label: "Most goals" },
];

const options = { range: "week", league: "ALL", sort: "kickoff", query: "", limit: PAGE };

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

function listMarkup(rows) {
  if (!rows.length) {
    return emptyState("No fixtures in this view", "Widen the date range, choose another competition, or clear the search.");
  }
  const visible = rows.slice(0, options.limit);
  const groups = new Map();
  for (const fixture of visible) {
    const key = dayKey(fixture.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fixture);
  }

  const blocks = [...groups.entries()]
    .map(
      ([key, fixtures]) => `<div class="match-row__day">${esc(dayLabel(key))}<span>${plural(
        fixtures.length,
        "fixture",
      )}</span></div>${fixtures.map((fixture) => matchRow(fixture)).join("")}`,
    )
    .join("");

  const more =
    rows.length > options.limit
      ? `<div style="padding-top:22px"><button class="btn btn--ghost" type="button" data-more>
          Show ${Math.min(PAGE, rows.length - options.limit)} more
        </button></div>`
      : "";

  return `<div class="matchlist">${blocks}</div>${more}`;
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
    <label class="sr-only" for="fixtureSearch">Search</label>
    <input class="input" id="fixtureSearch" type="search" placeholder="Club…" autocomplete="off" style="width:150px">
    <label class="sr-only" for="sortFilter">Sort</label>
    <select class="select" id="sortFilter">
      ${SORTS.map((sort) => `<option value="${sort.id}">${sort.label}</option>`).join("")}
    </select>
    <span class="toolbar__count" id="resultCount"></span>
  </div>`;

export default function matches({ path }) {
  const initial = new URLSearchParams(location.search);
  options.range = initial.get("range") || "week";
  options.league = initial.get("league") || "ALL";
  options.sort = initial.get("sort") || "kickoff";
  options.query = initial.get("q") || "";
  options.limit = PAGE;

  const rows = filtered();
  const league = options.league === "ALL" ? null : state.leagues.get(options.league);

  return {
    html: `<div class="view">
      <div class="pagehead">
        <div class="pagehead__row">
          <div>
            <p class="label">Match centre</p>
            <h1 style="margin-top:10px">${league ? esc(league.name) : "Fixtures"}</h1>
          </div>
          <p class="label" style="padding-bottom:6px">${state.leagues.size} competitions</p>
        </div>
      </div>
      <div id="matchesControls">${toolbar()}</div>
      <div id="matchesList">${listMarkup(rows)}</div>
    </div>`,
    title: "Fixtures — Footyline",
    crumb: "Fixtures",
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
        syncUrl();
      };

      const reset = () => {
        options.limit = PAGE;
        paint();
      };

      controlsEl.addEventListener("click", (event) => {
        const range = event.target.closest("[data-range]");
        if (!range) return;
        options.range = range.dataset.range;
        reset();
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
