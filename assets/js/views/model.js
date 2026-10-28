import { esc, pctOf, fmtDate, completeWeeks } from "../util.js";
import { state, leagueByCode, teamByFd } from "../store.js";
import { bandHead, teamBadge, leagueTag } from "../ui.js";
import { reliabilityChart, trendChart } from "../charts.js";

const pickLabel = (index) => ["Home", "Draw", "Away"][index];

export default function modelView() {
  const metrics = state.metrics;
  if (!metrics) {
    return {
      html: `<div class="view"><div class="empty"><strong>Metrics unavailable</strong><span>The audit file could not be loaded.</span></div></div>`,
      title: "The model — Footyline",
      crumb: "Model",
      nav: "model",
    };
  }

  const summary = metrics.summary;
  const gap = summary.marketBrier ? ((summary.brier - summary.marketBrier) / summary.marketBrier) * 100 : null;

  const perLeague = Object.entries(metrics.perLeague || {})
    .map(([code, row]) => ({ ...row, league: leagueByCode(code) }))
    .filter((row) => row.league)
    .sort((a, b) => b.matches - a.matches);

  const weeks = completeWeeks(metrics.trend || []).filter((row) => row.brier != null && (row.matches ?? 99) >= 8);
  const bestWeek = weeks.length ? weeks.reduce((a, b) => (b.brier < a.brier ? b : a)) : null;
  const worstWeek = weeks.length ? weeks.reduce((a, b) => (b.brier > a.brier ? b : a)) : null;

  const logRows = (metrics.log || [])
    .slice(-30)
    .reverse()
    .map((row) => {
      const league = leagueByCode(row.league);
      const home = teamByFd(row.league, row.home);
      const away = teamByFd(row.league, row.away);
      return `<tr>
        <td class="left dim">${esc(fmtDate(row.date))}</td>
        <td class="left">${league ? leagueTag(league.id) : esc(row.league)}</td>
        <td class="left"><span class="teamcell">${home ? teamBadge(home, "sm") : ""}<span>${esc(
          home?.name || row.home,
        )}</span><span class="dim" style="padding:0 4px">v</span>${away ? teamBadge(away, "sm") : ""}<span>${esc(
          away?.name || row.away,
        )}</span></span></td>
        <td>${esc(pickLabel(row.pick))}</td>
        <td>${pctOf(Math.max(...row.p) * 100)}</td>
        <td>${esc(row.score)}</td>
        <td class="left" style="color:${row.hit ? "var(--good)" : "var(--bad)"}">${row.hit ? "Hit" : "Miss"}</td>
      </tr>`;
    })
    .join("");

  const leagueRows = perLeague
    .map(
      (row) => `<tr>
        <td class="left"><a class="teamcell" href="/league/${esc(row.league.id)}" data-link><i class="swatch" style="--tone:var(--muted)"></i><span>${esc(
          row.league.name,
        )}</span></a></td>
        <td class="hide-sm">${row.matches}</td>
        <td class="strong">${row.brier.toFixed(3)}</td>
        <td class="dim">${row.marketBrier?.toFixed(3) ?? "—"}</td>
        <td class="hide-sm">${row.logLoss.toFixed(3)}</td>
        <td>${row.accuracy.toFixed(1)}%</td>
      </tr>`,
    )
    .join("");

  const live = metrics.live;

  return {
    html: `<div class="view">
      <div class="pagehead">
        <p class="label">The model</p>
        <h1 class="display display--tight" style="margin-top:14px">An open model,<br><em>scored in public.</em></h1>
        <p class="lede" style="margin-top:18px">No odds are used in the forecast. Every number below comes from
        results alone, and every claim is measured against what actually happened.</p>
      </div>

      <div class="metrics">
        <div class="metric"><small>Matches graded</small><b>${summary.matches.toLocaleString()}</b><span>walk-forward, weekly refits</span></div>
        <div class="metric"><small>Brier score</small><b>${summary.brier.toFixed(3)}</b><span>${gap !== null ? `${gap > 0 ? "+" : ""}${gap.toFixed(1)}% vs market` : "lower is better"}</span></div>
        <div class="metric"><small>Closing market</small><b>${summary.marketBrier?.toFixed(3) ?? "—"}</b><span>same fixtures, de-vigged</span></div>
        <div class="metric"><small>Accuracy</small><b>${summary.accuracy.toFixed(1)}%</b><span>${summary.marketAccuracy?.toFixed(1) ?? "—"}% market</span></div>
        <div class="metric"><small>Log loss</small><b>${summary.logLoss.toFixed(3)}</b><span>${summary.marketLogLoss?.toFixed(3) ?? "—"} market</span></div>
        <div class="metric"><small>Calibration error</small><b>${(summary.ece * 100).toFixed(1)}%</b><span>expected calibration error</span></div>
        <div class="metric"><small>Audit window</small><b>${metrics.range ? esc(metrics.range.start.slice(0, 7)) : "—"}</b><span>to ${metrics.range ? esc(metrics.range.end.slice(0, 7)) : "—"}</span></div>
        <div class="metric"><small>Refit cadence</small><b>7d</b><span>ratings re-fitted weekly</span></div>
      </div>

      <section class="band">
        ${bandHead({ idx: "01", title: "How a number gets made" })}
        <div class="split">
          <div class="prose">
            <p><strong>1. Results in, ratings out.</strong> Every completed match in eleven leagues feeds a
            Dixon-Coles bivariate Poisson model. Each club gets an attack and a defence rating; the league gets a
            home advantage and a low-score correlation. Fitting maximises a weighted likelihood, so recent matches
            count more than old ones — half the weight is gone after about
            <strong>${state.feed?.model?.halfLifeDays ?? 420} days</strong>.</p>
            <p><strong>2. Shrinkage, not confidence tricks.</strong> Ratings are ridge-regularised toward the league
            average, and clubs without much evidence are pulled further toward a conservative promoted-side prior.
            Eight matches cannot rewrite five seasons.</p>
            <p><strong>3. One grid, every market.</strong> The two expected-goal figures produce an 11×11 scoreline
            grid. Match result, double chance, totals, both-teams-to-score, team goals and Asian handicaps are all read
            off that same grid, so the markets can never contradict one another.</p>
            <p><strong>4. No odds in the forecast.</strong> The model never sees a price. Closing odds are used only as
            an independent benchmark on this page, which is why the comparison is worth reading.</p>
          </div>

          <div>
            <div class="formula">
              <var>λ</var><sub>home</sub> = exp( <var>α</var><sub>home</sub> + <var>β</var><sub>away</sub> + <var>γ</var> )<br>
              <var>λ</var><sub>away</sub> = exp( <var>α</var><sub>away</sub> + <var>β</var><sub>home</sub> )<br>
              P(x, y) ∝ <var>τ</var>(x, y)<br>
              &nbsp;&nbsp;· Poisson(x; <var>λ</var><sub>home</sub>)<br>
              &nbsp;&nbsp;· Poisson(y; <var>λ</var><sub>away</sub>)
            </div>
            <dl class="kv" style="margin-top:16px">
              <dt>α · attack</dt><dd>goals created</dd>
              <dt>β · defence</dt><dd>goals conceded</dd>
              <dt>γ · home advantage</dt><dd>fitted per league</dd>
              <dt>τ · low-score fix</dt><dd>draws &amp; 1-0s</dd>
              <dt>Half-life</dt><dd>${state.feed?.model?.halfLifeDays ?? 420} days</dd>
              <dt>Ridge penalty</dt><dd>${state.feed?.model?.ridge?.toFixed(3) ?? "0.05"}</dd>
              <dt>Training matches</dt><dd>${(state.feed?.model?.trainedMatches ?? 0).toLocaleString()}</dd>
            </dl>
            <p class="panel__note">The low-score correction is what stops the model assigning implausibly little
            weight to 0-0, 1-0 and 1-1 — the most common football scores.</p>
          </div>
        </div>
      </section>

      <section class="band">
        ${bandHead({ idx: "02", title: "Does it hold up?" })}
        <div class="split">
          <div class="panel" style="border-top:0;padding-top:0">
            <h3>Reliability</h3>
            ${reliabilityChart(metrics.calibration, metrics.marketCalibration)}
            <div class="chart-legend">
              <span><i style="background:var(--ink)"></i>Footyline</span>
              <span><i style="background:var(--signal)"></i>Closing market</span>
              <span><i style="background:var(--faint)"></i>Perfect calibration</span>
            </div>
            <p class="panel__note">A model is calibrated when its 40% forecasts happen 40% of the time. Dots on the
            diagonal are honest; dots above it are under-confident.</p>
          </div>

          <div class="panel" style="border-top:0;padding-top:0">
            <h3>Brier over time</h3>
            ${trendChart(metrics.trend)}
            <div class="chart-legend">
              <span><i style="background:var(--ink)"></i>Model</span>
              <span><i style="background:var(--signal)"></i>Market</span>
            </div>
            <dl class="kv" style="margin-top:14px">
              <dt>Best four weeks</dt><dd>${bestWeek ? bestWeek.brier.toFixed(3) : "—"}</dd>
              <dt>Worst four weeks</dt><dd>${worstWeek ? worstWeek.brier.toFixed(3) : "—"}</dd>
              ${live?.settled ? `<dt>Live record</dt><dd>${live.settled} settled · Brier ${live.brier}</dd>` : ""}
            </dl>
          </div>
        </div>

        <div class="tablescroll" style="margin-top:34px">
          <table class="table table--league">
            <thead><tr><th class="left">Competition</th><th class="hide-sm">Matches</th><th>Brier</th><th>Market</th><th class="hide-sm">Log loss</th><th>Accuracy</th></tr></thead>
            <tbody>${leagueRows}</tbody>
          </table>
        </div>
      </section>

      <section class="band">
        ${bandHead({ idx: "03", title: "Every call, kept honest" })}
        <div class="tablescroll">
          <table class="table table--log">
            <thead><tr><th class="left">Date</th><th class="left">Comp</th><th class="left">Fixture</th><th>Pick</th><th>Prob.</th><th>Score</th><th class="left">Result</th></tr></thead>
            <tbody>${logRows}</tbody>
          </table>
        </div>
        <p class="panel__note">The most recent ${Math.min(30, (metrics.log || []).length)} forecasts from the backtest,
        shown with the probability at the time it was made. Nothing is edited after the fact.</p>
      </section>

      <section class="band">
        ${bandHead({ idx: "04", title: "What it cannot do" })}
        <div class="split">
          <div class="prose">
            <p><strong>It cannot see team sheets.</strong> Injuries, suspensions, rotation and managerial changes
            enter the ratings only through results, and only after they have happened.</p>
            <p><strong>It cannot price a squad.</strong> There is no transfer-value or wage input. A newly rich club
            looks average until it plays like a rich club.</p>
            <p><strong>It cannot beat the market reliably.</strong> A well-built open model gets close to closing
            prices, and closing prices are the hardest benchmark in sport. Where this model trails, it trails by a
            few hundredths of a Brier point.</p>
            <p><strong>It cannot promise anything.</strong> A 70% favourite is a 30% loser. Probabilities describe
            uncertainty; they do not remove it.</p>
          </div>
          <div class="panel" style="border-top:0;padding-top:0">
            <h3>Provenance</h3>
            <dl class="kv">
              <dt>Results</dt><dd><a href="https://www.football-data.co.uk/" target="_blank" rel="noopener" style="border-bottom:1px solid var(--rule)">football-data.co.uk</a></dd>
              <dt>Fixtures</dt><dd><a href="https://fixturedownload.com/" target="_blank" rel="noopener" style="border-bottom:1px solid var(--rule)">fixturedownload.com</a></dd>
              <dt>Season</dt><dd>${esc(metrics.season || "")}</dd>
              <dt>Model hash</dt><dd>${esc(metrics.modelVersion || "—")}</dd>
              <dt>Audit built</dt><dd>${esc((metrics.auditGeneratedAt || "").slice(0, 10))}</dd>
            </dl>
            <p class="panel__note">Everything is rebuilt from those two public sources. No black-box feed, no
            purchased ratings.</p>
          </div>
        </div>
      </section>

      <p class="disclaimer"><strong>Not betting advice.</strong> Footyline publishes statistical analysis of football
      matches. It does not take bets, offer tips, or guarantee outcomes.</p>
    </div>`,
    title: "The model — Footyline",
    crumb: "Model",
    nav: "model",
  };
}
