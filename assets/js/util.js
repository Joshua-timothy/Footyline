/* Small shared helpers. */

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ESCAPES[character]);

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export const pct = (value, digits = 1) =>
  `${(Number(value) * 100).toFixed(digits).replace(/\.0$/, "")}%`;

export const pctOf = (value, digits = 1) =>
  `${Number(value).toFixed(digits).replace(/\.0$/, "")}%`;

export const round = (value, digits = 1) => Number(Number(value).toFixed(digits));

const LOCALE = navigator.language || "en-GB";

const dayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short" });
const longDayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false });
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });

export const fmtKickoff = (iso) => {
  const date = new Date(iso);
  return { day: dayFmt.format(date), time: timeFmt.format(date), long: longDayFmt.format(date) };
};

export const fmtTime = (iso) => timeFmt.format(new Date(iso));
export const fmtDate = (iso) => dayFmt.format(new Date(iso));
export const fmtDateShort = (iso) => dateFmt.format(new Date(iso));

export const dayKey = (iso) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const relativeDay = (iso) => {
  const target = new Date(iso);
  const now = new Date();
  const startOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((startOf(target) - startOf(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return `In ${diff} days`;
  return fmtDate(iso);
};

export const isSameLocalDay = (iso, date = new Date()) => {
  const target = new Date(iso);
  return (
    target.getFullYear() === date.getFullYear() &&
    target.getMonth() === date.getMonth() &&
    target.getDate() === date.getDate()
  );
};

/** Pick black or white text for a hex background, using WCAG relative luminance. */
export const inkFor = (hex) => {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const channels = [0, 2, 4].map((offset) => {
    const c = parseInt(full.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.42 ? "#0a1409" : "#ffffff";
};

export const debounce = (fn, wait = 120) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const formSummary = (form = []) => form.map((entry) => entry.result).join("");

export const resultLabel = (outcome) => ["Home", "Draw", "Away"][outcome] ?? "—";

/** Confidence tier driven by the pipeline's reliability score (0-100). */
export const reliabilityTier = (score) => {
  if (score >= 62) return { label: "High", level: 4 };
  if (score >= 46) return { label: "Solid", level: 3 };
  if (score >= 32) return { label: "Moderate", level: 2 };
  return { label: "Thin", level: 1 };
};

export const orderBy = (items, key, direction = 1) => {
  const sorted = [...items];
  sorted.sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    return (left < right ? -1 : 1) * direction;
  });
  return sorted;
};

export const groupBy = (items, key) => {
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
};

/** ISO-8601 week key, matching Python's date.isocalendar(). */
export const isoWeekKey = (date = new Date()) => {
  const probe = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = probe.getUTCDay() || 7;
  probe.setUTCDate(probe.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(probe.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((probe - yearStart) / 86_400_000 + 1) / 7);
  return `${probe.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

/** Drop the current, still-running ISO week from a weekly series. */
export const completeWeeks = (rows = []) => {
  const current = isoWeekKey();
  return rows.filter((row) => row.week !== current);
};
