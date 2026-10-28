/* History-API router with a hash-free, static-host friendly fallback. */

import overview from "./views/overview.js";
import matches from "./views/matches.js";
import matchView from "./views/match.js";
import leagueView from "./views/league.js";
import teamView from "./views/team.js";
import modelView from "./views/model.js";
import watchlistView from "./views/watchlist.js";

const ROUTES = [
  { pattern: /^\/$/, view: overview, nav: "overview" },
  { pattern: /^\/matches$/, view: matches, nav: "matches" },
  { pattern: /^\/match\/([^/]+)$/, view: matchView, keys: ["id"], nav: "matches" },
  { pattern: /^\/league\/([^/]+)$/, view: leagueView, keys: ["id"], nav: "matches" },
  { pattern: /^\/team\/([^/]+)$/, view: teamView, keys: ["id"], nav: "matches" },
  { pattern: /^\/model$/, view: modelView, nav: "model" },
  { pattern: /^\/watchlist$/, view: watchlistView, nav: "watchlist" },
];

let currentCleanup = null;
let renderCallback = null;
let mounted = false;

export function resolve(path) {
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (!match) continue;
    const params = {};
    (route.keys || []).forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    return { route, params };
  }
  return null;
}

export function navigate(path, { replace = false, scrollTop = true } = {}) {
  if (replace) history.replaceState({}, "", path);
  else history.pushState({ scrollY: window.scrollY }, "", path);
  render({ scrollTop });
}

export function setRenderCallback(callback) {
  renderCallback = callback;
}

function notFound(path) {
  return {
    html: `<div class="view">
      <div class="pagehead">
        <p class="label">Error 404</p>
        <h1 class="display display--tight" style="margin-top:14px">Nothing here.</h1>
      </div>
      <div class="empty">
        <span><code>${path.replace(/[<>&]/g, "")}</code> is not a page on this site.</span>
        <span>Try the fixture board, or search every club and competition with ⌘K.</span>
        <a class="btn" href="/matches" data-link>Fixture board</a>
      </div>
    </div>`,
    title: "Not found — Footyline",
    crumb: "Not found",
    nav: "overview",
  };
}

export function render({ scrollTop = true, restoreScroll = false } = {}) {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const resolved = resolve(path);
  if (!resolved) {
    const fallback = notFound(path);
    apply(fallback, scrollTop);
    return;
  }
  const { route, params } = resolved;
  let result;
  try {
    result = route.view(params, { path, query: new URLSearchParams(location.search) });
  } catch (error) {
    console.error(error);
    result = {
      html: `<div class="view"><div class="notice"><b>Something broke.</b> ${String(error.message).replace(
        /[<>&]/g,
        "",
      )}</div></div>`,
      title: "Error — Footyline",
      crumb: "Error",
      nav: route.nav,
    };
  }
  apply(result, scrollTop, restoreScroll);
}

function apply(result, scrollTop, restoreScroll = false) {
  if (typeof currentCleanup === "function") {
    currentCleanup();
    currentCleanup = null;
  }
  const app = document.querySelector("#app");
  app.innerHTML = result.html;
  if (typeof result.mount === "function") {
    const cleanup = result.mount(app);
    if (typeof cleanup === "function") currentCleanup = cleanup;
  }
  document.title = result.title || "Footyline";
  const announcer = document.querySelector("#announcer");
  if (announcer) announcer.textContent = `Loaded ${result.crumb || "page"}`;
  const crumb = document.querySelector("#crumb");
  if (crumb) crumb.innerHTML = `<span>${(result.crumb || "Footyline").replace(/[<>&]/g, "")}</span>`;

  const navKey = result.nav || "overview";
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === navKey) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (restoreScroll) {
    window.scrollTo(0, history.state?.scrollY ?? 0);
  } else if (scrollTop) {
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  if (!mounted) {
    mounted = true;
    if (renderCallback) renderCallback();
  }
}

export function startRouter() {
  window.addEventListener("popstate", () => render({ restoreScroll: true, scrollTop: false }));
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = event.target.closest("a[data-link]");
    if (!anchor) return;
    if (anchor.target && anchor.target !== "_self") return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    event.preventDefault();
    navigate(`${url.pathname}${url.search}`);
  });
  render({ scrollTop: false });
}
