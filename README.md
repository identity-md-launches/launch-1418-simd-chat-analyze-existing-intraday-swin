# Pulse — adaptive trading workspace

Pulse is a modular intraday and swing crypto research website for SIMD. It combines public WebSocket prices, volatility-adaptive indicators, configurable signals, scenario backtesting, calibration, and paper risk protection. It opens immediately in a clearly labeled synthetic demo. **The complete static website is delivered in `dist/`**, alongside React/TypeScript source and the npm lockfile.

This revision extends [the supplied Pulse repository](https://github.com/identity-md-launches/launch-1280-simd-chat-build-custom-web) at commit `8220e881d0f5809b46132c04d31d72b793a2fcfc`. The existing React/Vite interface, optional Jev-X-derived service, CSV workflows and exchange templates are retained. [Code improvements](artifacts/code-improvements.md) explains the original implementation and the changes.

## Install, develop and preview

Use Node.js 22 or newer and npm:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. To serve the delivered production export:

```sh
npm run preview
```

A dependency-free preview also works:

```sh
python3 -m http.server 4173 --directory dist
```

Open `http://localhost:4173`. Use HTTP(S); direct `file:` loading does not support the app's module and worker URLs.

## Rebuild and publish

```sh
npm run typecheck
npm test
npm run build
npm run check:budget
```

The build replaces `dist/`. Include its **entire contents**, including `assets/research.worker-*.js`, the JavaScript/CSS bundles, local font, favicon and social image, with the source and lockfile. Nothing in `dist/` depends on a build machine or a hidden runtime directory.

For SIMD delivery, the contributor publication plane takes this static export, pins it to its hosting infrastructure and assigns the public name after submission. No publishing command or infrastructure mutation was run in this assignment, and no deployment URL is fabricated. To use another static host, upload `dist/` as its document root. Vite uses `base: './'`; routes use hashes, so IPFS/gateway subpaths need no SPA rewrite. Both main bundles and the research worker were checked under `/preview/`.

All required assets are local. Demo exploration needs no external API; research runs locally using the bundled worker. Serving the complete export locally works without internet. A remotely hosted page has no offline-cache guarantee, and the research worker loads on demand. Live prices require external access to Kraken. The optional sentiment service requires its own reachable HTTP(S) deployment. A relative `og:image` is included; after choosing a public origin, deployments whose preview crawlers require absolute URLs may set the final image URL in `index.html` and rebuild.

Dependency/cache directories are ignored at every nesting level and have a zero-byte submission budget. `PATH_BUDGET.md` documents the explicit ignore and packaging budget. The final measured inventory is in [artifacts/budget.json](artifacts/budget.json); no vendored registry, dependency archive or submodule is included.

## Use the workspace

| View | Working interactions |
| --- | --- |
| Overview | Read the decision/volatility/protection strip; select BTC, ETH, SOL or BNB; change candle intervals; toggle adaptive EMA bands, VWAP, RSI, MACD and volume; inspect exact candles; analyze or review a paper entry. |
| Sentiment | Filter source activity, search headlines, inspect weights, source availability and timestamps. |
| Trading signals | Save entry/exit thresholds, RSI mode/ceiling and source weights; record/export the paper journal; configure and acknowledge in-app alerts. |
| Strategy lab | Import/export CSV; run backtests in a Web Worker; change stop methods and loss limits; compare four scenarios; run training/holdout calibration; download trades and a detailed JSON research report. |
| Risk calculator | Save fixed, ATR or trailing stop profiles; size positions; enter paper equity; arm drawdown/daily loss guards; explicitly reset baselines; manually exercise a trailing-stop preview. |
| Connections | Connect keyless Kraken streaming; pause/resume/reconnect; inspect history and message delay; optionally connect sentiment; download dry-run exchange templates. |
| Help & guide | Read the implemented methods and boundaries inside the app. |

`/` opens market search when focus is outside a form. All times are UTC. A first-focusable skip link, native dialogs, keyboard chart inspection and visible focus indicators are included.

## Live data and signal freshness

**Connect market stream** uses `wss://ws.kraken.com/v2`, subscribing to ticker and five-minute OHLC for the selected USD pair. Updates are batched to at most four UI publications per second. The public REST endpoint hydrates up to 720 closed candles; the unfinished interval is excluded. No credentials or companion service are needed for prices.

The transport validates symbols, numbers, candle geometry, timestamps and cumulative candle counters. It detects silent connections, sends application pings, retries with bounded exponential delay and jitter, and rejects callbacks from replaced connections. Pause, market switching and returning to demo dispose of the previous connection. Old prices stay visible when appropriate, with signals held; there is no synthetic fallback labeled as live.

Quotes older than 60 seconds are stale even when heartbeats arrive. Signals also require recent, completed five-minute candle history. Source observations must be available and no older than 15 minutes. Paused/reconnecting/disconnected feeds hold the decision immediately. Paper submission checks price age and account protection again at the instant of recording.

Market streaming supplies **no sentiment scores**. The optional existing FastAPI service supplies independent social/news/on-chain observations every 30 seconds while the tab is visible. Pausing the market stream does not disable that separate source service. Source timestamps are preserved when merged with newer prices. Missing enabled sources produce Wait. Provider setup, keys and schema are documented in [service/README.md](service/README.md). Social/on-chain integrations need owner configuration; this assignment does not invent credentials.

Transport design, official API links and limitations: [live integration notes](artifacts/live-notes.md).

## Research methods

Adaptive indicators compare normalized Wilder ATR(14) with a preceding 50-observation baseline. Higher relative volatility lengthens EMA/RSI smoothing and widens price bands. EMA periods range from 10–40, RSI smoothing from 7–28; fixed RSI(14) remains selectable. Chart adaptation and saved signal adaptation are separate controls. Charts recalculate at the selected interval; decisions use closed five-minute bars.

Backtests retain prior-bar signals and next-open execution, adverse slippage and fees on both sides, stop-first ordering when stop/target both touch, conservative gap fills, cash caps and final liquidation. Added fixed/ATR/trailing stops and drawdown/daily protection are simulated independently of paper guard settings. Loss-limit checks occur at bar close and queue a next-open exit, so gaps and costs can exceed a limit.

Stress tests compare the baseline with a persistent downward gap, a 24-bar volatility shock and increased slippage. These are explicit hypothetical transformations, not historical crisis claims or order-book simulation. Calibration sweeps nearby entry thresholds and stop distances on the first 70% of history, then evaluates the selected candidate once on the final 30%. Reports include all candidates, sample counts, costs, held-out baseline, warnings and a dataset fingerprint. No holdout outcome is used to select a candidate; repeatedly tuning after reading it compromises that separation.

The bundled seven-day series is synthetic. Import up to 25,000 chronological candles / 5 MiB with `time,open,high,low,close,volume,sentiment`. Scores must have been available by each candle's close. Missing scores cannot trigger entries or sentiment exits. Both CSV and computed values are checked for invalid or nonfinite results.

Exact formulas, worker cancellation and statistical limits: [analytics notes](artifacts/analytics-notes.md).

## Paper protection and alerts

Protections start **off**. Enter your own paper equity, configure limits and arm the profile. Drawdown uses recorded peak equity; daily loss uses the first manual update of the UTC day. Breaches latch. A fresh current-day equity update is required for armed entries; an explicit reset starts a new protection baseline. Quantity is capped by paper capital, per-position risk and remaining loss allowance.

The paper journal records simulated fills and planned stops. It does not manage a portfolio, update equity, reserve cash, track existing positions, submit orders or execute exits. The trailing preview is manually driven. The calculator's ATR stop uses the arithmetic mean of 14 true ranges; adaptive indicators and backtests use Wilder ATR. Stops do not guarantee fill prices.

Alerts are opt-in, for the selected market and saved strategy while the page is open. They log entry/exit transitions, feed state changes and protection interruptions; cooldowns suppress repeated cues. Reconnects, re-enabling and market/strategy switches establish a fresh baseline. Test alerts are explicitly labeled. Up to 50 alerts persist, with the latest eight displayed. There are no background, push, email or desktop notifications.

Details: [risk and alert notes](artifacts/risk-notes.md). Exchange downloads remain templates only; the inherited runner is dry-run and refuses real orders. See [templates/README.md](templates/README.md).

## Storage and session scope

Saved strategy, service URL, risk profile, manual paper equity, alert settings/log and up to 500 paper entries use local browser storage. Provider secrets are never requested or stored by the client. Storage failures are reported and current tools continue in memory. Every reload starts in demo mode; live connection is explicit.

Each asset's imported dataset, date range, configuration and baseline backtest result survive route/asset changes until reload. Changing inputs clears obsolete results; loading identical saved rules preserves them. Stress settings, stress results and calibration are local to the Strategy lab view and should be exported before leaving it. Research downloads contain provenance and assumptions. The non-cryptographic dataset fingerprint helps identify matching data; it is not a security signature.

## Validation actually performed

Fresh checks during the documentation repair on 2026-10-12:

- Production build and TypeScript typecheck passed; all **60 numerical/transport/state tests passed**.
- **22 browser interaction groups passed**, including risk breaches, midnight submission checks, worker computations, downloads, filters, persistence and held-feed behavior. The suite completed **15 automated accessibility audits** without reported violations.
- All seven views reflowed without page overflow at 320, 390, 768 and 1024px. Desktop and mobile screenshots were inspected; the product and **Analyze market** action appear on the first 390px screen.
- **Nine real-network checks passed** against Kraken, including 720 closed candles, BTC→ETH switching and pause/resume, with no recorded console errors or failed requests.
- Two existing regression suites **did not pass** in the installed Chromium: a time label exceeded its plot-edge tolerance by 0.15px, and an equity label exceeded its right-padding tolerance by about 0.12px. Both remained within their SVGs. The review suite completed three groups and one additional accessibility audit before its failure. Later groups were not reached; this repair does not repeat the previous README's unsupported all-pass claims. Exact measurements and limits are in [validation.md](artifacts/validation.md).

The worker installed the unchanged lockfile in a disposable `test/scratch/workspace/` copy. Its fresh build was byte-identical to all seven delivered `dist/` files, so the accepted source and export were preserved. The provided browser tool separately inspected the root export, exercised analysis and Escape/focus return, and reported no console errors. Tests own bounded foreground previews; no publishing command was run.

The missing-document finding reproduced for all eight reported links. The six required documents/inventory are now ordinary files in `artifacts/`, and an explicit, budgeted `.gitignore` inclusion overrides the machine-local exclusion that hid them. The unavailable historical before-evidence link has been removed. [Documentation checks](artifacts/documentation-check.json) record file/link existence, Git inclusion and unchanged application hashes.

To repeat local browser checks:

```sh
npx playwright install chromium
npm run check:browser
npm run check:regression
npm run check:review
npm run check:live
```

The last command contacts the public network; the other three checks use explicit live transport fixtures where needed. Set `PULSE_CHROMIUM` to an installed Chromium executable instead of downloading one. Scripts own and close their preview servers and browser sessions. Reviewer disposition is in [.imd-responses.json](.imd-responses.json). Fresh machine-readable results: [primary interactions](artifacts/browser-results.json), [regression failure](artifacts/revision-results.json), [review partial run](artifacts/review-results.json), and [real-network walkthrough](artifacts/live-browser-report.json).

The six-domain Better Interface coverage, documentation fix, commands, measured contrast, screenshots and remaining limitations are in [artifacts/validation.md](artifacts/validation.md). These are worker observations, not independent certification. Screen-reader, physical-device, Safari/Firefox and native browser zoom checks were not performed. 200% CSS text enlargement was checked separately. Paid sentiment integrations, real orders, SIMD pinning and the inherited Python service test suite were not exercised in this documentation revision.

## Repository map

- `src/`: modular React views, chart components, stream client, risk/alert reducers and research engine/worker.
- `dist/`: complete publishable production export.
- `public/`: local favicon and share image.
- `service/`, `templates/`: retained optional source service and dry-run integration materials.
- `tests/`: numerical, state, simulated transport, browser and real-network checks.
- `scripts/`: local preview harness, social-card generation and submission budget inventory.
- `artifacts/`: improvement notes, actual validation evidence, screenshots and byte inventory.
- `DESIGN.md`: implemented tokens, typography, reusable components and responsive behavior.
- `THIRD_PARTY_NOTICES.md`, `licenses/`: preserved attribution and dependency/design guidance notices.
