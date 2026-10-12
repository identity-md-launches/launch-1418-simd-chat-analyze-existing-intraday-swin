# Analytics, scenarios and calibration

This is an implementation specification for [analytics.ts](../src/lib/analytics.ts), [engine.ts](../src/lib/engine.ts), [scenarios.ts](../src/lib/scenarios.ts), [research.worker.ts](../src/lib/research.worker.ts) and [Backtest.tsx](../src/pages/Backtest.tsx). It documents research calculations, not profitability claims.

## Data and causality

The default seven-day series is synthetic. CSV import uses the exact header `time,open,high,low,close,volume,sentiment`. The view rejects files over 5 MiB; `parseCsv` accepts 30–25,000 strictly chronological rows. Timestamps are integer Unix seconds from 2000 through 2100, OHLC prices must be finite and positive, volume nonnegative, and high/low must enclose open/close. A sentiment score is 0–100 or blank (`null`). The simple parser expects seven comma-separated fields; it is not a general quoted-field CSV parser.

A candle timestamp denotes its opening time. A provided score must have been available by that candle's close; the importer cannot independently certify that provenance. Backtests read the previous candle's score and RSI before filling at the next open. Missing scores do not trigger entries or sentiment exits, while existing price stops remain active. Imported scores are already aggregated; changing source weights does not reconstruct historical component scores.

## Adaptive indicators

For candle `t > 0`, true range is `TR[t] = max(high−low, abs(high−previousClose), abs(low−previousClose))`. Wilder ATR(14) is unavailable before index 14. Its first value is the mean of true ranges 1–14; later values use `(13 × previousATR + TR) / 14`.

Normalize volatility as `n[t] = ATR[t] / close[t]`. The baseline is the mean of up to 50 **preceding** valid normalized observations. Before a prior observation exists it uses the current normalization. The current value joins the baseline only after this bar's outputs are computed.

| Output | Implemented calculation |
| --- | --- |
| Relative volatility | `r = clamp(n / precedingMean, 0.5, 2.5)`; use 1 during unavailable/zero-baseline warmup |
| EMA period | `round(clamp(20 × r, 10, 40))` |
| Adaptive EMA | First close seeds it; thereafter `alpha × close + (1−alpha) × previousEMA`, where `alpha = 2 / (period+1)` |
| RSI period | `round(clamp(14 × r, 7, 28))` |
| Adaptive RSI | Seed mean gains/losses using the first 14 changes, then update each with `mean += (current−mean)/currentRsiPeriod`; unavailable before index 14; flat = 50, no losses = 100, otherwise `100−100/(1+gain/loss)` |
| Bands | Half-width `2 × ATR × sqrt(r)` around the adaptive EMA; lower bound floored at zero |
| Regime | Quiet when `r < 0.8`, Elevated when `r > 1.25`, Balanced otherwise |

Higher relative volatility lengthens smoothing and widens bands; quiet periods shorten smoothing. These are bounded heuristic responses. They do not optimize predictive accuracy or guarantee better signals. All computations use data at or before each output, and tests check prefix stability when later candles are appended.

Fixed RSI(14) remains selectable in saved signal rules and research configuration. The chart's Adaptive toggle independently controls its displayed RSI/EMA bands. VWAP resets on each UTC day using typical price `(high+low+close)/3` weighted by volume. MACD stays fixed at EMA12−EMA26 with EMA9 signal; it is not volatility adapted. Charts recompute on the selected 5m/15m/1h/4h aggregation, while live decisions use the underlying closed five-minute bars. A larger chart bucket can consist of the closed five-minute bars available so far; it is not a separate guarantee that a full larger interval has completed.

## Execution model

`backtest` requires at least 30 candles and begins evaluation at index 15 by default. Only one long position can be open. Entries require previous-bar sentiment at or above `buy` and the chosen RSI at or below `maxRsi`. Previous sentiment at or below `sell` exits an existing position at the next open.

Entry fill is `open × (1+slippage/100)`. Exit fill is the selected raw exit price times `(1−slippage/100)`. Both entry and exit notional incur the configured fee. Quantity is the smaller of `cash × risk% / stopDistance` and `cash / (entryFill × (1+feeRate))`; no leverage or negative-cash funding is introduced.

| Stop mode | Entry distance / subsequent behavior |
| --- | --- |
| Fixed | `entryFill × stopPercent/100` |
| ATR | Previous-bar Wilder ATR(14) × configured multiplier; zero or invalid distance prevents entry |
| Trailing | Initial percentage distance; after each bar's exits are evaluated, raise the stop to at least `highestClosingPriceSinceEntry × (1−trailingPercent/100)`. The raised stop applies from the next bar; no same-bar hindsight from a future high is used |

If both stop and target are crossed in one candle, the stop is evaluated first. A stop fills from `min(open, stop)` before adverse slippage; a target uses `max(open, target)` before slippage. Thus adverse stop gaps and favorable target gaps are both represented, but no intrabar path is reconstructed. An open final position is liquidated at the final close with exit costs.

Research drawdown/daily-loss limits are independent of the manually armed paper profile. Zero disables either research limit. Each close marks cash plus position value less estimated exit fee; it does not subtract prospective exit slippage. Peak equity determines drawdown. Reaching the drawdown limit halts new entries for the remaining run and queues a next-open exit. Daily loss uses the previous marked equity at the start of the UTC day, blocks entries for that day and similarly queues an exit. The daily block clears on a new UTC day. Stops and costs can overshoot limits; these are bar-close checks, not guaranteed account floors.

## Result definitions

The baseline and each scenario report trades, per-bar equity, final equity, net return, maximum bar-close drawdown, winning-trade percentage, average net trade, fees paid, slippage cost, evaluated/total bars, exposure percentage, halt status and protection events. Net return is `(finalCash/initialCapital−1)×100`; P&L includes both fees and slippage. Profit factor is summed positive net P&L divided by absolute summed negative net P&L; it is `null` when there are no losses, rather than a fictitious finite value. Exposure counts evaluated bars with a carried or newly opened position. The buy-and-hold comparator is last close / first evaluated open − 1, **before** costs. Zero-trade statistics are not evidence that a strategy is safe.

## Scenario transformations

`stressSuite` runs all four scenarios with the same underlying strategy. Their event begins at `max(16, floor(barCount×0.55))`.

| Scenario | Transformation | Defaults / bounds |
| --- | --- | --- |
| Baseline | Original candles and configured costs | No transformation |
| Gap down | Multiply all OHLC from the event onward by `1−crashPct/100`; lower price level persists | 12%; allowed 1–50% |
| Volatility shock | Starting from the previous transformed close, multiply the log open gap, body and wick ratios by the selected factor for 24 bars. Thereafter factor 1 propagates the original returns from the transformed level | 2.5×; allowed 1–5× |
| Liquidity squeeze | Original prices, but add extra adverse slippage per side for the entire dataset; total capped at 5% | +0.75 percentage points; extra allowed 0–4 |

Sentiment, volume and timestamps are kept unchanged. OHLC consistency is preserved by the transformations and validated again before backtesting. Nonfinite transformed prices/indicators/account values are rejected. These are hypothetical sensitivity tests; they do not reproduce named historical crises, source reactions, market depth or price impact.

## Chronological calibration

At least 120 bars are required. The split is `floor(N×0.7)` training bars followed by the remaining holdout bars. Training evaluates from index 15. Candidate generation crosses buy-threshold offsets `−5, 0, +5` with stop-distance multipliers `0.75, 1, 1.25`. Buy remains above sell and at most 100. The chosen stop-mode parameter alone is varied: fixed percentage, trailing percentage or ATR multiplier. Values are clamped to their allowed limits and identical configurations are deduplicated, so there can be fewer than nine candidates.

Each candidate's training score is `netReturnPercent−maxDrawdownPercent`. Candidates with at least three completed training trades rank ahead of ineligible candidates, followed by descending score, then lower buy threshold. Stable input order resolves remaining ties. If no candidate is eligible, the selected configuration is explicitly exploratory and a warning says there are insufficient samples.

The selected candidate is evaluated once on the holdout, alongside the original uncalibrated configuration. The entire earlier prefix initializes causal indicators, but no training cash or position carries across the boundary. Both runs start flat with the configured initial capital. The first holdout open can use the immediately preceding training close's signal because that information was available at the boundary.

The report includes split dates, training/holdout/scored bar counts, every candidate/configuration/training metric, eligibility, objective, chosen candidate, held-out results and baseline, minimum trade count and warnings. Warnings cover fewer than three holdout trades, insufficient eligible training samples, underperformance against the uncalibrated holdout and missing sentiment. Holdout prices are not used in ranking. Repeatedly tuning after reading holdout outcomes still introduces selection bias; the implementation does not enforce a permanently untouched dataset.

## Workers, exports and invalidation

Each run creates a module Web Worker for one task. The view tracks an asset/dataset-fingerprint/configuration key, plus stress settings for scenario work. Input changes and navigation cancel the worker; mismatched or replaced results are ignored. A terminated worker cannot silently replace a newer research run. Errors appear as recoverable messages. The worker bundle must be published with the rest of `dist/assets/`.

`pulse-research-report.json` uses schema `pulse.research.v2` and contains generation time, asset, dataset provenance, row count/time range, configuration, explicit assumptions, baseline, scenario settings/results and calibration when computed. Missing runs are `null`, not synthetic results. Dataset CSV and trade ledger CSV are separate downloads. `datasetFingerprint` is a 32-bit FNV-1a-style rolling hash over serialized candle fields; it is useful for matching exported data, not authentication or collision-proof identification.

Baseline data/configuration/results remain per asset until page reload. Scenario settings/results and calibration are view-local and should be exported before navigation. Changed inputs invalidate results. Loading identical saved rules preserves a matching baseline result.

## Scope of evidence

Numerical tests cover indicator warmup/causality, scenario geometry, selection separation, protection behavior, cost accounting and malformed/nonfinite inputs. Browser tests execute the real worker and parse report/CSV downloads. Actual commands and outcomes are in [validation.md](validation.md). There is no claim of statistical significance, confidence intervals, walk-forward retraining, Monte Carlo validation, multiple-testing correction, exchange-quality historical data or demonstrated out-of-sample profitability. Shorting, funding, borrow costs, partial fills, queue position, latency and order-book liquidity are not modeled.
