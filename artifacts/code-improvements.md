# Implemented code improvements

This document describes the delivered Pulse implementation, not a proposed rewrite. The documentation-only repair restores material omitted from the previous submission. It changes no application source, runtime assets, package versions or lockfile.

## Baseline examined

The supplied repository is [launch-1280-simd-chat-build-custom-web](https://github.com/identity-md-launches/launch-1280-simd-chat-build-custom-web), at the baseline recorded in the existing README: [`8220e881d0f5809b46132c04d31d72b793a2fcfc`](https://github.com/identity-md-launches/launch-1280-simd-chat-build-custom-web/tree/8220e881d0f5809b46132c04d31d72b793a2fcfc). During this repair, its README, `src/App.tsx`, `src/lib/engine.ts`, `src/pages/Backtest.tsx`, `src/pages/Risk.tsx`, `src/pages/Connections.tsx`, `package.json` and `vite.config.ts` were retrieved from the commit-pinned raw URLs and read alongside the delivered files. No upstream code was installed or executed. The fetched file hashes are retained in [upstream-files.json](upstream-files.json).

That baseline already had React, TypeScript, Vite, hash navigation, locally bundled assets, deterministic demo data, seven views, accessible native controls, CSV import/export, per-asset research session retention, a long-only backtest and paper order journal. Its optional Python service used FastAPI, CCXT and SQLite, with Jev-X-derived sentiment preprocessing and optional provider credentials. Those features are inherited; this task did not originate them.

The baseline's `App.tsx` polled the companion service every 30 seconds while the page was visible. Market prices depended on that service along with sentiment. `engine.ts` used fixed RSI(14), session VWAP and MACD(12,26,9). The backtest ran synchronously in the view with fixed percentage stops. It already included prior-bar decisions, next-open fills, costs, cash caps, stop-first ordering and final liquidation. The original calculator sized positions from capital and a chosen stop and offered a 2× mean-true-range stop suggestion, but had no persistent account protection profile or latched loss guards. The original interface had no in-app alert log.

## Change map

| Area | Implemented change and purpose | Main code and evidence |
| --- | --- | --- |
| Market transport | Direct keyless Kraken WebSocket ticker/OHLC subscriptions remove the 30-second service polling path for prices. Normal updates coalesce over 250 ms; exceptional state transitions publish immediately. | [live.ts](../src/lib/live.ts), [Connections.tsx](../src/pages/Connections.tsx); `tests/live.test.ts`, `tests/live-browser.mjs` |
| Recovery and data integrity | REST hydrates closed history; socket observations win races with older REST replies. Generation checks isolate replaced connections. Heartbeat and quote freshness are distinct; pause, retry exhaustion and subscription errors are explicit. Malformed/out-of-order observations are rejected. | [Live integration methods](live-notes.md); deterministic injected socket, timer, clock and fetch tests |
| Independent sentiment | Streamed prices are merged with same-asset live source observations without copying demo scores or refreshing their timestamps. An absent enabled source withholds the decision. One freshness helper serves aggregation and status badges. | `mergeMarketSnapshot`, `sourceFreshness`, `aggregateSentiment`; [App.tsx](../src/App.tsx), [components.tsx](../src/components.tsx) |
| Adaptive indicators | Wilder ATR relative to the preceding normalized-volatility baseline drives bounded EMA and RSI periods and ATR bands. Fixed RSI remains selectable. Earlier outputs do not use later candles. | [analytics.ts](../src/lib/analytics.ts), [Chart.tsx](../src/Chart.tsx); `tests/analytics.test.ts` |
| Research engine | Fixed, ATR and trailing stops plus independent daily/drawdown guards extend the retained execution model. Reports add fees, slippage, profit factor, exposure and protection events. | [engine.ts](../src/lib/engine.ts); [analytics methods](analytics-notes.md) |
| Scenarios | Baseline, persistent downward gap, temporary volatility shock and increased slippage are calculated with explicit, exportable assumptions. | [scenarios.ts](../src/lib/scenarios.ts); scenario geometry and invalid-input tests |
| Calibration | Up to nine nearby parameter candidates are ranked on the first 70% of history. The chosen candidate and unchanged baseline are evaluated on the final 30%; training and holdout evidence remain separate. | `calibrate`; all candidate metrics, trade counts, selection objective and warnings in the JSON report |
| Responsiveness during research | Short-lived module workers compute baseline, stress and calibration. Navigation/input changes terminate work, and matching request keys prevent obsolete results from replacing current research. | [research.worker.ts](../src/lib/research.worker.ts), [Backtest.tsx](../src/pages/Backtest.tsx); browser worker/export interactions |
| Paper risk | Saved fixed/ATR/trailing profiles, manually supplied equity, UTC daily baselines and latched protection states constrain eligible paper entries and quantity. Submission rechecks current time and price age. | [risk.ts](../src/lib/risk.ts), [Risk.tsx](../src/pages/Risk.tsx), `PaperTrade` in `App.tsx`; [risk methods](risk-notes.md) |
| Decision support | A decision/volatility/protection strip, entry/exit transition alerts, written hold reasons, explicit provenance and recoverable empty states support rapid review. | [AlertCenter.tsx](../src/components/AlertCenter.tsx), [alerts.ts](../src/lib/alerts.ts), overview and Connections |
| Accepted interface refinements | Risk results receive focus after a valid calculation. Currency axes reserve measured width; candle inspection includes the UTC date/year; close-marker collisions move labels with leaders. Source statuses use the same freshness rule as decisions. | `Panel.headingRef`, `EquityChart`, `Chart`, `SourceStatus`; `tests/review-browser.mjs` |

The transport architecture provides more frequent opportunities to update prices than 30-second polling. No controlled latency, throughput or trading-performance benchmark is claimed. The displayed message delay includes exchange timing and local clock skew; it is not a round-trip measurement.

## Module and state boundaries

`App.tsx` owns navigation, selected asset, demo/live mode, saved strategy, manual paper account and per-asset baseline research sessions. `live.ts` owns the selected asset's market connection and lifecycle. The optional source request continues separately. Pure modules implement numerical methods (`engine.ts`, `analytics.ts`, `scenarios.ts`), paper risk (`risk.ts`), alert transitions (`alerts.ts`) and snapshot validation (`validation.ts`). Views expose these methods using shared components and the existing CSS tokens. The worker imports the same research functions tested by the numerical suite.

Local storage holds validated strategy/risk settings, manual equity, alerts and paper journal entries. Storage errors leave an in-memory session and an explanatory message. Historical imports/configuration/baseline results survive navigation and asset switching only until reload. Stress and calibration results are local to Strategy lab; export them before leaving it. Connections always start in demo mode on a new page load.

## Delivery and integration boundaries

The unchanged source builds to the complete [dist/](../dist/) export with `base: './'`, hash routes, a separate worker bundle and local font/favicon/share image. It can be pinned and served by SIMD without rebuilding or a route-rewriting server. The contributor publication plane performs hosting after submission; no swarm deployment, pin or public URL was created during this repair.

The optional [service](../service/README.md) and [dry-run exchange templates](../templates/README.md) remain separate from static hosting. The client does not hold provider/exchange keys. Market streaming alone does not supply sentiment. The journal does not manage a portfolio or send orders, and protection calculations do not place exchange stops.

## Documentation repair and verification

The reported eight missing README targets were reproduced before editing. `git check-ignore -v` identified a machine-local `artifacts/` exclusion. The repository ignore file now explicitly includes top-level artifact Markdown/JSON/PNG files within [PATH_BUDGET.md](../PATH_BUDGET.md), while dependencies and caches remain excluded. Git internals were left untouched. The unavailable historical before-evidence link was removed rather than fabricating a prior screenshot or result.

The restored [live](live-notes.md), [analytics](analytics-notes.md), [risk](risk-notes.md) and [validation](validation.md) documents describe actual code. Fresh evidence and the [byte inventory](budget.json) accompany them. The validation record distinguishes passing checks, a narrow existing chart-boundary assertion failure, and unperformed checks. Application source and the delivered export were hash-compared with the initial working tree; a fresh production build was also byte-compared with every delivered export file.
