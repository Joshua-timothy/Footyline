import { esc, pctOf, fmtDate, completeWeeks } from "../util.js";
import { state, leagueByCode, teamByFd } from "../store.js";
import { sectionHead, teamBadge, leagueTag } from "../ui.js";
import { reliabilityChart, trendChart } from "../charts.js";

const pickLabel = (index) => ["Home", "Draw", "Away"][index];

export default function modelView() {
  const metrics = state.metrics;
  if (!metrics) {
    return {
      html: `<div class="view"><div class="empty"><strong>Metrics unavailable</strong><span>The model audit file could not be loaded.</span></div></div>`,
      title: "The model — Footyline",
      crumb: "The model",
      nav: "model",
    };
  }

  const summary = metrics.summary;
  const gap = summary.marketBrier
    ? ((summary.brier - summary.marketBrier) / summary.marketBrier) * 100
    : null;

  const perLeague = Object.entries(metrics.perLeague || {})
    .map(([code, row]) => ({ ...row, league: leagueByCode(code) }))
    .filter((row) => row.league)
    .sort((a, b) => b.matches - a.matches);

  const logRows = (metrics.log || [])
    .slice(-36)
    .reverse()
    .map((row) => {
      const league = leagueByCode(row.league);
      const home = teamByFd(row.league, row.home);
      const away = teamByFd(row.league, row.away);
      const probability = Math.max(...row.p);
      return `<tr>
        <td class="left dim">${esc(fmtDate(row.date))}</td>
        <td class="left">${league ? leagueTag(league.id) : esc(row.league)}</td>
        <td class="left"><span class="team-cell">${
          home ? teamBadge(home, "sm") : ""
        }<span>${esc(home?.name || row.home)}</span><i class="dim" style="font-style:normal">v</i>${
          away ? teamBadge(away, "sm") : ""
        }<span>${esc(away?.name || row.away)}</span></span></td>
        <td class="left">${esc(pickLabel(row.pick))}</td>
        <td>${pctOf(probability * 100)}</td>
        <td>${esc(row.score)}</td>
        <td class="left ${row.hit ? "hit" : "miss"}">${row.hit ? "Hit" : "Miss"}</td>
      </tr>`;
    })
    .join("");

  const leagueRows = perLeague
    .map(
      (row) => `<tr>
        <td class="left"><a class="team-cell" href="/league/${esc(row.league.id)}" data-link><i class="league-flag" style="--flag:var(--line)"></i><span>${esc(
          row.league.name,
        )}</span></a></td>
        <td>${row.matches}</td>
        <td>${row.brier.toFixed(3)}</td>
        <td class="dim">${row.marketBrier?.toFixed(3) ?? "—"}</td>
        <td>${row.logLoss.toFixed(3)}</td>
        <td>${row.accuracy.toFixed(1)}%</td>
      </tr>`,
    )
    .join("");

  const weeks = completeWeeks(metrics.trend || []).filter((row) => row.brier != null && (row.matches ?? 99) >= 8);
  const bestWeek = weeks.length ? weeks.reduce((a, b) => (b.brier < a.brier ? b : a)) : null;
  const worstWeek = weeks.length ? weeks.reduce((a, b) => (b.brier > a.brier ? b : a)) : null;
  const marketEdge = weeks.filter((row) => row.marketBrier != null);
  const gaps = marketEdge.map((row) => row.brier - row.marketBrier);
  const closeness = gaps.length ? (gaps.reduce((sum, value) => sum + value, 0) / gaps.length) * 1000 : null;

  return {
    html: `<div class="view">
      <div class="pagehead">
        <div class="pagehead__id">
          <div>
            <p class="eyebrow">Model notes</p>
            <h1 class="display" style="font-size:clamp(30px,4.6vw,46px)">Probability,<br><em>never a promise.</em></h1>
            <small>Every forecast here is scored in public. This page is the audit trail.</small>
          </div>
        </div>
      </div>

      <div class="metric-grid">
        <div class="metric"><small>Backtested matches</small><b>${summary.matches.toLocaleString()}</b><span>walk-forward, weekly refits</span></div>
        <div class="metric"><small>Brier score</small><b>${summary.brier.toFixed(3)}</b><span>${gap !== null ? `${gap > 0 ? "+" : ""}${gap.toFixed(1)}% vs closing market` : "lower is better"}</span></div>
        <div class="metric"><small>Closing market</small><b>${summary.marketBrier?.toFixed(3) ?? "—"}</b><span>same fixtures, de-vigged odds</span></div>
        <div class="metric"><small>Accuracy</small><b>${summary.accuracy.toFixed(1)}%</b><span class="dim">${summary.marketAccuracy?.toFixed(1) ?? "—"}% market</span></div>
        <div class="metric"><small>Log loss</small><b>${summary.logLoss.toFixed(3)}</b><span class="dim">${summary.marketLogLoss?.toFixed(3) ?? "—"} market</span></div>
        <div class="metric"><small>Calibration error</small><b>${(summary.ece * 100).toFixed(1)}%</b><span>expected calibration error</span></div>
        <div class="metric"><small>Forecast window</small><b>${metrics.range ? esc(metrics.range.start.slice(0, 7)) : "—"}</b><span>to ${metrics.range ? esc(metrics.range.end.slice(0, 7)) : "—"}</span></div>
        <div class="metric"><small>Refit cadence</small><b>7d</b><span>ratings re-fitted weekly</span></div>
      </div>

      <section class="section">
        ${sectionHead({ eyebrow: "Method", title: "How a number gets made" })}
        <div class="detail-grid">
          <div class="card"><div class="panel-body stack prose">
            <p><strong>1. Results in, ratings out.</strong> Every completed match in eleven leagues since 2021 feeds a
            Dixon-Coles bivariate Poisson model. Each club gets an attack and a defence rating; the league gets a home
            advantage and a low-score correlation. Fitting maximises a weighted likelihood, so recent matches count more
            than old ones — half the weight is gone after about
            <strong>${state.feed?.model?.halfLifeDays ?? 420} days</strong>.</p>
            <p><strong>2. Shrinkage, not confidence tricks.</strong> Ratings are ridge-regularised toward the league
            average, and clubs without much evidence are pulled further toward a conservative promoted-side prior. Eight
            matches cannot rewrite five seasons.</p>
            <p><strong>3. One grid, every market.</strong> The two expected-goal figures produce an 11×11 scoreline
            grid. Match result, double chance, totals, both-teams-to-score, team goals and Asian handicaps are all read
            off the same grid, so the markets can never contradict one another.</p>
            <p><strong>4. No odds in the forecast.</strong> The model never sees a price. Closing odds are used only as
            an independent benchmark on this page, which is why the comparison is worth reading.</p>
          </div></div>

          <div class="card"><div class="panel-body stack">
            <div class="formula">
              <var>λ</var><sub>home</sub> = exp( <var>α</var><sub>home</sub> + <var>β</var><sub>away</sub> + <var>γ</var> )<br>
              <var>λ</var><sub>away</sub> = exp( <var>α</var><sub>away</sub> + <var>β</var><sub>home</sub> )<br>
              P(x, y) ∝ <var>τ</var>(x, y)<br>
              &nbsp;&nbsp;&nbsp;&nbsp;· Poisson(x; <var>λ</var><sub>home</sub>)<br>
              &nbsp;&nbsp;&nbsp;&nbsp;· Poisson(y; <var>λ</var><sub>away</sub>)
            </div>
            <dl class="kv">
              <dt>α · attack rating</dt><dd>goals created</dd>
              <dt>β · defence rating</dt><dd>goals conceded</dd>
              <dt>γ · home advantage</dt><dd>fitted per league</dd>
              <dt>τ · low-score correction</dt><dd>draws &amp; 1-0s</dd>
              <dt>Half-life</dt><dd>${state.feed?.model?.halfLifeDays ?? 420} days</dd>
              <dt>Ridge penalty</dt><dd>${state.feed?.model?.ridge?.toFixed(3) ?? "0.035"}</dd>
              <dt>Training matches</dt><dd>${(state.feed?.model?.trainedMatches ?? 0).toLocaleString()}</dd>
            </dl>
            <p class="dim" style="font-size:11.5px">The low-score correction is what stops the model assigning
            implausibly little weight to 0-0, 1-0 and 1-1 — the most common football scores.</p>
          </div></div>
        </div>
      </section>

      <section class="section">
        ${sectionHead({ eyebrow: "Validation", title: "Does it hold up?" })}
        <div class="detail-grid">
          <section class="card">
            <div class="panel-head"><h3>Reliability</h3><span class="eyebrow">Predicted vs observed</span></div>
            <div class="panel-body">
              ${reliabilityChart(metrics.calibration, metrics.marketCalibration)}
              <div class="chart-legend" style="margin-top:8px">
                <span><i style="background:var(--accent)"></i>Footyline</span>
                <span><i style="background:var(--mint)"></i>Closing market</span>
                <span><i style="background:var(--muted)"></i>Perfect calibration</span>
              </div>
              <p class="chart-note">A model is calibrated when its 40% forecasts happen 40% of the time. Dots on the
              diagonal are honest; dots above it are under-confident.</p>
            </div>
          </section>

          <section class="card">
            <div class="panel-head"><h3>Weekly Brier score</h3><span class="eyebrow">Lower is better</span></div>
            <div class="panel-body">
              ${trendChart(metrics.trend)}
              <div class="chart-legend" style="margin-top:8px">
                <span><i style="background:var(--accent)"></i>Model</span>
                <span><i style="background:var(--mint)"></i>Market</span>
              </div>
              <p class="chart-note">Each point is a four-week rolling average, so a single wild matchweek does not
              dominate the picture. The nine-month average is what matters.</p>
              <div class="model-panel__stats" style="margin-top:14px">
                <div><small>Best four weeks</small><b>${bestWeek ? bestWeek.brier.toFixed(3) : "—"}</b><span>${bestWeek ? bestWeek.week : ""}</span></div>
                <div><small>Worst four weeks</small><b>${worstWeek ? worstWeek.brier.toFixed(3) : "—"}</b><span>${worstWeek ? worstWeek.week : ""}</span></div>
                <div><small>Gap to market</small><b>${closeness != null ? `${closeness > 0 ? "+" : ""}${closeness.toFixed(1)}` : "—"}</b><span>Brier points ×1000</span></div>
              </div>
            </div>
          </section>
        </div>

        <section class="card" style="margin-top:12px">
          <div class="panel-head"><h3>By competition</h3><span class="eyebrow">Walk-forward, same period</span></div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th class="left">Competition</th><th>Matches</th><th>Brier</th><th>Market</th><th>Log loss</th><th>Accuracy</th></tr></thead>
              <tbody>${leagueRows}</tbody>
            </table>
          </div>
        </section>
      </section>

      <section class="section">
        ${sectionHead({ eyebrow: "Forecast log", title: "Every call, kept honest" })}
        <div class="table-wrap card">
          <table class="table log-table">
            <thead><tr><th class="left">Date</th><th class="left">Comp</th><th class="left">Fixture</th><th class="left">Pick</th><th>Prob.</th><th>Score</th><th class="left">Result</th></tr></thead>
            <tbody>${logRows}</tbody>
          </table>
        </div>
        <p class="chart-note">The most recent ${Math.min(36, (metrics.log || []).length)} forecasts from the backtest,
        shown with the pick's probability at the time it was made. Nothing is edited after the fact.</p>
      </section>

      <section class="section">
        ${sectionHead({ eyebrow: "Limits", title: "What this model cannot do" })}
        <div class="card"><div class="panel-body stack prose">
          <p><strong>It cannot see team sheets.</strong> Injuries, suspensions, rotation and managerial changes enter the
          ratings only through results, and only after they have happened.</p>
          <p><strong>It cannot price a squad.</strong> There is no transfer-value or wage input. A newly rich club looks
          average until it plays like a rich club.</p>
          <p><strong>It cannot beat the market reliably.</strong> The honest framing: a well-built open model gets close
          to closing prices, and closing prices are the hardest benchmark in sport. Where this model trails, it trails
          by a few hundredths of a Brier point.</p>
          <p><strong>It cannot promise anything.</strong> A 70% favourite is a 30% loser. Probabilities describe
          uncertainty; they do not remove it.</p>
        </div></div>
      </section>

      <section class="section">
        ${sectionHead({ eyebrow: "Provenance", title: "Where the data comes from" })}
        <div class="card"><div class="panel-body stack prose">
          <p>Results, half-time scores and closing odds: <a href="https://www.football-data.co.uk/" target="_blank" rel="noopener"><u>football-data.co.uk</u></a>,
          the long-running open archive of European football results.</p>
          <p>Fixture calendar for the live season: <a href="https://fixturedownload.com/" target="_blank" rel="noopener"><u>fixturedownload.com</u></a>.</p>
          <p>Everything on this site is rebuilt from those two public sources. No black-box feed, no purchased ratings.</p>
        </div></div>
      </section>

      <p class="disclaimer"><strong>Not betting advice.</strong> Footyline publishes statistical analysis of football
      matches. It does not take bets, offer tips, or guarantee outcomes. If you gamble, gamble only what you can afford
      to lose.</p>
    </div>`,
    title: "The model — Footyline",
    crumb: "The model",
    nav: "model",
  };
}
