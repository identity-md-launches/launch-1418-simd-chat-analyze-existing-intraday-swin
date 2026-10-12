import test from 'node:test';
import assert from 'node:assert/strict';
import { averageTrueRange, DEFAULT_RISK_PROFILE, evaluateProtection, isRiskAccount, isRiskProfile, protectedPosition, recordEquity, stopPrice, validateRiskProfile, type RiskProfile } from '../src/lib/risk';
import type { Candle } from '../src/types';

const now = Date.UTC(2026, 9, 12, 12) / 1000;
const armed: RiskProfile = { ...DEFAULT_RISK_PROFILE, armed: true };
const candles: Candle[] = Array.from({ length: 15 }, (_, index) => ({ time: now + index * 300, open: 100, high: 102, low: 98, close: 100, volume: 1, sentiment: 50 }));

test('Risk profile validation rejects malformed persistence and incoherent loss limits', () => {
  assert.equal(isRiskProfile(DEFAULT_RISK_PROFILE), true);
  assert.equal(isRiskProfile({ ...DEFAULT_RISK_PROFILE, armed: 'true' }), false);
  assert.equal(isRiskProfile({ ...DEFAULT_RISK_PROFILE, trailingPct: Number.NaN }), false);
  assert.match(validateRiskProfile({ ...armed, dailyLossPct: 11 })!, /at or below the maximum drawdown/);
  assert.match(validateRiskProfile({ ...armed, riskPct: 4 })!, /at or below the daily loss/);
});

test('Paper equity sets baselines, updates the peak, and computes drawdown from that peak', () => {
  const initial = recordEquity(null, 10000, armed, now);
  assert.equal(isRiskAccount(initial), true);
  assert.equal(evaluateProtection(armed, initial, now).status, 'armed');
  const peak = recordEquity(initial, 11000, armed, now + 1);
  const dip = recordEquity(peak, 10450, armed, now + 2);
  const status = evaluateProtection(armed, dip, now + 2);
  assert.equal(status.drawdownPct, 5);
  assert.equal(status.dailyLossPct, 0);
  assert.equal(status.remainingLoss, 550);
});

test('Daily loss trip latches despite recovery and resets only when current-day equity is recorded', () => {
  const initial = recordEquity(null, 10000, armed, now);
  const trip = recordEquity(initial, 9700, armed, now + 1);
  assert.equal(evaluateProtection(armed, trip, now + 1).status, 'tripped');
  const recovered = recordEquity(trip, 10000, armed, now + 2);
  assert.equal(evaluateProtection(armed, recovered, now + 2).canEnter, false);
  assert.equal(evaluateProtection(armed, recovered, now + 86400).status, 'setup');
  const newDay = recordEquity(recovered, 10000, armed, now + 86400);
  assert.equal(newDay.dailyTripped, false);
  assert.equal(evaluateProtection(armed, newDay, now + 86400).canEnter, true);
});

test('Drawdown trip persists across days and account recovery until explicit baseline reset', () => {
  const initial = recordEquity(null, 10000, armed, now);
  const trip = recordEquity(initial, 9000, armed, now + 1);
  const recovered = recordEquity(trip, 12000, armed, now + 86400);
  assert.equal(evaluateProtection(armed, recovered, now + 86400).status, 'tripped');
  const reset = recordEquity(null, 12000, armed, now + 86400);
  assert.equal(evaluateProtection(armed, reset, now + 86400).status, 'armed');
  assert.equal(evaluateProtection(armed, null, now).canEnter, false);
  assert.equal(evaluateProtection(DEFAULT_RISK_PROFILE, null, now).canEnter, true);
});

test('Depleted accounts remain measurable and invalid equity cannot establish a baseline', () => {
  assert.throws(() => recordEquity(null, 0, armed, now), /above zero/);
  assert.throws(() => recordEquity(null, Number.NaN, armed, now), /Enter paper equity/);
  const zero = recordEquity(recordEquity(null, 10000, armed, now), 0, armed, now + 1);
  assert.equal(isRiskAccount(zero), true);
  assert.equal(evaluateProtection(armed, zero, now + 1).drawdownPct, 100);
  assert.equal(evaluateProtection(armed, zero, now + 1).canEnter, false);
  assert.equal(isRiskAccount({ ...zero, peakEquity: -1 }), false);
});

test('Fixed and ATR stops honor direction, candle gaps, warmup and valid stop prices', () => {
  assert.equal(stopPrice(armed, 100, 'buy', candles), 98);
  assert.equal(stopPrice(armed, 100, 'sell', candles), 102);
  assert.equal(averageTrueRange(candles), 4);
  assert.equal(stopPrice({ ...armed, stopMode: 'atr' }, 100, 'buy', candles), 92);
  assert.equal(stopPrice({ ...armed, stopMode: 'atr' }, 100, 'sell', candles), 108);
  assert.equal(averageTrueRange(candles.slice(1)), null);
  const gap = candles.map(candle => ({ ...candle })); gap[14].high = 112; gap[14].low = 108;
  assert.ok(Math.abs(averageTrueRange(gap)! - (13 * 4 + 12) / 14) < 1e-12);
  assert.throws(() => stopPrice({ ...armed, stopMode: 'atr' }, 1, 'buy', candles), /zero or negative/);
  assert.throws(() => stopPrice({ ...armed, stopMode: 'atr' }, 100, 'buy', []), /15 valid price bars/);
});

test('Trailing stops tighten in either direction and never loosen with adverse price moves', () => {
  const profile = { ...armed, stopMode: 'trailing' as const };
  assert.equal(stopPrice(profile, 100, 'buy', [], 110), 107.8);
  assert.equal(stopPrice(profile, 100, 'buy', [], 105, 107.8), 107.8);
  assert.equal(stopPrice(profile, 100, 'sell', [], 90), 91.8);
  assert.equal(stopPrice(profile, 100, 'sell', [], 95, 91.8), 91.8);
  assert.equal(stopPrice(profile, 100, 'buy', [], 95), 98);
});

test('Position sizing respects manual equity and remaining daily loss allowance', () => {
  const initial = recordEquity(null, 10000, armed, now);
  const account = recordEquity(initial, 9750, armed, now + 1);
  const plan = protectedPosition(armed, account, 100000, 100, 95, 110, 'buy', now + 1);
  assert.equal(plan.effectiveCapital, 9750);
  assert.equal(plan.riskBudget, 50);
  assert.equal(plan.quantity, 10);
  assert.equal(plan.protectionCapped, true);
  assert.equal(plan.maxLoss, 50);
  const tripped = recordEquity(account, 9700, armed, now + 2);
  assert.throws(() => protectedPosition(armed, tripped, 10000, 100, 95, 110, 'buy', now + 2), /Daily loss limit/);
  assert.throws(() => protectedPosition(armed, null, 10000, 100, 95, 110, 'buy', now), /Enter paper account equity/);
});
