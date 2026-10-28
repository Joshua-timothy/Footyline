/* Hand-rolled charts for the "Programme" design: ink, signal, hairlines. */

import { completeWeeks } from "./util.js";

const fmt = (value, digits = 1) => Number(value).toFixed(digits);

/** 11x11 scoreline heat grid, built from DOM cells so it stays crisp. */
export function heatGrid(matrix, homeLabel = "HOME", awayLabel = "AWAY") {
  const size = matrix.length;
  let max = 0;
  let peak = { i: 0, j: 0 };
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (matrix[i][j] > max) {
        max = matrix[i][j];
        peak = { i, j };
      }
    }
  }

  const cells = [];
  cells.push(`<span class="axis"></span>`);
  for (let j = 0; j < size; j += 1) cells.push(`<span class="axis">${j}</span>`);

  for (let i = 0; i < size; i += 1) {
    cells.push(`<span class="axis">${i}</span>`);
    for (let j = 0; j < size; j += 1) {
      const value = matrix[i][j];
      const intensity = max > 0 ? Math.pow(value / max, 0.55) : 0;
      const alpha = Math.round((0.03 + intensity * 0.9) * 100);
      const strong = intensity > 0.55;
      const classes = ["cell"];
      if (strong) classes.push("hot");
      if (i === peak.i && j === peak.j) classes.push("peak");
      const label = value >= 0.012 ? (value * 100).toFixed(1) : "";
      cells.push(
        `<span class="${classes.join(" ")}" style="background:color-mix(in srgb, var(--ink) ${alpha}%, transparent);${
          strong ? "color:var(--paper)" : ""
        }" title="${i}–${j} · ${(value * 100).toFixed(2)}%">${label}</span>`,
      );
    }
  }

  return `<div class="heat">
    <div class="heat__grid" role="img" aria-label="Scoreline probability grid, ${homeLabel} goals down the side, ${awayLabel} goals across. Most likely score ${peak.i}–${peak.j}.">
      ${cells.join("")}
    </div>
    <p class="panel__note">Rows are ${homeLabel} goals, columns ${awayLabel}. Most likely scoreline: ${peak.i}–${peak.j}.</p>
  </div>`;
}

const cleanBins = (bins = []) =>
  bins.filter((bin) => bin.count >= 20 && bin.predicted !== null && bin.observed !== null);

/** Reliability diagram: forecast probability against observed frequency. */
export function reliabilityChart(bins = [], marketBins = []) {
  const width = 360;
  const height = 250;
  const pad = { top: 10, right: 8, bottom: 28, left: 28 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (value) => pad.left + value * plotW;
  const y = (value) => pad.top + (1 - value) * plotH;

  const model = cleanBins(bins);
  const market = cleanBins(marketBins);

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (tick) => `
      <line x1="${x(tick)}" y1="${pad.top}" x2="${x(tick)}" y2="${pad.top + plotH}"/>
      <line x1="${pad.left}" y1="${y(tick)}" x2="${pad.left + plotW}" y2="${y(tick)}"/>
      <text x="${x(tick)}" y="${height - 8}" text-anchor="middle">${Math.round(tick * 100)}%</text>
      <text x="${pad.left - 5}" y="${y(tick) + 3}" text-anchor="end">${Math.round(tick * 100)}</text>`,
    )
    .join("");

  const line = (data) =>
    data.map((bin, index) => `${index === 0 ? "M" : "L"}${x(bin.predicted)},${y(bin.observed)}`).join(" ");

  const dots = (data, cls) =>
    data
      .map(
        (bin) =>
          `<circle class="${cls}" cx="${x(bin.predicted)}" cy="${y(bin.observed)}" r="${Math.min(
            4.5,
            1.8 + Math.sqrt(bin.count) / 11,
          ).toFixed(1)}"><title>${Math.round(bin.predicted * 100)}% forecast → ${Math.round(
            bin.observed * 100,
          )}% observed (${bin.count})</title></circle>`,
      )
      .join("");

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Reliability diagram comparing forecast probability with observed frequency.">
    <g class="grid">${grid}</g>
    <line class="ref" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}"/>
    <line class="axis" x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}"/>
    <line class="axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}"/>
    ${market.length > 1 ? `<path class="market-line" d="${line(market)}"/>` : ""}
    ${model.length > 1 ? `<path class="model-line" d="${line(model)}"/>` : ""}
    ${dots(market, "market-dot")}
    ${dots(model, "model-dot")}
  </svg>`;
}

/** Four-week rolling Brier score, model against the closing market. */
export function trendChart(trend = []) {
  const raw = completeWeeks(trend).filter(
    (row) => row.brier !== null && row.brier !== undefined && (row.matches ?? 99) >= 8,
  );
  if (raw.length < 4) return "";

  const rolling = (key) =>
    raw.map((_, index) => {
      const window = raw.slice(Math.max(0, index - 3), index + 1);
      const values = window.map((row) => row[key]).filter((value) => value != null);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    });
  const rows = raw.map((row, index) => ({
    week: row.week,
    brier: rolling("brier")[index],
    marketBrier: rolling("marketBrier")[index],
  }));

  const width = 560;
  const height = 200;
  const pad = { top: 12, right: 10, bottom: 24, left: 32 };
  const values = rows.flatMap((row) => [row.brier, row.marketBrier]).filter((value) => value != null);
  const low = Math.min(...values) - 0.004;
  const high = Math.max(...values) + 0.004;
  const x = (index) => pad.left + (index / (rows.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - low) / (high - low)) * (height - pad.top - pad.bottom);

  const path = (key) => {
    let started = false;
    return rows
      .map((row, index) => {
        if (row[key] == null) return "";
        const command = started ? "L" : "M";
        started = true;
        return `${command}${x(index).toFixed(1)},${y(row[key]).toFixed(1)}`;
      })
      .join(" ");
  };

  const ticks = [low, (low + high) / 2, high];
  const monthLabel = (week) => {
    const [year, number] = week.split("-W");
    const date = new Date(Number(year), 0, 1 + (Number(number) - 1) * 7);
    return new Intl.DateTimeFormat(undefined, { month: "short" }).format(date);
  };

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Four-week rolling Brier score for the model compared with the closing market.">
    <g class="grid">
      ${ticks
        .map(
          (tick) =>
            `<line x1="${pad.left}" y1="${y(tick)}" x2="${width - pad.right}" y2="${y(tick)}"/>
             <text x="${pad.left - 5}" y="${y(tick) + 3}" text-anchor="end">${fmt(tick, 3)}</text>`,
        )
        .join("")}
    </g>
    <line class="axis" x1="${pad.left}" y1="${pad.top + (height - pad.top - pad.bottom)}" x2="${width - pad.right}" y2="${pad.top + (height - pad.top - pad.bottom)}"/>
    <path class="market-line" d="${path("marketBrier")}"/>
    <path class="model-line" d="${path("brier")}"/>
    <text x="${pad.left}" y="${height - 6}">${monthLabel(rows[0].week)}</text>
    <text x="${width - pad.right}" y="${height - 6}" text-anchor="end">${monthLabel(rows.at(-1).week)}</text>
  </svg>`;
}

/** Distribution of total goals. */
export function goalChart(buckets = [], labels = []) {
  const width = 360;
  const height = 120;
  const pad = { top: 6, right: 0, bottom: 18, left: 0 };
  const max = Math.max(...buckets, 0.0001);
  const slot = (width - pad.left - pad.right) / buckets.length;
  const bars = buckets
    .map((value, index) => {
      const barHeight = ((height - pad.top - pad.bottom) * value) / max;
      const x = pad.left + index * slot + slot * 0.2;
      const y = height - pad.bottom - barHeight;
      const isPeak = value === max;
      return `<rect x="${x}" y="${y}" width="${slot * 0.6}" height="${Math.max(1, barHeight)}"
        fill="${isPeak ? "var(--signal)" : "var(--ink)"}" opacity="${isPeak ? 1 : 0.82}">
        <title>${labels[index] ?? index} goals · ${(value * 100).toFixed(1)}%</title></rect>
        <text x="${x + slot * 0.3}" y="${height - 5}" text-anchor="middle" fill="var(--faint)">${
          labels[index] ?? index
        }</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Distribution of total goals in this match.">${bars}</svg>`;
}
