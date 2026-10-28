/* Bootstrap: theme, chrome, competitions panel, command palette, shortcuts. */

import { loadData, state, toggleWatch, watchCount, searchAll, team as getTeam } from "./store.js";
import { startRouter, navigate, render } from "./router.js";
import { esc, relativeDay, fmtKickoff } from "./util.js";
import { teamBadge, leagueTint } from "./ui.js";

/* ---------- theme -------------------------------------------------------- */
const THEME_KEY = "footyline:theme";
const THEME_COLOUR = { light: "#f1efe8", dark: "#12120e" };

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = document.querySelector("#themeToggle");
  if (toggle) {
    const dark = theme === "dark";
    toggle.innerHTML = `<svg><use href="#i-${dark ? "sun" : "moon"}"/></svg>`;
    toggle.title = dark ? "Switch to light" : "Switch to dark";
    toggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOUR[theme] || THEME_COLOUR.light);
}

function initTheme() {
  const requested = new URLSearchParams(location.search).get("theme");
  const saved = localStorage.getItem(THEME_KEY);
  const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const initial = requested === "light" || requested === "dark" ? requested : saved || system;
  if (requested === "light" || requested === "dark") localStorage.setItem(THEME_KEY, requested);
  applyTheme(initial);
  document.querySelector("#themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
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
      return `<a class="comp-item" href="/league/${esc(league.id)}" data-link ${active}>
        <i class="swatch" style="--tone:${leagueTint(league.code)}"></i>
        <span class="comp-item__name">${esc(league.name)}</span>
        <b>${count}</b>
      </a>`;
    })
    .join("");
}

function updateStatus() {
  const generated = state.feed?.generatedAt ? new Date(state.feed.generatedAt) : null;
  const asOf = document.querySelector("#asOf");
  if (asOf && generated) {
    const stamp = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    asOf.textContent = `Updated ${stamp.format(generated)}`;
    asOf.title = `Forecasts generated ${generated.toISOString()}`;
  }
}

/* competitions panel */
function initCompetitions() {
  const panel = document.querySelector("#competitionsPanel");
  const toggle = document.querySelector("#competitionsToggle");
  if (!panel || !toggle) return;

  const setOpen = (open) => {
    panel.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setOpen(!panel.classList.contains("is-open"));
  });

  document.addEventListener("click", (event) => {
    if (!panel.classList.contains("is-open")) return;
    if (panel.contains(event.target) || toggle.contains(event.target)) return;
    if (event.target.closest("a[data-link]")) setOpen(false);
    else setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) setOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("a[data-link]")) setOpen(false);
  });
}

/* ---------- watchlist ---------------------------------------------------- */
function syncWatchButton(button, active) {
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", `${active ? "Remove from" : "Add to"} saved`);
  const svg = button.querySelector("svg");
  if (svg) svg.setAttribute("fill", active ? "currentColor" : "none");
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

  const item = (entry) => `<button class="palette__item" type="button" role="option" aria-selected="false" data-href="${esc(
    entry.href,
  )}">${entry.team ? teamBadge(entry.team, "sm") : ""}<span>${esc(entry.label)}</span><small>${esc(
    entry.sub || "",
  )}</small></button>`;

  const draw = (query) => {
    const results = searchAll(query);
    const blocks = [];
    items = [];

    if (results.leagues.length) {
      blocks.push(`<p class="palette__group">Competitions</p>`);
      for (const league of results.leagues) {
        blocks.push(item({ href: `/league/${league.id}`, label: league.name, sub: league.country }));
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
          }),
        );
        items.push({ href: `/match/${fixture.id}` });
      }
    }

    list.innerHTML = blocks.length
      ? blocks.join("")
      : `<p class="palette__empty">Nothing matches “${esc(query)}”.</p>`;
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
      const handler = (next) => {
        document.removeEventListener("keydown", handler);
        if (next.key === "o") navigate("/");
        if (next.key === "m") navigate("/matches");
        if (next.key === "t") navigate("/model");
        if (next.key === "w") navigate("/watchlist");
      };
      document.addEventListener("keydown", handler, { once: true });
    }
  });
}

/* ---------- boot --------------------------------------------------------- */
const skeleton = `<div class="view" style="padding-top:28px">
  <div class="skeleton" style="height:14px;width:120px"></div>
  <div class="skeleton" style="height:56px;width:min(460px,80%);margin-top:18px"></div>
  <div class="skeleton" style="height:18px;width:min(520px,90%);margin-top:14px"></div>
  <div class="skeleton" style="height:220px;margin-top:30px"></div>
</div>`;

async function boot() {
  initTheme();
  document.querySelector("#app").innerHTML = skeleton;

  try {
    await loadData();
  } catch (error) {
    document.querySelector("#app").innerHTML = `<div class="view" style="padding-top:40px">
      <div class="notice"><div><b>Forecasts could not load.</b> ${esc(error.message)}<br>
      Run the pipeline or check that <code>data/feed.json</code> exists.</div></div></div>`;
    return;
  }

  renderLeagueNav();
  updateStatus();
  initCompetitions();
  initWatch();
  initPalette();
  startRouter();

  const watchBadge = document.querySelector("[data-watch-count]");
  if (watchBadge) watchBadge.textContent = String(watchCount() || "");
}

boot();
