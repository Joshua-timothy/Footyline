/* Client-side probability engine.
   Mirrors pipeline/model.py so any scoreline grid can be explored live. */

export const MAX_GOALS = 10;
const SIZE = MAX_GOALS + 1;

const logFactorial = Array.from({ length: SIZE }, (_, k) => {
  let total = 0;
  for (let i = 2; i <= k; i += 1) total += Math.log(i);
  return total;
});

const pmf = (lambda, max = MAX_GOALS) => {
  const out = new Array(max + 1);
  for (let k = 0; k <= max; k += 1) {
    out[k] = Math.exp(-lambda + k * Math.log(lambda) - logFactorial[k]);
  }
  return out;
};

/** Normalised Dixon-Coles score matrix, indexed [homeGoals][awayGoals]. */
export function scoreMatrix(lambdaHome, lambdaAway, rho = 0) {
  const home = pmf(lambdaHome);
  const away = pmf(lambdaAway);
  const matrix = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
  let total = 0;
  for (let i = 0; i < SIZE; i += 1) {
    for (let j = 0; j < SIZE; j += 1) {
      let value = home[i] * away[j];
      if (i === 0 && j === 0) value *= Math.max(1e-10, 1 - lambdaHome * lambdaAway * rho);
      else if (i === 0 && j === 1) value *= Math.max(1e-10, 1 + lambdaHome * rho);
      else if (i === 1 && j === 0) value *= Math.max(1e-10, 1 + lambdaAway * rho);
      else if (i === 1 && j === 1) value *= Math.max(1e-10, 1 - rho);
      matrix[i][j] = value;
      total += value;
    }
  }
  if (total > 0) {
    for (let i = 0; i < SIZE; i += 1) {
      for (let j = 0; j < SIZE; j += 1) matrix[i][j] /= total;
    }
  }
  return matrix;
}

export const outcomeProbabilities = (matrix) => {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i < SIZE; i += 1) {
    for (let j = 0; j < SIZE; j += 1) {
      if (i > j) home += matrix[i][j];
      else if (i === j) draw += matrix[i][j];
      else away += matrix[i][j];
    }
  }
  return { home, draw, away };
};

const sumWhere = (matrix, predicate) => {
  let total = 0;
  for (let i = 0; i < SIZE; i += 1) {
    for (let j = 0; j < SIZE; j += 1) {
      if (predicate(i, j)) total += matrix[i][j];
    }
  }
  return total;
};

export function buildMarkets(matrix) {
  const { home, draw, away } = outcomeProbabilities(matrix);

  const over = (line) => sumWhere(matrix, (i, j) => i + j > line);
  const btts = sumWhere(matrix, (i, j) => i > 0 && j > 0);
  const homeGoals = (min) => sumWhere(matrix, (i) => i >= min);
  const awayGoals = (min) => sumWhere(matrix, (_, j) => j >= min);
  const handicap = (line) => {
    const win = sumWhere(matrix, (i, j) => i - j + line > 0);
    const push = sumWhere(matrix, (i, j) => i - j + line === 0);
    return push > 0.999 ? 0 : win / (1 - push);
  };

  const scores = [];
  for (let i = 0; i < SIZE; i += 1) {
    for (let j = 0; j < SIZE; j += 1) scores.push({ home: i, away: j, p: matrix[i][j] });
  }
  scores.sort((a, b) => b.p - a.p);

  let expectedTotal = 0;
  for (let i = 0; i < SIZE; i += 1) {
    for (let j = 0; j < SIZE; j += 1) expectedTotal += (i + j) * matrix[i][j];
  }

  return {
    home,
    draw,
    away,
    expectedTotal,
    groups: [
      {
        title: "Match result",
        items: [
          { label: "Home win", value: home },
          { label: "Draw", value: draw },
          { label: "Away win", value: away },
        ],
      },
      {
        title: "Double chance & draw no bet",
        items: [
          { label: "Home or draw", value: home + draw },
          { label: "Draw or away", value: draw + away },
          { label: "Home or away", value: home + away },
          { label: "Draw no bet · home", value: home / (home + away || 1) },
          { label: "Draw no bet · away", value: away / (home + away || 1) },
        ],
      },
      {
        title: "Total goals",
        items: [
          { label: "Over 1.5", value: over(1.5) },
          { label: "Over 2.5", value: over(2.5) },
          { label: "Over 3.5", value: over(3.5) },
          { label: "Over 4.5", value: over(4.5) },
          { label: "Under 2.5", value: 1 - over(2.5) },
        ],
      },
      {
        title: "Both teams & clean sheets",
        items: [
          { label: "Both teams to score", value: btts },
          { label: "Home clean sheet", value: sumWhere(matrix, (_, j) => j === 0) },
          { label: "Away clean sheet", value: sumWhere(matrix, (i) => i === 0) },
          { label: "Home win to nil", value: sumWhere(matrix, (i, j) => i > j && j === 0) },
          { label: "Away win to nil", value: sumWhere(matrix, (i, j) => j > i && i === 0) },
        ],
      },
      {
        title: "Team goals",
        items: [
          { label: "Home over 0.5", value: homeGoals(1) },
          { label: "Home over 1.5", value: homeGoals(2) },
          { label: "Away over 0.5", value: awayGoals(1) },
          { label: "Away over 1.5", value: awayGoals(2) },
        ],
      },
      {
        title: "Asian handicap · home",
        items: [
          { label: "Home −1.5", value: handicap(-1.5) },
          { label: "Home −1", value: handicap(-1) },
          { label: "Home −0.5", value: handicap(-0.5) },
          { label: "Home +0.5", value: handicap(0.5) },
          { label: "Home +1", value: handicap(1) },
          { label: "Home +1.5", value: handicap(1.5) },
        ],
      },
    ],
    scores: scores.slice(0, 35),
    topScores: scores.slice(0, 8),
  };
}

/** Spread of total goals, used for the goal-distribution chart. */
export function goalDistribution(matrix, max = 6) {
  const buckets = new Array(max + 1).fill(0);
  for (let i = 0; i < SIZE; i += 1) {
    for (let j = 0; j < SIZE; j += 1) {
      const total = i + j;
      buckets[Math.min(total, max)] += matrix[i][j];
    }
  }
  return buckets;
}

/** Probability that a side scores exactly n goals. */
export function marginDistribution(matrix, max = 5) {
  const out = new Map();
  for (let diff = -max; diff <= max; diff += 1) {
    let total = 0;
    for (let i = 0; i < SIZE; i += 1) {
      for (let j = 0; j < SIZE; j += 1) {
        if (i - j === diff) total += matrix[i][j];
      }
    }
    out.set(diff, total);
  }
  return out;
}

export const fixtureMatrix = (fixture, league) =>
  scoreMatrix(fixture.lh, fixture.la, league?.rho ?? 0);

export const marketById = (fixture) => {
  const [home, draw, away] = fixture.p;
  return {
    home,
    draw,
    away,
    pick: home >= draw && home >= away ? 0 : away >= home && away >= draw ? 2 : 1,
  };
};
