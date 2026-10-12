import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveIndicators, atr } from '../src/lib/analytics';
import { backtest, DEFAULT_STRATEGY, evaluate, rsi } from '../src/lib/engine';
import { demoHistory, demoSnapshot } from '../src/lib/data';
import { calibrate, datasetFingerprint, DEFAULT_STRESS, stressCandles, stressSuite } from '../src/lib/scenarios';
import type { BacktestConfig, Candle } from '../src/types';

const candle = (i: number, price = 100, sentiment: number | null = 80): Candle => ({ time: 1779062400 + i * 300, open: price, high: price, low: price, close: price, volume: 10, sentiment });
const config: BacktestConfig = { ...DEFAULT_STRATEGY, capital: 10000, fee: 0, slippage: 0, maxRsi: 100 };

test('Wilder ATR warms up on complete ranges and includes price gaps', () => {
  const candles = Array.from({ length: 16 }, (_, i) => ({ ...candle(i), low: 99, high: 101 }));
  candles[15] = { ...candle(15, 110), high: 111, low: 109 };
  const values = atr(candles);
  assert.equal(values[13], null);
  assert.equal(values[14], 2);
  assert.equal(values[15], 37 / 14);
  assert.throws(() => atr(candles, 0), /positive integer/);
});

test('Adaptive periods lengthen and ATR bands widen under a volatility shock', () => {
  const candles = Array.from({ length: 90 }, (_, i) => ({ ...candle(i), high: i >= 70 ? 115 : 101, low: i >= 70 ? 85 : 99 }));
  const result = adaptiveIndicators(candles);
  assert.equal(result.rsi[13], null);
  assert.equal(result.rsi[14], 50);
  assert.equal(result.regimes[60], 'Balanced');
  assert.equal(result.regimes[72], 'Elevated');
  assert.ok(result.periods[72] > result.periods[60]);
  assert.ok(result.rsiPeriods[72] > result.rsiPeriods[60]);
  assert.ok(result.upper[72]! - result.lower[72]! > result.upper[60]! - result.lower[60]!);
  assert.ok(result.periods.every(n => n >= 10 && n <= 40));
  assert.ok(result.rsiPeriods.every(n => n >= 7 && n <= 28));
});

test('Adaptive indicators are causal and remain finite for flat or rising prices', () => {
  const history = demoHistory('BTC').slice(0, 180);
  const short = adaptiveIndicators(history.slice(0, 90)), long = adaptiveIndicators(history);
  for (const key of Object.keys(short) as (keyof typeof short)[]) assert.deepEqual(short[key], long[key].slice(0, 90));
  const flat = adaptiveIndicators(Array.from({ length: 90 }, (_, i) => candle(i)));
  assert.ok(flat.ema.every(n => n === 100)); assert.ok(flat.volatilityRatio.every(n => n === 1));
  assert.ok(flat.rsi.slice(14).every(n => n === 50));
  const rising = adaptiveIndicators(Array.from({ length: 90 }, (_, i) => candle(i, 100 + i)));
  assert.ok(rising.rsi.slice(14).every(n => n === 100));
});

test('Saved signal adaptation can be disabled and its method metadata agrees with RSI', () => {
  const snapshot = demoSnapshot('BTC');
  const fixed = evaluate(snapshot, { ...DEFAULT_STRATEGY, adaptive: false });
  assert.equal(fixed.rsi, rsi(snapshot.candles).at(-1));
  assert.equal(fixed.adaptive, false); assert.equal(fixed.rsiPeriod, 14);
  const adaptive = evaluate(snapshot, DEFAULT_STRATEGY);
  assert.equal(adaptive.rsi, adaptiveIndicators(snapshot.candles).rsi.at(-1));
  assert.equal(adaptive.adaptive, true);
});

test('A current ticker cannot approve a signal with stale or unfinished live candles', () => {
  const snapshot = demoSnapshot('BTC');
  snapshot.mode = 'live';
  const now = snapshot.asOf;
  const offset = now - 300 - snapshot.candles.at(-1)!.time;
  snapshot.candles = snapshot.candles.map(c => ({ ...c, time: c.time + offset }));
  assert.notEqual(evaluate(snapshot, DEFAULT_STRATEGY, now).action, 'Wait');
  snapshot.candles = snapshot.candles.map(c => ({ ...c, time: c.time - 901 }));
  assert.equal(evaluate(snapshot, DEFAULT_STRATEGY, now).action, 'Wait');
  assert.match(evaluate(snapshot, DEFAULT_STRATEGY, now).reason, /closed 5-minute/);
  snapshot.candles = snapshot.candles.map(c => ({ ...c, time: c.time + 901 + 300 }));
  assert.equal(evaluate(snapshot, DEFAULT_STRATEGY, now).action, 'Wait');
});

test('ATR stops use the previous closed bar and ignore the current bar until execution', () => {
  const candles = Array.from({ length: 35 }, (_, i) => ({ ...candle(i, 100, i === 17 ? 80 : 50), high: 101, low: 99 }));
  candles[18] = { ...candles[18], high: 110, low: 95 };
  const result = backtest(candles, { ...config, stopMode: 'atr', atrMultiplier: 2 });
  assert.equal(result.trades[0].entryTime, candles[18].time);
  assert.equal(result.trades[0].exit, 96);
  assert.equal(result.trades[0].reason, 'Stop loss');
});

test('Trailing stop updates after the close and cannot use the current high retroactively', () => {
  const candles = Array.from({ length: 35 }, (_, i) => candle(i, 100, i === 17 ? 80 : 50));
  candles[18] = { ...candles[18], high: 111, low: 99, close: 110 };
  candles[19] = { ...candles[19], open: 110, high: 110, low: 105, close: 106 };
  const result = backtest(candles, { ...config, stopMode: 'trailing', trailingPct: 5, target: 50 });
  assert.equal(result.trades[0].exitTime, candles[20].time);
  assert.equal(result.trades[0].exit, 100);
});

test('Drawdown protection exits at the next open and blocks subsequent entries', () => {
  const candles = Array.from({ length: 35 }, (_, i) => candle(i));
  candles[16] = { ...candle(16), low: 94, close: 94 };
  candles[17] = candle(17, 80);
  const result = backtest(candles, { ...config, stop: 50, target: 100, risk: 10, maxDrawdownPct: 1 });
  assert.equal(result.protectionEvents[0].time, candles[16].time);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitTime, candles[17].time);
  assert.equal(result.trades[0].exit, 80);
  assert.equal(result.trades[0].reason, 'Drawdown protection');
  assert.equal(result.halted, true);
  assert.equal(result.finalEquity, 9600);
  assert.equal(result.maxDrawdown, 4);
});

test('Daily loss guard resumes only after the next UTC day and keeps drawdown halt separate', () => {
  const candles = Array.from({ length: 35 }, (_, i) => ({ ...candle(i), time: 1779143400 + i * 300 }));
  candles[16] = { ...candles[16], low: 94, close: 94 };
  const result = backtest(candles, { ...config, stop: 50, target: 100, risk: 10, dailyLossPct: 1 });
  assert.ok(result.protectionEvents.length >= 1);
  assert.equal(result.trades[0].reason, 'Daily loss protection');
  assert.equal(result.halted, false);
  assert.ok(result.trades.length > 1);
  const firstExitDay = Math.floor(result.trades[0].exitTime / 86400);
  assert.ok(Math.floor(result.trades[1].entryTime / 86400) >= firstExitDay);
});

test('Fee totals reconcile to net P&L, flat-price slippage is measurable, and bad guards reject', () => {
  const candles = Array.from({ length: 35 }, (_, i) => candle(i, 100, i === 17 ? 80 : 50));
  const result = backtest(candles, { ...config, fee: .1, slippage: .1 });
  assert.ok(result.feesPaid > 0); assert.ok(result.slippageCost > 0);
  assert.ok(Math.abs(config.capital - result.finalEquity - result.feesPaid - result.slippageCost) < 1e-8);
  assert.equal(result.evaluatedBars, 20);
  assert.throws(() => backtest(candles, { ...config, maxDrawdownPct: -1 }), /loss limits/);
  assert.throws(() => backtest(candles, config, { startIndex: 2 }), /warmup/);
});

test('Invalid or overflowing scenario prices reject instead of returning non-finite metrics', () => {
  const candles = Array.from({ length: 35 }, (_, i) => candle(i));
  candles[18] = { ...candles[18], high: Infinity };
  assert.throws(() => backtest(candles, config), /finite positive OHLC/);
  const extreme = Array.from({ length: 35 }, (_, i) => ({ ...candle(i, 1e-300), high: 1e300 }));
  assert.throws(() => backtest(extreme, config), /indicator calculation range/);
});

test('Stress suite produces deterministic valid candles without mutating input and labels assumptions', () => {
  const candles = Array.from({ length: 100 }, (_, i) => candle(i));
  const original = structuredClone(candles);
  const crash = stressCandles(candles, 'crash', DEFAULT_STRESS);
  assert.equal(crash[54].close, 100); assert.equal(crash[55].open, 88);
  for (const c of stressCandles(demoHistory('BTC').slice(0, 100), 'volatility', DEFAULT_STRESS)) {
    assert.ok(c.low <= Math.min(c.open, c.close)); assert.ok(c.high >= Math.max(c.open, c.close));
    assert.ok(c.low > 0 && Number.isFinite(c.high));
  }
  const suite = stressSuite(candles, config);
  assert.equal(suite.length, 4);
  assert.equal(suite[0].result.returnPct, 0);
  assert.ok(suite[1].result.returnPct < 0);
  assert.ok(suite[3].result.returnPct < 0);
  assert.match(suite[3].assumption, /not an order-book model/);
  assert.deepEqual(candles, original);
  assert.deepEqual(stressSuite(candles, config), suite);
  assert.throws(() => stressSuite(candles, config, { ...DEFAULT_STRESS, crashPct: 100 }), /crash of/);
});

test('Calibration ranks training only, uses a chronological untouched holdout, and exports sample counts', () => {
  const candles = demoHistory('BTC').slice(0, 600), boundary = 420;
  const report = calibrate(candles, config);
  const changed = candles.map((c, i) => i < boundary ? c : { ...c, open: c.open * .5, high: c.high * .5, low: c.low * .5, close: c.close * .5 });
  const alteredHoldout = calibrate(changed, config);
  assert.deepEqual(report.selected.config, alteredHoldout.selected.config);
  assert.deepEqual(report.candidates, alteredHoldout.candidates);
  assert.equal(report.candidates.length, 9);
  assert.equal(report.split.trainingBars, 420); assert.equal(report.split.holdoutBars, 180);
  assert.equal(report.split.scoredTrainingBars, 405); assert.equal(report.holdout.evaluatedBars, 180);
  assert.ok(report.holdout.trades.every(t => t.entryTime >= candles[boundary].time));
  assert.equal(report.holdout.equity[0].time, candles[boundary].time);
  assert.throws(() => calibrate(candles.slice(0, 100), config), /120 candles/);
});

test('Calibration reports insufficient samples instead of implying successful optimization', () => {
  const candles = Array.from({ length: 150 }, (_, i) => candle(i, 100, null));
  const report = calibrate(candles, config);
  assert.equal(report.holdout.trades.length, 0);
  assert.equal(report.selected.eligible, false);
  assert.ok(report.warnings.some(w => w.includes('No candidate')));
  assert.ok(report.warnings.some(w => w.includes('Missing sentiment')));
  assert.equal(datasetFingerprint(candles), datasetFingerprint(structuredClone(candles)));
  assert.notEqual(datasetFingerprint(candles), datasetFingerprint(candles.slice(1)));
});
