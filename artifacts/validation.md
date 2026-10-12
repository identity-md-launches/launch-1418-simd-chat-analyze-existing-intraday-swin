# Validation and Better Interface review

Date: 2026-10-12. Scope: restore the missing detailed documentation and make it part of the ordinary submission. The accepted application behavior, source, lockfile and static export are unchanged. This is the worker's evidence, not independent certification.

## Reproduction and repair

Finding `0ccb014d2821065607918e3ae26b999699b32fbbe7cf38792924a2e199f4969a` reproduced before editing. `pathlib.Path.exists()` returned false for all eight README targets: `code-improvements.md`, `live-notes.md`, `analytics-notes.md`, `risk-notes.md`, `validation.md`, `budget.json`, `review-before.json` and `review-results.json` under `artifacts/`. The directory itself was absent and `git ls-files artifacts` was empty.

`git check-ignore -v` identified a machine-local `artifacts/` exclusion. Merely creating the files would leave them ignored again. The repair adds `.gitignore:24`–28 inclusions for the top-level artifact directory, Markdown/JSON/PNG evidence and the required root response file; the latter was also locally excluded. [PATH_BUDGET.md](../PATH_BUDGET.md) explicitly budgets those paths: 3 MiB for artifacts, 8 KiB for the response and 1 KiB for `.gitignore`, within the total 8 MiB limit. Git internals were not changed. All nested dependency/cache exclusions remain active.

The four method documents were reconstructed from actual source, with commit-pinned upstream comparison and exact calculations/limits. This file records fresh verification. [budget.json](budget.json) inventories every deliverable, including the repaired documentation. [documentation-check.json](documentation-check.json) records required-file existence, relative documentation links, ordinary-file status, Git visibility and unchanged application hashes. The historical `review-before.json` is unavailable; its link was removed. The included `review-results.json` is a new run with its actual partial/failing outcome, not recreated historical evidence.

## Environment and commands

Node v24.21.0, npm 11.19.0, Google Chrome for Testing 155.0.8059.12, Python 3.12.3. The existing lockfile installed Vite 6.4.4. The root source/configuration, `public/`, scripts and existing tests were copied into disposable `test/scratch/workspace/`. Dependencies and npm cache were confined to scratch and `/tmp`, never the protected root dependency path or submission. No test/source changes were made to the original suites.

The following commands ran in that disposable copy. For browser commands, `PULSE_CHROMIUM=/root/.cache/ms-playwright/chromium-1247/chrome-linux64/chrome` selected the installed executable. Full command outputs and exit codes are in [check-results.json](check-results.json).

| Command | Actual result |
| --- | --- |
| `npm ci --cache /tmp/pulse-docs-npm-cache --no-audit --no-fund` | Exit 0; unchanged lockfile installed |
| `npm run typecheck` | Exit 0; `tsc --noEmit` |
| `npm test` | Exit 0; 60 passed, 0 failed, skipped or cancelled |
| `npm run build` | Exit 0; TypeScript plus Vite production export |
| `npm run check:browser` | Exit 0; 22 interaction groups, 15 axe audits, no reported violations, no unexpected console/resource errors |
| `npm run check:regression` | Exit 1; stopped in the first chart-axis matrix on the bound described below; subsequent groups not reached |
| `npm run check:review` | Exit 1; three groups and one axe audit completed; stopped at the first equity-axis boundary assertion; subsequent groups not reached |
| `npm run check:live` | Exit 0; nine real-network checks, 720 closed candles, no recorded console errors or failed requests |

All seven built files were byte-compared with root `dist/`, including the research worker, JavaScript/CSS bundles, local font, favicon, share image and HTML. They were identical, so no export replacement was needed. SHA-256 comparison against the initial workspace also confirms unchanged `src/`, `public/`, `dist/`, source HTML, frontend configuration, package manifest and lockfile. The complete export is 535,895 bytes; [budget.json](budget.json) records its file-by-file inventory.

Production previews used the existing bounded foreground harness at `/preview/`; scripts close their browser/server in `finally`. The supplied browser tool separately opened the **root** export at 1280×720, inspected the screenshot, opened Analyze market, closed it with Escape and confirmed focus returned to the button with a 2px focus outline. It reported zero console messages. The expected tool-managed preview manifest was absent, so a bounded Node invocation used `scripts/preview.mjs`; no publishing command or detached daemon was used.

The final root checks run `python3 scripts/check_budget.py` (equivalent to `npm run check:budget`, without needing root dependencies), follow relative Markdown links, compare source/export hashes and enumerate `git ls-files --cached --others --exclude-standard`. Required artifacts must appear in that Git-visible set; a file's existence alone is insufficient. The budget script's compressed archive is written only in `/tmp` and includes the final artifact files. No files under `test/scratch/` are required for rebuild or delivery.

## Primary interaction coverage

[browser-results.json](browser-results.json) records snapshot export/provenance; analysis dialog and focus return; interval/RSI/MACD/keyboard candle controls; market search; sentiment filters and empty recovery; invalid/saved/persisted rules; paper confirmation/journal persistence; invalid risk stops and position sizing; ATR stop guidance; CSV import rejection/acceptance and trade exports; dry-run template download; source connection error/recovery; worker stress/calibration and JSON export; result invalidation; alert testing/acknowledgement/persistence; latched protections/reset/trailing preview; midnight/invalid-short-target submission rejection; WebSocket fixture updates and paused signals; mobile navigation; skip link/focus containment; reduced motion and contrast.

All seven routes were checked for page overflow at widths 320, 390, 768 and 1024. The overview was also checked at 1440×1100. The primary suite recorded 30 overflow checks, including 200% **CSS text enlargement**, which is distinct from native browser zoom. The 390×844 first-screen screenshot visibly contains the Pulse name, product description and Analyze market action.

[live-browser-report.json](live-browser-report.json) separately records public Kraken connection, REST history in the browser, pause/resume, price-only signal withholding, BTC→ETH replacement and return to demo. Other transport/source interactions use explicit fixtures; their success does not establish real sentiment-provider availability. The live run is one observation, not a provider uptime or latency benchmark.

## Existing strict-geometry failures

Both failures were measured again without changing application code or weakening the original tests. [geometry-diagnostics.json](geometry-diagnostics.json) and its two screenshots record the bounds; every measured label remains inside its SVG, with no observed clipping in those screenshots.

| Location | Measurement, consequence and disposition |
| --- | --- |
| `tests/revision-browser.mjs:58`; `src/Chart.tsx:229` | At viewport 768px / 1h, the final date/time label ends at SVG x=340.390625 while plot width is 340.140625. The test permits 0.1px overhang, so the 0.25px glyph overhang exceeds its tolerance by 0.15px. SVG width is 416.140625; the glyph fits in its reserved gutter. No page overflow was measured. Preserve the accepted chart; report the failed suite rather than claim all seven groups passed. |
| `tests/review-browser.mjs:120`; `src/EquityChart.tsx:52` | At viewport 320px / $1,000 capital, the `$1,024` label ends at x=242.21875 in a 246px-wide SVG. It has 3.78125px right clearance, below the test's 3.9px minimum by 0.11875px. The full label is visible. Preserve the accepted rendering and the test; report that later review groups were not executed. |

The review's first three completed groups covered price-marker separation/leader lines across four intervals and seven widths, dated multi-day candle inspection in a non-UTC browser timezone, and risk-result reveal/focus without disrupting edits or invalid submissions. The root [DESIGN.md](../DESIGN.md) now distinguishes edge anchoring from the observed subpixel glyph overhang. No claim is made that all typography/equity regression cases passed on this machine.

## Better Interface: six-domain review

The pinned workflow, all six core-principle sections and the design-documentation section were read. The retained design guidance notices are in [licenses/](../licenses/). Review stayed within the documentation repair and observed affected states; it did not redesign the accepted product. Single dark theme, English, synthetic default and manual paper trading remain deliberate boundaries.

| Domain | Coverage and evidence | Limits |
| --- | --- | --- |
| Accessibility — Checked | Native form/control semantics, named icon actions, modal/skip-link focus paths, errors and result announcements reviewed in `src/components.tsx:288`, `src/styles.css:64` and risk forms. Primary suite passed 15 axe scans plus one completed review scan. Keyboard analysis/Escape/focus return and visible focus were also inspected on root export and mobile risk result. | No screen-reader session, physical touch-device test or exhaustive keyboard walk of every possible state. Automated scans are not full compliance certification. |
| Layout — Checked | `src/styles.css:410` onward contains the responsive structure; seven routes have zero measured page overflow at four widths. Viewed 390px first screen, 1440px overview, focused risk result and chart diagnostic screenshots. Main action stays above the fold. | Native 200% zoom unperformed; CSS text enlargement tested separately. RTL/pseudo-localization are not implemented variants and were not reviewed. |
| Writing — Checked | Restored detailed documents link to code and explain data provenance, costs, stop semantics, timing, holdouts and recovery. Reviewed source/UI labels, synthetic/live/paper distinctions and empty/error actions. Broken README links and unsupported historical pass summaries repaired. | Documentation cannot authenticate imported sentiment provenance or owner-specific provider methods. Those limits are explicit. |
| Typography — Checked with limitations | Six tokens, local Inter WOFF2 and 400/500/600 weights retained in `src/styles.css:1`; font load checked in browser. Tabular numbers, UTC labels, wrapped OHLC legend and readable mobile fields inspected. | Two strict subpixel chart-boundary tests fail as above; later typography/regression groups not reached. No alternate-browser font-rendering certification. |
| Colors — Checked | Existing semantic palette retained. Nine opaque token pairs measured from browser-computed root properties; actual foreground/surface use checked against CSS and screenshots. Focus/primary-action states visibly inspected; see measured table below. | Alpha layers, every chart pixel, every hover background and operating-system forced-color rendering were not exhaustively measured. Light theme is not applicable. |
| UI — Checked | Analysis dialog, form save/error, filter/empty state, worker results, transport pause, alerts and protection states exercised. `src/styles.css:386` gates hover and motion; reduced-motion removes button transitions. Shared component styles and existing `DESIGN.md` were preserved. | Animation-panel playback at 10% speed unperformed; not every permutation of loading/error state was visually inspected. No new notification system or theme was invented for the review. |

### Findings and fixes within this revision

| Severity / source | Evidence | Correction and recheck |
| --- | --- | --- |
| High — `README.md:5` and artifact links at lines 45/71/83/93/127 | All six detailed document/inventory targets and two evidence targets were absent. Local ignore rules would omit recreated artifacts. | Restore substantive files; include them through budgeted repository ignore exceptions; check every required target and Git-visible path. Remove the unavailable historical before-evidence link. |
| Medium — `README.md:101` validation summary | Historical all-pass statements lacked delivered evidence; two fresh legacy suites fail subpixel bounds. | Replace with actual outcomes, preserve raw passing/failing reports and disclose unreached groups. |
| Low — `DESIGN.md` chart typography paragraph | End anchoring does not strictly contain every glyph within the plot under the current browser measurement. | Describe actual anchoring and recorded overhang without altering accepted source or test tolerances. |

These are grouped causes, not repeated per-link findings. The reviewer disposition is in [.imd-responses.json](../.imd-responses.json).

### Measured opaque contrast pairs

Measurements use sRGB relative luminance and WCAG contrast ratios; the foreground/background hex pairs and raw outcomes are in [browser-results.json](browser-results.json). Thresholds are 4.5:1 for checked text pairs and 3:1 for checked focus/control boundaries. These are explicit pairs, not a whole-site contrast certification.

| Pair | Ratio |
| --- | --- |
| Main text `#ecf0f5` / panel `#131922` | 15.42:1 |
| Secondary text `#9da9b9` / panel `#131922` | 7.40:1 |
| Primary text `#102820` / mint `#72e3bf` | 9.99:1 |
| Positive `#72e3bf` / `#18382f` | 8.18:1 |
| Negative `#ee8898` / `#3a222e` | 5.95:1 |
| Warning `#ebc380` / `#342d23` | 8.18:1 |
| Focus `#9dcaff` / page `#0c1017` | 11.18:1 |
| Focus `#9dcaff` / panel `#131922` | 10.36:1 |
| Control border `#657184` / field `#0c1017` | 3.85:1 |

### Screenshots inspected in this repair

- [390px first screen](first-screen-mobile.png): product, description and main action visible.
- [1440px overview](overview-desktop.png): decision strip, market/chart/signal grouping, source feed and alert center.
- [Mobile risk result](risk-result-mobile.png): focused Position estimate and complete quantity/risk amounts.
- [Root export focus](root-export-focus.png): 1280px tool-rendered export and visible primary-action focus ring.
- [Time-axis diagnostic](diagnostic-time-axis.png) and [equity-axis diagnostic](diagnostic-equity-axis.png): complete visible labels for the two strict-boundary failures.

Additional screenshots captured by the primary/review scripts are included as supporting evidence. A saved screenshot alone is not a claim that every depicted state received separate visual review.

## Completion and remaining limitations

**Complete for the stated documentation-repair scope.** Required method documents, fresh validation evidence, response JSON and byte inventory are included, links are repaired, and the application/export are unchanged. Production build, typecheck and useful primary interactions pass. The two pre-existing strict-geometry suite failures remain explicitly reported; this is not an all-tests-pass verdict.

Screen-reader, physical-device, Safari/Firefox/WebKit, native zoom and paid sentiment integrations were not exercised. Neither the Python service suite nor real trade execution was rerun. SIMD pinning/publication occurs after submission and was not attempted. Offline demo assets are locally bundled, but no offline service-worker cache guarantee is made. The source/service/template boundaries and research limitations are detailed in the linked method documents.
