import { backtest } from './engine';
import {
  calibrate,
  stressSuite,
  type CalibrationReport,
  type ScenarioResult,
  type StressSettings,
} from './scenarios';
import type { BacktestConfig, BacktestResult, Candle } from '../types';

export type ResearchTask = 'backtest' | 'stress' | 'calibration';
export type ResearchRequest = {
  task: ResearchTask;
  candles: Candle[];
  config: BacktestConfig;
  stress: StressSettings;
};
export type ResearchResponse =
  | { task: 'backtest'; result: BacktestResult }
  | { task: 'stress'; results: ScenarioResult[] }
  | { task: 'calibration'; report: CalibrationReport }
  | { error: string };

// Each run gets its own short-lived worker; navigating away cancels it in the view.
self.onmessage = (event: MessageEvent<ResearchRequest>) => {
  const { task, candles, config, stress } = event.data;
  try {
    const response: ResearchResponse =
      task === 'backtest'
        ? { task, result: backtest(candles, config) }
        : task === 'stress'
          ? { task, results: stressSuite(candles, config, stress) }
          : { task, report: calibrate(candles, config) };
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : 'The research run failed. Check parameters and try again.',
    } satisfies ResearchResponse);
  }
};
