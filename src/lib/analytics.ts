import type { Candle } from '../types';

export type VolatilityRegime = 'Quiet' | 'Balanced' | 'Elevated';
export type AdaptiveIndicators = {
  ema: number[];
  rsi: (number | null)[];
  atr: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
  periods: number[];
  rsiPeriods: number[];
  volatilityRatio: number[];
  regimes: VolatilityRegime[];
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Wilder ATR. The first valid value uses 14 complete close-to-close true ranges. */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) throw new Error('ATR period must be a positive integer.');
  let average = 0;
  return candles.map((c, i) => {
    if (!i) return null;
    const range = Math.max(
      c.high - c.low,
      Math.abs(c.high - candles[i - 1].close),
      Math.abs(c.low - candles[i - 1].close),
    );
    if (i <= period) {
      average += range;
      if (i === period) average /= period;
    } else average = (average * (period - 1) + range) / period;
    return i < period ? null : average;
  });
}

/** Causal volatility adaptation; appending candles never changes an earlier output. */
export function adaptiveIndicators(candles: Candle[]): AdaptiveIndicators {
  const ranges = atr(candles);
  const out: AdaptiveIndicators = {
    ema: [],
    rsi: [],
    atr: ranges,
    upper: [],
    lower: [],
    periods: [],
    rsiPeriods: [],
    volatilityRatio: [],
    regimes: [],
  };
  const history: number[] = [];
  let historySum = 0,
    gain = 0,
    loss = 0;
  candles.forEach((c, i) => {
    const range = ranges[i];
    const normalized = range === null ? null : range / c.close;
    const baseline = history.length ? historySum / history.length : normalized;
    const ratio = normalized === null || !baseline ? 1 : clamp(normalized / baseline, 0.5, 2.5);
    const period = Math.round(clamp(20 * ratio, 10, 40));
    const rsiPeriod = Math.round(clamp(14 * ratio, 7, 28));
    const average = i ? c.close * (2 / (period + 1)) + out.ema[i - 1] * (1 - 2 / (period + 1)) : c.close;
    if (i > 0) {
      const delta = c.close - candles[i - 1].close;
      if (i <= 14) {
        gain += Math.max(0, delta) / 14;
        loss += Math.max(0, -delta) / 14;
      } else {
        gain += (Math.max(0, delta) - gain) / rsiPeriod;
        loss += (Math.max(0, -delta) - loss) / rsiPeriod;
      }
    }
    const width = range === null ? null : 2 * range * Math.sqrt(ratio);
    out.ema.push(average);
    out.rsi.push(i < 14 ? null : !gain && !loss ? 50 : !loss ? 100 : 100 - 100 / (1 + gain / loss));
    out.upper.push(width === null ? null : average + width);
    out.lower.push(width === null ? null : Math.max(0, average - width));
    out.periods.push(period);
    out.rsiPeriods.push(rsiPeriod);
    out.volatilityRatio.push(ratio);
    out.regimes.push(ratio > 1.25 ? 'Elevated' : ratio < 0.8 ? 'Quiet' : 'Balanced');
    // Current volatility enters the baseline only after this bar's outputs are computed.
    if (normalized !== null) {
      history.push(normalized);
      historySum += normalized;
      if (history.length > 50) historySum -= history.shift()!;
    }
  });
  return out;
}
