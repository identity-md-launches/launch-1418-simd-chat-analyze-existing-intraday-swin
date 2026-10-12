import type { BacktestConfig, BacktestResult, Candle } from '../types';
import { backtest } from './engine';

export type StressSettings = { crashPct: number; volatilityMultiplier: number; extraSlippage: number };
export const DEFAULT_STRESS: StressSettings = {
  crashPct: 12,
  volatilityMultiplier: 2.5,
  extraSlippage: 0.75,
};
export type ScenarioResult = {
  id: string;
  name: string;
  assumption: string;
  result: BacktestResult;
  config: BacktestConfig;
};
export type CalibrationMetrics = Pick<
  BacktestResult,
  | 'returnPct'
  | 'maxDrawdown'
  | 'winRate'
  | 'profitFactor'
  | 'finalEquity'
  | 'feesPaid'
  | 'slippageCost'
  | 'evaluatedBars'
> & { trades: number; score: number };
export type CalibrationCandidate = {
  config: BacktestConfig;
  training: CalibrationMetrics;
  eligible: boolean;
};
export type CalibrationReport = {
  split: {
    trainingBars: number;
    holdoutBars: number;
    trainingStart: number;
    trainingEnd: number;
    holdoutStart: number;
    holdoutEnd: number;
    scoredTrainingBars: number;
  };
  candidates: CalibrationCandidate[];
  selected: CalibrationCandidate;
  holdout: BacktestResult;
  baselineHoldout: BacktestResult;
  minimumTrades: number;
  warnings: string[];
  objective: string;
};

export function stressCandles(
  candles: Candle[],
  kind: 'crash' | 'volatility',
  settings: StressSettings,
): Candle[] {
  const event = Math.max(16, Math.floor(candles.length * 0.55));
  if (kind === 'crash')
    return candles.map((c, i) => {
      const multiplier = i >= event ? 1 - settings.crashPct / 100 : 1;
      return {
        ...c,
        open: c.open * multiplier,
        high: c.high * multiplier,
        low: c.low * multiplier,
        close: c.close * multiplier,
      };
    });
  const out: Candle[] = [];
  candles.forEach((c, i) => {
    if (i < event) {
      out.push({ ...c });
      return;
    }
    const factor = i < event + 24 ? settings.volatilityMultiplier : 1;
    const open = out[i - 1].close * Math.exp(Math.log(c.open / candles[i - 1].close) * factor);
    const close = open * Math.exp(Math.log(c.close / c.open) * factor);
    const high = Math.max(open, close, open * Math.exp(Math.log(c.high / c.open) * factor));
    const low = Math.min(open, close, open * Math.exp(Math.log(c.low / c.open) * factor));
    out.push({ ...c, open, high, low, close });
  });
  return out;
}

export function stressSuite(
  candles: Candle[],
  config: BacktestConfig,
  settings = DEFAULT_STRESS,
): ScenarioResult[] {
  if (
    !Number.isFinite(settings.crashPct) ||
    settings.crashPct < 1 ||
    settings.crashPct > 50 ||
    !Number.isFinite(settings.volatilityMultiplier) ||
    settings.volatilityMultiplier < 1 ||
    settings.volatilityMultiplier > 5 ||
    !Number.isFinite(settings.extraSlippage) ||
    settings.extraSlippage < 0 ||
    settings.extraSlippage > 4
  )
    throw new Error('Use a crash of 1–50%, volatility of 1–5×, and extra slippage of 0–4%.');
  const liquidity = { ...config, slippage: Math.min(5, config.slippage + settings.extraSlippage) };
  return [
    {
      id: 'baseline',
      name: 'Baseline',
      assumption: 'Original candles and configured costs.',
      config,
      result: backtest(candles, config),
    },
    {
      id: 'crash',
      name: 'Gap down',
      assumption: `${settings.crashPct}% downward gap at 55% of the dataset; lower price level persists.`,
      config,
      result: backtest(stressCandles(candles, 'crash', settings), config),
    },
    {
      id: 'volatility',
      name: 'Volatility shock',
      assumption: `${settings.volatilityMultiplier}× log returns and wicks for 24 bars, starting at 55% of the dataset.`,
      config,
      result: backtest(stressCandles(candles, 'volatility', settings), config),
    },
    {
      id: 'liquidity',
      name: 'Liquidity squeeze',
      assumption: `${liquidity.slippage.toFixed(2)}% adverse slippage per side across the full dataset. A cost proxy, not an order-book model.`,
      config: liquidity,
      result: backtest(candles, liquidity),
    },
  ];
}

function metrics(result: BacktestResult): CalibrationMetrics {
  return {
    returnPct: result.returnPct,
    maxDrawdown: result.maxDrawdown,
    winRate: result.winRate,
    profitFactor: result.profitFactor,
    finalEquity: result.finalEquity,
    feesPaid: result.feesPaid,
    slippageCost: result.slippageCost,
    evaluatedBars: result.evaluatedBars,
    trades: result.trades.length,
    score: result.returnPct - result.maxDrawdown,
  };
}

/** Select on training only. Holdout prices are never read when ranking candidates. */
export function calibrate(candles: Candle[], config: BacktestConfig): CalibrationReport {
  if (candles.length < 120)
    throw new Error('Use at least 120 candles for a 70/30 training and holdout split.');
  const boundary = Math.floor(candles.length * 0.7),
    training = candles.slice(0, boundary),
    minimumTrades = 3;
  const candidates: CalibrationCandidate[] = [];
  const seen = new Set<string>();
  for (const buyOffset of [-5, 0, 5]) {
    for (const stopMultiplier of [0.75, 1, 1.25]) {
      const buy = Math.min(100, Math.max(config.sell + 1, config.buy + buyOffset));
      const adjusted: BacktestConfig = { ...config, buy };
      if (config.stopMode === 'atr')
        adjusted.atrMultiplier = Math.min(10, Math.max(0.25, (config.atrMultiplier ?? 2) * stopMultiplier));
      else if (config.stopMode === 'trailing')
        adjusted.trailingPct = Math.min(
          50,
          Math.max(0.01, (config.trailingPct ?? config.stop) * stopMultiplier),
        );
      else adjusted.stop = Math.min(50, Math.max(0.01, config.stop * stopMultiplier));
      const key = JSON.stringify(adjusted);
      if (seen.has(key)) continue;
      seen.add(key);
      const result = backtest(training, adjusted);
      candidates.push({
        config: adjusted,
        training: metrics(result),
        eligible: result.trades.length >= minimumTrades,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      b.training.score - a.training.score ||
      a.config.buy - b.config.buy,
  );
  const selected = candidates[0];
  // Entire earlier prefix initializes indicators, but no positions or equity carry across the split.
  const holdout = backtest(candles, selected.config, { startIndex: boundary });
  const baselineHoldout = backtest(candles, config, { startIndex: boundary });
  const warnings: string[] = [];
  if (!selected.eligible)
    warnings.push(
      'No candidate completed 3 training trades. The displayed choice is exploratory and lacks enough samples.',
    );
  if (holdout.trades.length < 3)
    warnings.push('Fewer than 3 holdout trades; the held-out estimate is especially uncertain.');
  if (holdout.returnPct < baselineHoldout.returnPct)
    warnings.push('The training winner underperformed the uncalibrated rules on held-out data.');
  if (candles.some((c) => c.sentiment === null))
    warnings.push(
      'Missing sentiment bars cannot trigger entries or sentiment exits; price stops remain active.',
    );
  return {
    split: {
      trainingBars: training.length,
      holdoutBars: candles.length - boundary,
      trainingStart: candles[0].time,
      trainingEnd: candles[boundary - 1].time,
      holdoutStart: candles[boundary].time,
      holdoutEnd: candles.at(-1)!.time,
      scoredTrainingBars: training.length - 15,
    },
    candidates,
    selected,
    holdout,
    baselineHoldout,
    minimumTrades,
    warnings,
    objective:
      'Training net return minus maximum drawdown (percentage points); at least 3 training trades preferred. Buy threshold ±5; stop distance ×0.75, ×1, ×1.25. Holdout is never used for selection.',
  };
}

/** Stable non-cryptographic fingerprint for matching a report to an exported CSV. */
export function datasetFingerprint(candles: Candle[]): string {
  let hash = 2166136261;
  for (const candle of candles) {
    const row = [
      candle.time,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.sentiment ?? '',
    ].join(',');
    for (let i = 0; i < row.length; i++) {
      hash ^= row.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
