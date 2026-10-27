/* Hand-rolled SVG charts. No chart library, no runtime dependency. */

import { completeWeeks } from "./util.js";

const fmt = (value, digits = 1) => Number(value).toFixed(digits);

/** 11x11 scoreline grid, heat-shaded by probability. */
export function scoreHeatmap(matrix, homeLabel = "Home", awayLabel = "Away") {
  const size = matrix.length;
  const cell = 25;
  const left = 22;
  const top = 16;
  const width = left + size * cell + 2;
  const height = top + size * cell + 20;
  let max = 0;
  for (const row of matrix) for (const value of row) max = Math.max(max, value);
  let hottest = { i: 0, j: 0, value: -1 };

  const cells = [];
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      const p = matrix[i][j];
      const x = left + j * cell;
      const y = top + i * cell;
      const intensity = max > 0 ? Math.pow(p / max, 0.55) : 0;
      if (p > hottest.value) hottest = { i, j, value: p };
      cells.push(
        `<rect x="${x + 1}" y="${y + 1}" width="${cell - 2}" height="${cell - 2}" rx="3"
          fill="var(--accent)" opacity="${(0.04 + intensity * 0.92).toFixed(3)}"
          data-h="${i}" data-a="${j}"></rect>`,
      );
      if (p >= 0.012) {
        const dark = intensity > 0.62;
        cells.push(
          `<text x="${x + cell / 2}" y="${y + cell / 2 + 2.6}" text-anchor="middle"
            font-size="7.4" font-weight="600" fill="${dark ? "#0a1409" : "var(--ink-2)"}"
            opacity="${dark ? 0.92 : 0.72}">${(p * 100).toFixed(1)}</text>`,
        );
      }
    }
  }

  const axis = [];
  for (let k = 0; k < size; k += 1) {
    axis.push(
      `<text x="${left + k * cell + cell / 2}" y="${top - 4}" text-anchor="middle" font-size="7.5" fill="var(--faint)">${k}</text>`,
    );
    axis.push(
      `<text x="${left - 6}" y="${top + k * cell + cell / 2 + 2.5}" text-anchor="end" font-size="7.5" fill="var(--faint)">${k}</text>`,
    );
  }

  return `<svg class="chart matrix-chart" viewBox="0 0 ${width} ${height}" role="img"
      aria-label="Scoreline probability grid from ${homeLabel} hosting ${awayLabel}. Most likely score ${hottest.i}-${hottest.j}.">
    ${axis.join("")}
    ${cells.join("")}
    <text x="${left + (size * cell) / 2}" y="${height - 4}" text-anchor="middle" font-size="7.5" fill="var(--faint)">${awayLabel.toUpperCase()} GOALS</text>
    <text x="8" y="${top + (size * cell) / 2}" text-anchor="middle" font-size="7.5" fill="var(--faint)"
      transform="rotate(-90 8 ${top + (size * cell) / 2})">${homeLabel.toUpperCase()} GOALS</text>
  </svg>`;
}

const cleanBins = (bins = []) =>
  bins.filter((bin) => bin.count >= 20 && bin.predicted !== null && bin.observed !== null);

/** Reliability diagram: predicted probability against what actually happened. */
export function reliabilityChart(bins = [], marketBins = []) {
  const width = 340;
  const height = 250;
  const pad = { top: 12, right: 12, bottom: 30, left: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (value) => pad.left + value * plotW;
  const y = (value) => pad.top + (1 - value) * plotH;

  const model = cleanBins(bins);
  const market = cleanBins(marketBins);

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (tick) => `
      <line x1="${x(tick)}" y1="${pad.top}" x2="${x(tick)}" y2="${pad.top + plotH}"/>
      <line x1="${pad.left}" y1="${y(tick)}" x2="${pad.left + plotW}" y2="${y(tick)}"/>
      <text x="${x(tick)}" y="${height - 12}" text-anchor="middle">${Math.round(tick * 100)}%</text>
      <text x="${pad.left - 6}" y="${y(tick) + 3}" text-anchor="end">${Math.round(tick * 100)}</text>`,
    )
    .join("");

  const line = (data) =>
    data.map((bin, index) => `${index === 0 ? "M" : "L"}${x(bin.predicted)},${y(bin.observed)}`).join(" ");

  const dots = (data, cls) =>
    data
      .map(
        (bin) =>
          `<circle class="${cls}" cx="${x(bin.predicted)}" cy="${y(bin.observed)}" r="${Math.min(
            5,
            2 + Math.sqrt(bin.count) / 9,
          ).toFixed(1)}"><title>${Math.round(bin.predicted * 100)}% predicted → ${Math.round(
            bin.observed * 100,
          )}% observed (${bin.count} forecasts)</title></circle>`,
      )
      .join("");

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Reliability diagram comparing forecast probability with observed frequency.">
    <defs>
      <linearGradient id="gAccent" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <g class="grid">${gridLines}</g>
    <line class="ref" x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}"/>
    <line class="axis-line" x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}"/>
    <line class="axis-line" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}"/>
    ${market.length > 1 ? `<path class="series-market" d="${line(market)}"/>` : ""}
    ${model.length > 1 ? `<path class="series-model" d="${line(model)}"/>` : ""}
    ${dots(market, "dot-market")}
    ${dots(model, "dot-model")}
    <text x="${pad.left + plotW / 2}" y="${height - 1}" text-anchor="middle" font-size="8">FORECAST PROBABILITY</text>
  </svg>`;
}

/** Weekly Brier score, model vs closing market, smoothed over four weeks. */
export function trendChart(trend = [], marketLabel = "closing market") {
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

  const width = 580;
  const height = 210;
  const pad = { top: 16, right: 14, bottom: 26, left: 34 };
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
             <text x="${pad.left - 6}" y="${y(tick) + 3}" text-anchor="end">${fmt(tick, 3)}</text>`,
        )
        .join("")}
    </g>
    <path class="series-market" d="${path("marketBrier")}"/>
    <path class="series-model" d="${path("brier")}"/>
    <text x="${pad.left}" y="${height - 8}" font-size="8">${monthLabel(rows[0].week)}</text>
    <text x="${width - pad.right}" y="${height - 8}" text-anchor="end" font-size="8">${monthLabel(rows.at(-1).week)}</text>
    <text x="${width - pad.right}" y="${pad.top - 4}" text-anchor="end" font-size="7.5">${marketLabel.toUpperCase()}</text>
  </svg>`;
}

/** Distribution of total goals in a fixture. */
export function goalChart(buckets = [], labels = []) {
  const width = 340;
  const height = 120;
  const pad = { top: 8, right: 4, bottom: 20, left: 4 };
  const max = Math.max(...buckets, 0.0001);
  const slot = (width - pad.left - pad.right) / buckets.length;
  const bars = buckets
    .map((value, index) => {
      const barHeight = ((height - pad.top - pad.bottom) * value) / max;
      const x = pad.left + index * slot + slot * 0.18;
      const y = height - pad.bottom - barHeight;
      return `<rect x="${x}" y="${y}" width="${slot * 0.64}" height="${Math.max(1, barHeight)}" rx="2"
        fill="var(--accent)" opacity="${(0.28 + (value / max) * 0.6).toFixed(2)}">
        <title>${labels[index] ?? index} goals · ${(value * 100).toFixed(1)}%</title></rect>
        <text x="${x + slot * 0.32}" y="${height - 8}" text-anchor="middle" font-size="8" fill="var(--faint)">${
          labels[index] ?? index
        }</text>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Distribution of total goals in this match.">${bars}</svg>`;
}

/** Compare two numbers as a two-sided bar. */
export function versusBars(homeValue, awayValue, homeLabel, awayLabel) {
  const total = homeValue + awayValue || 1;
  const share = (homeValue / total) * 100;
  return `<div class="versus">
    <div class="versus__labels"><span>${homeLabel}</span><span>${awayLabel}</span></div>
    <div class="versus__track">
      <i style="width:${share.toFixed(1)}%"></i>
    </div>
  </div>`;
}

/** Tiny inline sparkline for tables. */
export function sparkline(values = [], { width = 56, height = 16 } = {}) {
  if (values.length < 2) return "";
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * (width - 2) + 1;
      const y = height - 2 - ((value - low) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    <polyline points="${points}" fill="none" stroke="var(--muted)" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`;
}
