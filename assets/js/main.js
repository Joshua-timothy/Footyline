/* Bootstrap: theme, data, chrome, command palette, shortcuts. */

import { loadData, state, toggleWatch, watchCount, searchAll, team as getTeam } from "./store.js";
import { startRouter, navigate, render } from "./router.js";
import { esc, pctOf, relativeDay, fmtKickoff, dayKey } from "./util.js";
import { teamBadge, leagueTag, leagueTint } from "./ui.js";

/* ---------- theme -------------------------------------------------------- */
const THEME_KEY = "footyline:theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = document.querySelector("#themeToggle");
  if (toggle) {
    const dark = theme === "dark";
    toggle.innerHTML = `<svg><use href="#i-${dark ? "sun" : "moon"}"/></svg>`;
    toggle.title = dark ? "Switch to light" : "Switch to dark";
    toggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    toggle.setAttribute("aria-pressed", String(dark));
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#07100b" : "#f5f6ef");
}

function initTheme() {
  const requested = new URLSearchParams(location.search).get("theme");
  const saved = localStorage.getItem(THEME_KEY);
  const system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const initial = requested === "light" || requested === "dark" ? requested : saved || system;
  if (requested === "light" || requested === "dark") localStorage.setItem(THEME_KEY, requested);
  applyTheme(initial);
  document.querySelector("#themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (event) => {
    if (!localStorage.getItem(THEME_KEY)) applyTheme(event.matches ? "light" : "dark");
  });
}

/* ---------- chrome ------------------------------------------------------- */
function renderLeagueNav() {
  const nav = document.querySelector("#leagueNav");
  if (!nav) return;
  nav.innerHTML = [...state.leagues.values()]
    .map((league) => {
      const count = (state.fixturesByLeague.get(league.id) || []).length;
      const active = location.pathname === `/league/${league.id}` ? 'aria-current="page"' : "";
      return `<a class="nav-item" href="/league/${esc(league.id)}" data-link ${active}>
        <i class="league-flag" style="--flag:${leagueTint(league.code)}"></i>
        <span>${esc(league.name)}</span><b>${count}</b>
      </a>`;
    })
    .join("");
}

function updateStatus() {
  const summary = state.metrics?.summary;
  const generated = state.feed?.generatedAt ? new Date(state.feed.generatedAt) : null;
  const statusText = document.querySelector("#statusText");
  const statusDot = document.querySelector("#statusDot");
  if (statusText && generated) {
    const health = state.metrics?.summary?.matches ? "All systems live" : "Feed loaded";
    statusText.textContent = health;
    statusDot.classList.remove("dot--warn");
  }
  const railMeta = document.querySelector("#railMeta");
  if (railMeta) {
    railMeta.innerHTML = `${state.fixtures.length.toLocaleString()} fixtures · ${
      summary ? summary.matches.toLocaleString() : "—"
    } backtested<br><a href="/model" data-link>Audit the model</a>`;
  }
  const asOf = document.querySelector("#asOf");
  if (asOf && generated) {
    const stamp = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    asOf.textContent = `Updated ${stamp.format(generated)}`;
    asOf.title = `Forecasts generated ${generated.toISOString()}`;
  }
  const watchBadge = document.querySelector("[data-watch-count]");
  if (watchBadge) {
    const count = watchCount();
    watchBadge.textContent = count ? String(count) : "";
  }
}

/* ---------- watchlist ---------------------------------------------------- */
function syncWatchButton(button, active) {
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", `${active ? "Remove from" : "Add to"} watchlist`);
  button.title = active ? "Saved" : "Save fixture";
  const svg = button.querySelector("svg");
  if (svg) {
    svg.setAttribute("fill", active ? "currentColor" : "none");
    svg.style.color = active ? "var(--accent)" : "currentColor";
  }
}

function initWatch() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-watch]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const id = button.dataset.watch;
    const active = toggleWatch(id);
    document.querySelectorAll(`[data-watch="${CSS.escape(id)}"]`).forEach((element) => syncWatchButton(element, active));
    updateStatus();
    if (location.pathname === "/watchlist") render({ scrollTop: false });
  });
}

/* ---------- command palette ---------------------------------------------- */
function initPalette() {
  const palette = document.querySelector("#palette");
  const input = document.querySelector("#paletteInput");
  const list = document.querySelector("#paletteList");
  let items = [];
  let selected = 0;

  const close = () => {
    palette.hidden = true;
    palette.classList.remove("is-open");
    document.body.style.overflow = "";
    input.value = "";
  };

  const open = () => {
    palette.hidden = false;
    palette.classList.add("is-open");
    document.body.style.overflow = "hidden";
    draw("");
    input.focus();
  };

  const select = (index) => {
    if (!items.length) return;
    selected = (index + items.length) % items.length;
    list.querySelectorAll(".palette__item").forEach((element, position) => {
      element.setAttribute("aria-selected", String(position === selected));
    });
    const active = list.querySelector('[aria-selected="true"]');
    if (active) active.scrollIntoView({ block: "nearest" });
  };

  const item = (entry) => `<button class="palette__item" type="button" role="option" aria-selected="false"
      data-href="${esc(entry.href)}">
      ${entry.team ? teamBadge(entry.team, "sm") : ""}
      <span>${esc(entry.label)}</span>
      <small>${esc(entry.sub || "")}</small>
    </button>`;

  const draw = (query) => {
    const results = searchAll(query);
    const blocks = [];
    items = [];

    if (results.leagues.length) {
      blocks.push(`<p class="palette__group">Competitions</p>`);
      for (const league of results.leagues) {
        blocks.push(
          item({ href: `/league/${league.id}`, label: league.name, sub: league.country, team: null }),
        );
        items.push({ href: `/league/${league.id}` });
      }
    }
    if (results.teams.length) {
      blocks.push(`<p class="palette__group">Clubs</p>`);
      for (const club of results.teams) {
        blocks.push(
          item({
            href: `/team/${club.id}`,
            label: club.name,
            sub: state.leaguesByCode.get(club.league)?.name || "",
            team: club,
          }),
        );
        items.push({ href: `/team/${club.id}` });
      }
    }
    if (results.fixtures.length) {
      blocks.push(`<p class="palette__group">${results.suggestion ? "Next up" : "Fixtures"}</p>`);
      for (const fixture of results.fixtures) {
        const home = getTeam(fixture.home);
        const away = getTeam(fixture.away);
        blocks.push(
          item({
            href: `/match/${fixture.id}`,
            label: `${home.name} v ${away.name}`,
            sub: `${relativeDay(fixture.date)} · ${fmtKickoff(fixture.date).time}`,
            team: null,
          }),
        );
        items.push({ href: `/match/${fixture.id}` });
      }
    }

    list.innerHTML = blocks.length
      ? blocks.join("")
      : `<p class="palette__empty">No teams, fixtures or competitions match “${esc(query)}”.</p>`;
    selected = 0;
    select(0);
  };

  input.addEventListener("input", () => draw(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      select(selected + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      select(selected - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = items[selected];
      if (target) {
        close();
        navigate(target.href);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-href]");
    if (!button) return;
    close();
    navigate(button.dataset.href);
  });

  palette.addEventListener("mousedown", (event) => {
    if (event.target === palette) close();
  });

  document.querySelector("#searchOpen").addEventListener("click", open);
  document.addEventListener("keydown", (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (palette.hidden) open();
      else close();
      return;
    }
    if (event.key === "/" && !typing) {
      event.preventDefault();
      open();
      return;
    }
    if (event.key === "Escape" && !palette.hidden) close();
    if (event.key === "g" && !typing) {
      const once = (next) => {
        document.removeEventListener("keydown", handler);
        if (next.key === "o") navigate("/");
        if (next.key === "m") navigate("/matches");
        if (next.key === "t") navigate("/model");
        if (next.key === "w") navigate("/watchlist");
      };
      const handler = (next) => once(next);
      document.addEventListener("keydown", handler, { once: true });
    }
  });
}

/* ---------- boot --------------------------------------------------------- */
const skeleton = `<div class="view" style="padding-top:28px">
  <div class="skeleton" style="height:52px;width:min(420px,80%)"></div>
  <div class="skeleton" style="height:20px;width:min(560px,90%);margin-top:16px"></div>
  <div class="skeleton" style="height:150px;margin-top:26px"></div>
  <div class="skeleton" style="height:320px;margin-top:14px"></div>
</div>`;



async function boot() {
  initTheme();
  document.querySelector("#app").innerHTML = skeleton;

  try {
    await loadData();
  } catch (error) {
    document.querySelector("#app").innerHTML = `<div class="view"><div class="notice" style="margin-top:30px">
      <div><b>Forecasts could not load.</b> ${esc(error.message)}<br>
      Run the data pipeline (<code>python pipeline/build.py</code>) or check that <code>data/feed.json</code> exists.</div>
    </div></div>`;
    const status = document.querySelector("#statusText");
    if (status) status.textContent = "Feed unavailable";
    document.querySelector("#statusDot")?.classList.add("dot--warn");
    return;
  }

  renderLeagueNav();
  updateStatus();
  initWatch();
  initPalette();
  startRouter();
}

boot();
