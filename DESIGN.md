# Pulse design system

## Overview

Pulse is a personal intraday and swing crypto research workspace. Its implemented character is a restrained dark terminal with mint actions, compact numeric views, a persistent desktop navigation rail, and clearly separated research, rules, simulation, and connection tasks. The overview places the current decision, volatility regime and protection status before market selection. A price chart sits beside signal reasoning, followed by source activity and opt-in alerts. Other pages use focused forms and research results.

The source of truth is `src/styles.css`. Reusable visual components live in `src/components.tsx`; the main application shell lives in `src/App.tsx`. The product has one dark theme. No light theme, wallet flow, operating-system notifications, or marketing hero is implemented. Alerts are a persistent in-app log.

## Colors

All shared color roles are CSS custom properties in the `:root` block of `src/styles.css`. Hex sRGB is the implementation's canonical format.

| Tokens | Values | Use |
| --- | --- | --- |
| `--bg`, `--sidebar` | `#0c1017`, `#10151d` | Page and desktop rail/header-context surfaces |
| `--surface`, `--surface-raised`, `--surface-hover` | `#131922`, `#1d2632`, `#242f3d` | Panels, selected segments/neutral badges, hover surfaces |
| `--text`, `--muted` | `#ecf0f5`, `#9da9b9` | Main text and secondary text |
| `--border`, `--control-border` | `#293341`, `#657184` | Structural dividers versus visible form/control outlines |
| `--accent`, `--accent-hover`, `--accent-soft`, `--on-accent` | `#72e3bf`, `#94eed1`, `#1a342e`, `#102820` | Main actions, active navigation and action text |
| `--positive`, `--positive-soft` | `#72e3bf`, `#18382f` | Positive scores, bullish badges and chart/equity fill |
| `--negative`, `--negative-soft` | `#ee8898`, `#3a222e` | Falling prices, bearish badges and errors |
| `--warning`, `--warning-soft` | `#ebc380`, `#342d23` | Demo provenance, hold/wait decisions |
| `--focus` | `#9dcaff` | Keyboard focus perimeter |
| `--chart-line`, `--chart-vwap`, `--chart-grid`, `--indicator-band` | `#bca3f1`, `#98b8eb`, `#2b3543`, `#222335` | Adaptive EMA/RSI/MACD, separate VWAP line, grids and RSI band |
| `--adaptive-soft`, `--adaptive-text` | `#242238`, `#c9b2f7` | Adaptive-mode badges and chart metadata |
| `--volume-up`, `--volume-down` | `#25473f`, `#4a2d3b` | Low-emphasis volume overlay bars |

Source bars distinguish social with mint, news with `#98b8eb`, and on-chain with `--chart-line`. Asset marks use Bitcoin `#f6ae57`, Ethereum `#acb5f5`, Solana `#b399f4`, and BNB `#edcf62`; names remain visible so these colors carry no exclusive meaning. Exchange and profile accents are local decorative values rather than new application statuses.

Measured examples: primary text on the panel is 15.42:1; secondary text on the panel is 7.40:1; primary-button text on mint is 9.99:1; focus against the page is 11.18:1. Full measured pairs and limitations are in `artifacts/browser-results.json` and `artifacts/validation.md`. These values cover the identified opaque pairs, not every possible transparency or chart pixel.

## Typography

The local font is **Inter Variable**, loaded from `@fontsource-variable/inter/files/inter-latin-wght-normal.woff2` by `@font-face`. It supplies normal weights 100–900; the interface uses 400, 500, and 600. Body and chart text use 400, navigation and badges use 500, and headings, buttons, branding, and exchange marks use 600. The exported Latin WOFF2 is about 48 KB. Fallbacks are Inter, platform UI sans, system-ui, Apple/Segoe UI, and sans-serif. No italic face is used. `font-optical-sizing: auto` and root font smoothing are set; no raw OpenType feature tags are required.

The single six-step type scale is:

| Token | Size at 16px root | Role |
| --- | --- | --- |
| `--text-xs` | 12px | Chart axes, captions, metadata, dense desktop controls |
| `--text-sm` | 14px | Dense workspace body, navigation, form labels, feed headlines |
| `--text-base` | 16px | Section headings, mobile inputs, mobile reading prose |
| `--text-lg` | 20px | Prices, signal summaries and small display metrics |
| `--text-title` | 28px | Page title and major metrics |
| `--text-display` | 40px | Sentiment score and analysis decision |

Body line-height is 1.5; prose is 1.6; page headings 1.2; section headings 1.4. Page headings use −0.8px letter spacing; major numerals use restrained negative spacing. Headings use balanced wrapping, descriptions use pretty wrapping, and prose is capped at 75ch. There are no tracked uppercase overlines. Changing prices, scores, times, and table values use tabular numerals. Mobile input and select text is 16px to avoid iOS automatic input zoom.

Chart axes use 12px SVG text. `Chart.tsx` and `EquityChart.tsx` observe their actual container width; the SVG viewbox changes with the container instead of shrinking a fixed desktop layout and its labels. The price chart uses three evenly spaced time ticks below a 480px chart width and six at or above it. The first label is start-anchored and the last is end-anchored to the plot edge, so their actual glyph widths remain inside the plot without fixed-width clamping. The OHLC legend uses the shared two-decimal currency formatter and wraps into additional rows as needed. The candle inspector retains every candle's timestamp and exact values.

The inspector and its live announcement use a full UTC date, year and time. When the plotted range crosses midnight, time ticks use a second date line at the same 12px size. The price axis reserves a complete 16px text box and 5px clearance from the 20px close marker; a colliding tick label moves to the nearest clear side with a short leader to its original price. Grid and close-marker positions stay fixed. The equity axis right-aligns amounts 4px inside the SVG and measures its widest rendered label, reserving that width plus 14px for the gutter. Measurement repeats after font readiness, width and formatted-label changes.

## Layout

The desktop rail is 220px with a matching main-content offset. The top bar is at least 72px high. Main content uses 32px inline padding and a maximum width of 1800px. Major panels have 20px inner padding; typical group gaps are 18–22px, compared with 6–10px between related labels or icons. A three-column decision strip precedes four market cards and a `2.2fr / 1fr` overview grid. The extension uses spacing tokens `--space-1` through `--space-7`: 4, 8, 12, 16, 20, 24 and 32px. Established 18–22px panel gaps are retained. Form/result pages use `.two-column` and `.settings-grid`; the backtest uses a 260–310px parameter column and flexible results. `.stack` supplies vertically grouped panels.

Shared page headings contain a task title and actions. Explanatory text stays beside the relevant controls or inside tool panels. The sidebar retains its Built on Jev-X attribution without a tagline.

Implemented adaptation points in `src/styles.css`:

- **1280px and below:** rail 200px, main padding 24px, reduced overview gap/density and decorative market names hidden.
- **1100px and below:** rail 184px, padding 20px, compact source panels, wrapping feed badges, and exchange cards arranged as wider rows.
- **900px and below:** rail disappears; a named menu button opens a native modal navigation list. The mobile brand remains visible. The top bar is at least 64px.
- **700px and below:** main padding 16px; top bar at least 60px; the primary action takes the available row width beside Export. Market cards become two columns. The decision strip uses two columns with protection spanning both. Content grids stack; the signal panel appears before the feed. Alerts become one column. Forms keep two columns for short numeric pairs. Inputs and common action buttons are at least 44px tall.
- **460px and below:** market-card sparklines are omitted to preserve price width. The main price chart remains fully available.
- **370px and below:** long form/button groups and the chart header adapt further; decorative asset marks in the chart heading can hide.
- **1700px and above:** chart height is capped and sentiment spacing expands.

Tables scroll inside labeled, focusable regions rather than enlarging the page. Dialogs are at most 530px wide, inset at least 16px on narrow screens, and limited to viewport height with internal scrolling. No essential content is placed in hover-only UI. The observed 390px first screen contains the product name, page title, and **Analyze market** button before the market cards. All seven views were checked for page overflow at 320, 390, 768, and 1024px; the overview was also inspected at 1440px. See validation for the distinction between text enlargement and native browser zoom.

## Elevation & Depth

The system is predominantly flat. One-pixel `--border` lines distinguish panels and structural divisions; `--control-border` is reserved for interactive outlines. Selected market cards use a muted green border with a one-pixel inset shadow. The desktop rail is a slightly lighter surface at z-index 30. The skip link appears above it at z-index 100 when focused.

Native dialogs occupy the browser top layer. Their shadow is `0 15px 50px #0006, 0 2px 8px #0004`, with a `#05080dc9` backdrop and 4px backdrop blur. No ordinary card has a floating shadow or gradient background.

## Shapes

`--radius: 10px` is the panel/market-card shape. Buttons and inputs use 6px; navigation rows and callouts 7px; exchange cards 8px; dialogs 12px; badges and small control segments 4–5px. Circular shapes are reserved for asset marks, the profile mark, source status dots, and the paper-order success indicator. Line icons use the Lucide set, generally 14–22px, inheriting `currentColor`. Asset symbols are explicit SVG geometry so they do not depend on a font glyph being available.

## Components

| Component / pattern | Source and use | States and behavior |
| --- | --- | --- |
| `Panel` | `src/components.tsx`; section title, subtitle, optional action and content | Semantic section with h2; responsive heading wrap; optional `headingRef` makes the heading programmatically focusable without adding a tab stop |
| `Badge`, `Change` | `src/components.tsx`; source/data provenance and value direction | Neutral, positive, negative, warning, accent; direction uses text/arrows as well as color |
| `AssetIcon`, `SourceIcon` | `src/components.tsx`; market and source identity | Decorative geometry with adjacent visible names |
| `Gauge`, `SourceBars` | `src/components.tsx`; aggregated and individual sentiment | Nullable scores show unavailable; numeric accessible names and bullish/neutral/bearish text |
| `Feed` | `src/components.tsx`; timestamped source activity | Safe external links and source labels. `empty` distinguishes `unconnected`, `unavailable` and `filtered`; missing activity links to Connections. Clear filters appears only when active filters removed underlying items |
| `SourceStatus` | `src/components.tsx`; Sentiment and Connections source badges | Shared `sourceFreshness` with aggregation: Demo/Ready only for available fresh scores; Stale or Unavailable otherwise. Stale score context and original UTC observation timestamp/age stay visible in the surrounding views |
| `Metric`, `EmptyState` | `src/components.tsx`; compact results or an actionable absence | Text-first values, informative empty-state copy |
| `Modal` | `src/components.tsx`; analysis, search, paper trade, mobile navigation | Native `dialog.showModal()` supplies focus containment/inert background; Escape closes, cleanup restores the trigger; outside-pointer dismissal is bounded to the backdrop |
| Buttons | `src/styles.css`; `.button.primary`, `.button.secondary`, `.icon-button` | Verb labels, hover treatment for hover-capable devices, disabled/loading states, named icon-only controls, 2px focus ring with 4px offset |
| Forms | `Signals.tsx`, `Risk.tsx`, `Backtest.tsx`, `Connections.tsx` | Native labeled inputs/selects/checkboxes; submit-time validation; inline recoverable errors; status announcements; zero weight deliberately disables a source |
| `Chart` | `src/Chart.tsx`; price/indicator plotting | Interval and overlay buttons expose `aria-pressed`; pointer crosshair plus previous/next candle buttons; two-decimal visible OHLC and adaptive EMA; text equivalents include selected adaptive EMA/bands/RSI; responsive bar/tick counts |
| `Backtest` | `src/pages/Backtest.tsx`; strategy parameters, datasets, results and ledger | App-level session state per asset preserves research across navigation; loading changed signal rules invalidates results while retaining dataset, range, capital and costs; explicit imports/history loads replace data; state ends on reload. Short-lived Web Workers calculate baseline, scenarios and calibration. Parameter changes cancel active work and invalidate obsolete results. Scenario/calibration results are view-local and exported as JSON |
| Decision strip | `src/App.tsx`, `.decision-strip` | Entry/exit/wait with reason, adaptive volatility and Off/Armed/Tripped paper protection; meaningful text accompanies color |
| `AlertCenter` | `src/components/AlertCenter.tsx` | Opt-in transition monitoring; bounded log, explicit test alerts, cooldown, acknowledgement and empty state; no price-tick announcement flood |
| Protection controls | `src/pages/Risk.tsx` | Fixed/ATR/trailing profile, manual equity, latched limits; consequences and confirmation beside baseline reset. Successful calculation focuses Position estimate and reveals an off-screen panel using an instant scroll and 90px section scroll margin; input editing never triggers this result navigation |
| Stream controls | `src/pages/Connections.tsx` | Connect/pause/resume/reconnect; readable Streaming/Stale/Paused/Error status, history readiness and delay estimate |
| `EquityChart` | `src/EquityChart.tsx`; backtest equity | Container-sized axes with measured currency gutter and right-aligned full amounts, textual start/end equity, adjacent metrics and detailed trade ledger |
| Navigation shell | `src/App.tsx` | Real hash anchors with `aria-current`; route title focus; first-focusable skip link; mobile menu dialog |
| Tables | `.table-scroll`, `table` in `src/styles.css` | Native headers and numeric cells; internal overflow; empty ledger guidance and exports |

The shared header analysis action is keyed by route so a primary/secondary palette change appears immediately and does not pass through low-contrast intermediate colors. State-changing buttons otherwise transition only background color, color, and scale for 120ms when the reader permits motion. Primary presses scale to 0.96. The retained refresh/loading treatment rotates only under `prefers-reduced-motion: no-preference`. Analyze market opens the current decision immediately, independently of a background service fetch. There are no entrance animations, automatic carousels, toast queues, or notification popups. Alert records stay in a normal document list. Inline status regions report saves, imports, and connection outcomes.

## Do's and Don'ts

- Start a new tool view with the existing shell, page-heading pattern, `Panel`, and `.stack` or `.two-column` layout. Add its real hash link to the navigation and title map in `App.tsx`.
- Give one main action per view the mint fill; secondary actions use an outline. Use the named status tokens for outcome text; retain a written status, icon, or numeric sign so color is never the only cue.
- Use the six-step type scale and tabular numerals. Keep chart text at a readable container-relative size, rather than scaling down a desktop SVG.
- Keep demo, live, disconnected, stale, and partial-source states explicit. Never label a configuration template as an active exchange connection or a synthetic score as a live observation.
- Pair every new form input with a persistent label and a recoverable validation path. Check its smallest-width layout and keyboard path before declaring it complete.
- Keep API secrets and signing out of the static client. Use local assets, relative paths, and hash navigation so new views remain compatible with the committed static export.

This document describes the implemented source and observed behavior. Unperformed browser/device checks and the full six-domain review are recorded in `artifacts/validation.md`.
