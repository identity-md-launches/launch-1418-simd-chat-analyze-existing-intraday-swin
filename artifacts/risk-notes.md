# Paper risk protection and alerts

Implementation: [risk.ts](../src/lib/risk.ts), [alerts.ts](../src/lib/alerts.ts), [Risk view](../src/pages/Risk.tsx), [AlertCenter](../src/components/AlertCenter.tsx) and the `PaperTrade` form in [App.tsx](../src/App.tsx).

## Saved profile and manual account

Paper protection starts **off**. Default profile: fixed 2% stop, ATR multiplier 2, trailing distance 2%, risk 1%, maximum drawdown 10%, daily loss 3%. The strategy's saved stop/risk can initialize the fallback profile. Controls require explicit Save; arming also requires a usable manual paper equity baseline before entries are allowed.

| Setting | Valid values |
| --- | --- |
| Fixed / trailing stop | 0.1–50% |
| ATR multiplier | 0.5–10 |
| Per-position risk | 0.1–10%, no greater than daily loss limit |
| Maximum drawdown | 0.5–50% |
| Daily loss | 0.1–20%, no greater than maximum drawdown |
| Manual equity | $0–$1,000,000,000; the first baseline must be positive |

These are paper-profile ranges. The research engine has its own allowed ranges and zero-to-disable loss limits; the two models are deliberately separate.

Manual equity is stored with peak equity, UTC day key, day-start equity, observation time and latched drawdown/daily flags. No exchange balance or journal P&L updates this account automatically. `recordEquity` raises peak equity on a new high and uses the first manually reported equity for a new UTC day as its daily baseline. A depleted account retains a positive prior baseline so losses remain measurable.

## Protection state and baselines

For equity `E`, peak `P` and daily baseline `D`:

```text
drawdownPercent = max(0, (P − E) / P × 100)
dailyLossPercent = max(0, (D − E) / D × 100)
remainingLoss = max(0, min(E − P × (1 − maxDrawdownPercent/100),
                           E − D × (1 − dailyLimitPercent/100)))
```

| State | Entry consequence |
| --- | --- |
| Off | Paper protection allows entries; it is not monitoring a real account |
| Setup required | Invalid settings, missing baseline, a prior UTC day's equity or an observation more than 60 seconds in the future blocks entries |
| Armed | Valid current-day manual equity and unbreached limits allow entries within the calculated quantity budget |
| Tripped | A breached or latched loss limit blocks entries and gives its reason |

Drawdown is checked before day freshness and remains latched even if equity later recovers or limits are raised. Daily loss stays latched for that UTC day; the next manual update on a new UTC day establishes a new daily baseline. Drawdown history persists across days. Merely crossing midnight does not authorize a new entry: manual equity must first be updated. An explicitly confirmed baseline reset starts a new paper session and clears history; it is not an automatic way to recover losses.

`evaluateProtection` recomputes percentages against the current settings, so tightening a limit can block entry even without an already latched flag. Disarming allows paper entries again but does not erase stored equity history. Browser storage can be edited or cleared; these local controls are decision aids, not an enforceable brokerage risk system.

## Stops and sizing

Fixed stops are entry minus the percentage for a long, plus the percentage for a short. The calculator's ATR stop is the **arithmetic mean of the last 14 true ranges**, requiring at least 15 valid bars, multiplied by the configured factor. This differs from the Wilder ATR used by adaptive indicators and historical research; the distinction is retained explicitly.

A trailing long uses the best observed high price times `(1−trail%)`; a short uses the best low times `(1+trail%)`. Passing a previous stop prevents a long stop from falling or a short stop from rising. The preview's observed price is entered manually. It can demonstrate tightening and trigger behavior, but does not monitor an open trade or place a stop order.

The generic size calculation is:

```text
riskBudget = effectiveCapital × effectiveRiskPercent / 100
quantity = min(riskBudget / abs(entry − stop), effectiveCapital / entry)
plannedLoss = quantity × abs(entry − stop)
potentialReward = quantity × abs(target − entry)
rewardRiskRatio = abs(target − entry) / abs(entry − stop)
```

When armed, effective capital is the smaller of planning capital and reported paper equity. Effective risk percentage is the smaller of saved risk and remaining permitted loss as a percentage of effective capital. Editing calculator capital cannot bypass the manual account cap. Long stops/targets must be below/above entry, with the reverse for a short; all prices and quantities must be finite and positive. Planned risk excludes fees, slippage, funding and liquidation, and stop gaps can exceed it.

Example of the tested calculator arithmetic, not a recommended trade: capital $10,000, risk 1%, entry $100, stop $95 and target $110 produce 20 units, $2,000 notional, $100 planned loss and $200 potential reward before costs. Successful calculation focuses the result heading and reveals it if off-screen; input edits invalidate the result without jumping focus.

## Paper submission boundary

The paper form uses the saved profile to compute its planned stop and saved strategy target. Before recording, it re-evaluates protection using the current clock and rejects a stale/paused/noncurrent live feed. Live prices must still be no more than 60 seconds old. It rechecks the armed quantity cap, confirmation checkbox and finite positive values, including the target; a 100% short target would be zero and is rejected with a route to edit the rules. At most 500 journal records persist locally.

The journal records simulated fills at the displayed price and planned stop/target. It does not reserve cash, combine risk across positions, track holdings, update equity, charge modeled trading costs, manage stops, close positions or submit orders. A Sell decision is an exit cue to review an existing long; the research engine itself is long-only. The manual short planning option does not establish exchange borrow or margin availability.

## Alert transitions

Alerts start disabled. Settings choose entry/exit cues and a 0–3,600 second cooldown (default 60). `advanceAlerts` is a pure reducer; its scope identifies the current asset, mode and saved strategy. First observation, re-enabling and a scope switch establish a baseline without emitting a historic entry/exit. Memory is bounded across strategy edits.

| Transition | Alert behavior |
| --- | --- |
| Healthy → unhealthy market | One data message says signal alerts are paused; entry/exit cues are suppressed |
| Unhealthy → healthy | A restoration message establishes the current signal as a baseline; reconnection itself does not create an entry/exit cue |
| Action changes to Buy | Entry cue only if enabled, price valid, data healthy and protection permits entry |
| Action changes to Sell | Exit cue only if enabled, price valid and data healthy; explicitly says no order is sent |
| Protection becomes blocking | Risk message explains why paper entries are paused |
| Test alert | Explicitly labeled test; not a market observation |

Cooldown applies separately to entry and exit kinds within a scope. Data and risk state-change messages are not delayed by the signal cooldown. Holding the same action does not emit tick-by-tick duplicates. Records include asset, timestamp, demo/live provenance, kind, title, detail and acknowledgement state. IDs deduplicate appended events; up to 50 records persist, latest eight are displayed, and acknowledgement/clear controls affect only this log.

The alert center runs for the selected market while the page is open. It is not a background multi-market scanner; there are no push, email, sound or desktop notifications. Tab suspension can interrupt monitoring. Source readiness and transport state still govern the underlying decision; an alert is not an execution instruction.

## Storage, verification and limitations

Profiles and accounts use validated `simd.risk.profile.v1` / `simd.risk.account.v1` records. Alert settings/log and the journal also use local storage with validation. A persistence error is shown and the current in-memory session remains usable. Shared-device local storage is not an account service or encrypted vault; no provider/trading secrets are requested by the client.

`tests/risk.test.ts`, `tests/risk-alerts.test.ts` and `tests/browser.mjs` cover stop direction, nonfinite values, risk caps, latched breaches, midnight freshness, explicit reset, trailing preview, cooldown, reconnect baselines, acknowledgement and paper submission. [validation.md](validation.md) records the actual runs. The inherited exchange [templates](../templates/README.md) remain dry-run and refuse real orders; no live execution or owner-specific credentialed integration was tested or added.
