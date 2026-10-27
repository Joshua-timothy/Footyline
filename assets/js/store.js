/* Data access layer: loads the static feed once, builds indexes. */

export const state = {
  feed: null,
  metrics: null,
  teams: new Map(),
  leagues: new Map(),
  leaguesByCode: new Map(),
  fixtures: [],
  fixtureById: new Map(),
  fixturesByLeague: new Map(),
  upcomingByTeam: new Map(),
  tableByLeague: new Map(),
  projectionByLeague: new Map(),
  h2h: {},
  fdIndex: new Map(),
  watch: new Set(JSON.parse(localStorage.getItem("footyline:watch") || "[]")),
};

export const store = state;

const normalise = (value) =>
  String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export async function loadData() {
  const [feedResponse, metricsResponse] = await Promise.all([
    fetch("/data/feed.json", { cache: "no-cache" }),
    fetch("/data/metrics.json", { cache: "no-cache" }).catch(() => null),
  ]);
  if (!feedResponse.ok) throw new Error(`Prediction feed unavailable (${feedResponse.status})`);
  const feed = await feedResponse.json();
  const metrics = metricsResponse && metricsResponse.ok ? await metricsResponse.json() : null;

  state.feed = feed;
  state.metrics = metrics;
  state.h2h = feed.h2h || {};
  state.fixtures = feed.fixtures;

  for (const team of Object.values(feed.teams)) {
    team.search = normalise(`${team.name} ${team.short}`);
    state.teams.set(team.id, team);
    if (team.fd) state.fdIndex.set(`${team.league}:${team.fd}`, team);
  }

  for (const league of feed.leagues) {
    state.leagues.set(league.id, league);
    state.leaguesByCode.set(league.code, league);
    state.tableByLeague.set(league.id, new Map(league.table.map((row) => [row.team, row])));
    state.projectionByLeague.set(
      league.id,
      new Map((league.projection || []).map((row) => [row.team, row])),
    );
    state.fixturesByLeague.set(league.id, []);
    league.teamList = league.table.map((row) => row.team);
  }

  for (const fixture of state.fixtures) {
    state.fixtureById.set(fixture.id, fixture);
    const league = state.leaguesByCode.get(fixture.league);
    if (league) state.fixturesByLeague.get(league.id).push(fixture);
    for (const teamId of [fixture.home, fixture.away]) {
      if (!state.upcomingByTeam.has(teamId)) state.upcomingByTeam.set(teamId, []);
      state.upcomingByTeam.get(teamId).push(fixture);
    }
  }

  return state;
}

export const team = (id) => state.teams.get(id) || { id, name: id, short: "???", color: "#3d5c49" };
export const league = (id) => state.leagues.get(id) || { id, name: id, short: id, country: "", code: id };
export const leagueByCode = (code) => state.leaguesByCode.get(code);
export const fixture = (id) => state.fixtureById.get(id);
export const tableRow = (leagueId, teamId) => state.tableByLeague.get(leagueId)?.get(teamId);
export const projection = (leagueId, teamId) => state.projectionByLeague.get(leagueId)?.get(teamId);

export const pairKey = (a, b) => [a, b].sort().join("-");
export const headToHead = (a, b) => state.h2h[pairKey(a, b)] || null;

/** Look a club up by its football-data.co.uk name inside a league. */
export const teamByFd = (leagueCode, fdName) => state.fdIndex.get(`${leagueCode}:${fdName}`) || null;

export const teamFixtures = (teamId) => state.upcomingByTeam.get(teamId) || [];

export const nextFixtures = (count = 6, { from = Date.now(), skipToday = false } = {}) =>
  state.fixtures
    .filter((item) => new Date(item.date).getTime() > from)
    .filter((item) => !skipToday || new Date(item.date).toDateString() !== new Date().toDateString())
    .slice(0, count);

/* ---- watchlist ---------------------------------------------------------- */
export function toggleWatch(id) {
  if (state.watch.has(id)) state.watch.delete(id);
  else state.watch.add(id);
  localStorage.setItem("footyline:watch", JSON.stringify([...state.watch]));
  document.dispatchEvent(new CustomEvent("watch:change", { detail: { id } }));
  return state.watch.has(id);
}
export const isWatched = (id) => state.watch.has(id);
export const watchCount = () => state.watch.size;

/* ---- search ------------------------------------------------------------- */
export function searchAll(query, limit = 22) {
  const needle = normalise(query);
  if (!needle) {
    return {
      teams: [],
      fixtures: state.fixtures.slice(0, 6),
      leagues: [],
      suggestion: true,
    };
  }
  const tokens = needle.split(" ").filter(Boolean);
  const score = (haystack, exact) => {
    if (haystack === needle) return 100;
    if (haystack.startsWith(needle)) return 70;
    if (tokens.every((token) => haystack.includes(token))) return 45;
    return 0;
  };

  const teams = [];
  for (const item of state.teams.values()) {
    const value = score(item.search, false);
    if (value) teams.push({ team: item, rank: value + (item.stats ? 8 : 0) });
  }
  teams.sort((a, b) => b.rank - a.rank || a.team.name.localeCompare(b.team.name));

  const leagues = [];
  for (const item of state.leagues.values()) {
    const hay = normalise(`${item.name} ${item.short} ${item.country}`);
    const value = score(hay, false);
    if (value) leagues.push({ league: item, rank: value });
  }
  leagues.sort((a, b) => b.rank - a.rank);

  const fixtures = [];
  for (const item of state.fixtures) {
    const home = state.teams.get(item.home);
    const away = state.teams.get(item.away);
    if (!home || !away) continue;
    const hay = normalise(`${home.name} ${away.name} ${home.short} ${away.short}`);
    const value = score(hay, false);
    if (value) fixtures.push({ fixture: item, rank: value });
  }
  fixtures.sort((a, b) => b.rank - a.rank || a.fixture.date.localeCompare(b.fixture.date));

  return {
    teams: teams.slice(0, limit).map((entry) => entry.team),
    leagues: leagues.slice(0, 4).map((entry) => entry.league),
    fixtures: fixtures.slice(0, limit).map((entry) => entry.fixture),
    suggestion: false,
  };
}
