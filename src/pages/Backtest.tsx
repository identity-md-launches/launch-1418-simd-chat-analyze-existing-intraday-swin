import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Download, FlaskConical, Play, Upload } from 'lucide-react';
import { Badge, Metric, Panel } from '../components';
import EquityChart from '../EquityChart';
import { dateLabel, download, money, parseCsv, pct } from '../lib/engine';
import { demoHistory } from '../lib/data';
import {
  datasetFingerprint,
  DEFAULT_STRESS,
  type CalibrationReport,
  type ScenarioResult,
  type StressSettings,
} from '../lib/scenarios';
import type { ResearchResponse, ResearchTask } from '../lib/research.worker';
import type { Asset, BacktestConfig, BacktestSession, Snapshot, Strategy } from '../types';

export function createBacktestSession(asset: Asset, strategy: Strategy): BacktestSession {
  return {
    config: {
      capital: 10000,
      fee: 0.1,
      slippage: 0.05,
      buy: strategy.buy,
      sell: strategy.sell,
      maxRsi: strategy.maxRsi,
      stop: strategy.stop,
      target: strategy.target,
      risk: strategy.risk,
      adaptive: strategy.adaptive ?? true,
      stopMode: 'fixed',
      atrMultiplier: 2,
      trailingPct: 2,
      maxDrawdownPct: 10,
      dailyLossPct: 3,
    },
    history: demoHistory(asset),
    dataset: 'Synthetic demo · 7 days · 5-minute bars',
    range: '7',
    result: null,
    resultConfig: null,
  };
}

export default function Backtest({
  snapshot,
  strategy,
  serviceUrl,
  session,
  onChange,
}: {
  snapshot: Snapshot;
  strategy: Strategy;
  serviceUrl: string;
  session: BacktestSession;
  onChange: (patch: Partial<BacktestSession>) => void;
}) {
  const { config, history, dataset, result, range, resultConfig } = session;
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState('');
  const [stress, setStress] = useState<StressSettings>(DEFAULT_STRESS);
  const [working, setWorking] = useState<ResearchTask | ''>('');
  const worker = useRef<Worker | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const [scenarioRun, setScenarioRun] = useState<{ key: string; results: ScenarioResult[] } | null>(null);
  const [calibrationRun, setCalibrationRun] = useState<{ key: string; report: CalibrationReport } | null>(
    null,
  );
  const upload = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const bars = useMemo(
    () =>
      range === 'all'
        ? history
        : history.filter((c) => c.time >= (history.at(-1)?.time ?? 0) - Number(range) * 86400),
    [history, range],
  );
  const fingerprint = useMemo(() => datasetFingerprint(bars), [bars]);
  const key = `${snapshot.asset}:${fingerprint}:${JSON.stringify(config)}`;
  const scenarioKey = `${key}:${JSON.stringify(stress)}`;
  const latestKey = useRef(scenarioKey);
  latestKey.current = scenarioKey;
  const scenarios = scenarioRun?.key === scenarioKey ? scenarioRun.results : null;
  const calibration = calibrationRun?.key === key ? calibrationRun.report : null;

  useEffect(
    () => () => {
      worker.current?.terminate();
    },
    [],
  );
  useEffect(() => {
    setBusy(false);
    return () => {
      historyRequest.current?.abort();
      historyRequest.current = null;
    };
  }, [snapshot.asset]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (worker.current) {
      worker.current.terminate();
      worker.current = null;
      setWorking('');
      setStatus('Parameters changed. The previous research run was cancelled.');
    }
  }, [key, scenarioKey]);

  function compute(task: ResearchTask) {
    if (worker.current) return;
    setError('');
    setWorking(task);
    setStatus('Research calculation started.');
    try {
      const next = new Worker(new URL('../lib/research.worker.ts', import.meta.url), { type: 'module' });
      worker.current = next;
      const finish = () => {
        next.terminate();
        if (worker.current === next) {
          worker.current = null;
          setWorking('');
        }
      };
      next.onmessage = (event: MessageEvent<ResearchResponse>) => {
        if (worker.current !== next || latestKey.current !== scenarioKey) {
          finish();
          return;
        }
        const data = event.data;
        if ('error' in data) setError(data.error);
        else if (data.task === 'backtest') {
          onChange({ result: data.result, resultConfig: { ...config } });
          setStatus(
            `Backtest complete: ${data.result.trades.length} trades, net return ${pct(data.result.returnPct)}.`,
          );
        } else if (data.task === 'stress') {
          setScenarioRun({ key: scenarioKey, results: data.results });
          onChange({ result: data.results[0].result, resultConfig: { ...config } });
          setStatus('Stress test complete. Baseline and three scenarios are ready.');
        } else {
          setCalibrationRun({ key, report: data.report });
          setStatus(
            `Calibration complete: ${data.report.candidates.length} candidates and ${data.report.holdout.trades.length} holdout trades.`,
          );
        }
        finish();
      };
      next.onerror = () => {
        if (worker.current === next && latestKey.current === scenarioKey)
          setError('Unable to run the research worker. Reload the page and try again.');
        finish();
      };
      next.postMessage({ task, candles: bars, config, stress });
    } catch {
      worker.current?.terminate();
      worker.current = null;
      setWorking('');
      setError('Unable to start the research worker. Use a browser that supports Web Workers and try again.');
    }
  }

  function updateConfig(patch: Partial<BacktestConfig>) {
    const next = { ...config, ...patch };
    if ((Object.keys(next) as (keyof BacktestConfig)[]).every((field) => next[field] === config[field])) {
      setStatus('Parameters are unchanged. Existing results are current.');
      return;
    }
    onChange({ config: next, result: null, resultConfig: null });
    setStatus('Parameters changed. Run the test to update results.');
  }
  function change(key: keyof BacktestConfig, value: string) {
    updateConfig({ [key]: Number(value) });
  }
  function run(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    compute('backtest');
  }
  function exportReport() {
    download(
      'pulse-research-report.json',
      JSON.stringify(
        {
          schema: 'pulse.research.v2',
          generatedAt: new Date().toISOString(),
          dataset,
          asset: snapshot.asset,
          fingerprint,
          fingerprintMethod: 'FNV-1a (non-cryptographic)',
          bars: bars.length,
          firstTimestamp: bars[0]?.time,
          lastTimestamp: bars.at(-1)?.time,
          assumptions:
            'Long-only, no leverage. Prior-bar signals; next-open fills. Both-side fees and slippage. Stop-first ordering; bar-close drawdown. Training selection is separate from chronological holdout. Synthetic stresses keep original sentiment and volume. Not a prediction.',
          config,
          baseline: result,
          stressSettings: scenarios ? stress : null,
          scenarios,
          calibration,
        },
        null,
        2,
      ),
      'application/json',
    );
  }
  function loadSavedRules() {
    updateConfig({
      buy: strategy.buy,
      sell: strategy.sell,
      maxRsi: strategy.maxRsi,
      risk: strategy.risk,
      stop: strategy.stop,
      target: strategy.target,
      adaptive: strategy.adaptive ?? true,
    });
  }
  function exportCandles() {
    download(
      'pulse-history.csv',
      [
        'time,open,high,low,close,volume,sentiment',
        ...history.map((c) =>
          [c.time, c.open, c.high, c.low, c.close, c.volume, c.sentiment ?? ''].join(','),
        ),
      ].join('\n'),
      'text/csv',
    );
  }
  async function loadHistory() {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/api/history?asset=${snapshot.asset}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok)
        throw new Error('Unable to load stored history. Check the service connection and try again.');
      const next = parseCsv(await response.text());
      if (historyRequest.current !== controller || controller.signal.aborted) return;
      if (next.filter((c) => c.sentiment !== null).length < 15)
        throw new Error(
          'Not enough recorded sentiment yet. Keep the service running or import historical data.',
        );
      onChange({
        history: next,
        dataset: 'Recorded live data · 5-minute bars',
        range: 'all',
        result: null,
        resultConfig: null,
      });
      setStatus(`Loaded ${next.length} recorded candles.`);
    } catch (e) {
      if (!controller.signal.aborted && historyRequest.current === controller) setError((e as Error).message);
    } finally {
      if (historyRequest.current === controller) {
        historyRequest.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      <div className="backtest-grid">
        <Panel title="Strategy parameters" subtitle="Test rules, then challenge the assumptions.">
          <form
            onSubmit={run}
            className="form-stack compact-form"
            aria-describedby={error ? 'backtest-error' : undefined}
          >
            <button className="button primary full-width" type="submit" disabled={!!working}>
              <Play size={16} aria-hidden="true" />
              {working === 'backtest' ? 'Running backtest…' : 'Run backtest'}
            </button>
            <label>
              Historical data
              <select
                value={range}
                onChange={(e) => {
                  onChange({ range: e.target.value, result: null, resultConfig: null });
                  setStatus('Date range changed. Run the test to update results.');
                }}
              >
                <option value="1">Last 24 hours</option>
                <option value="3">Last 3 days</option>
                <option value="7">Last 7 days</option>
                <option value="all">All available data</option>
              </select>
            </label>
            <label>
              Starting capital (USD)
              <input
                type="number"
                min="1"
                max="1000000000"
                step="any"
                value={config.capital}
                onChange={(e) => change('capital', e.target.value)}
                required
              />
            </label>
            <label>
              Indicator mode
              <select
                value={(config.adaptive ?? true) ? 'adaptive' : 'fixed'}
                onChange={(e) => updateConfig({ adaptive: e.target.value === 'adaptive' })}
              >
                <option value="adaptive">Volatility-adaptive RSI</option>
                <option value="fixed">Fixed RSI · 14 bars</option>
              </select>
            </label>
            <div className="field-grid">
              {(
                [
                  ['buy', 'Buy threshold', 1, 100],
                  ['sell', 'Sell threshold', 0, 99],
                  ['maxRsi', 'RSI ceiling', 1, 100],
                  ['risk', 'Account risk (%)', 0.1, 10],
                ] as const
              ).map(([field, label, min, max]) => (
                <label key={field}>
                  {label}
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={field === 'risk' ? 0.01 : 1}
                    value={config[field]}
                    onChange={(e) => change(field, e.target.value)}
                    required
                  />
                </label>
              ))}
            </div>
            <details className="help-details" open>
              <summary>Stops and loss protection</summary>
              <div className="form-stack">
                <label>
                  Stop method
                  <select
                    value={config.stopMode ?? 'fixed'}
                    onChange={(e) => updateConfig({ stopMode: e.target.value as BacktestConfig['stopMode'] })}
                  >
                    <option value="fixed">Fixed percentage</option>
                    <option value="atr">ATR-based distance</option>
                    <option value="trailing">Trailing closing price</option>
                  </select>
                </label>
                <div className="field-grid">
                  {(config.stopMode ?? 'fixed') === 'fixed' && (
                    <label>
                      Stop loss (%)
                      <input
                        type="number"
                        min=".1"
                        max="50"
                        step=".01"
                        value={config.stop}
                        onChange={(e) => change('stop', e.target.value)}
                        required
                      />
                    </label>
                  )}
                  {config.stopMode === 'atr' && (
                    <label>
                      ATR multiplier
                      <input
                        type="number"
                        min=".25"
                        max="10"
                        step=".25"
                        value={config.atrMultiplier ?? 2}
                        onChange={(e) => change('atrMultiplier', e.target.value)}
                        required
                      />
                    </label>
                  )}
                  {config.stopMode === 'trailing' && (
                    <label>
                      Trailing stop (%)
                      <input
                        type="number"
                        min=".1"
                        max="50"
                        step=".01"
                        value={config.trailingPct ?? config.stop}
                        onChange={(e) => change('trailingPct', e.target.value)}
                        required
                      />
                    </label>
                  )}
                  <label>
                    Take profit (%)
                    <input
                      type="number"
                      min=".1"
                      max="100"
                      step=".01"
                      value={config.target}
                      onChange={(e) => change('target', e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Max drawdown (%)
                    <input
                      type="number"
                      min="0"
                      max="50"
                      step=".1"
                      value={config.maxDrawdownPct ?? 0}
                      onChange={(e) => change('maxDrawdownPct', e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Daily loss limit (%)
                    <input
                      type="number"
                      min="0"
                      max="50"
                      step=".1"
                      value={config.dailyLossPct ?? 0}
                      onChange={(e) => change('dailyLossPct', e.target.value)}
                      required
                    />
                  </label>
                </div>
                <p className="muted small-text">
                  Zero disables a loss limit. A breach queues an exit at the next open and blocks entries.
                  Gaps can exceed the limit. Lab settings are separate from the paper risk guard.
                </p>
              </div>
            </details>
            <details className="help-details">
              <summary>Trading costs</summary>
              <div className="field-grid">
                {(['fee', 'slippage'] as const).map((field) => (
                  <label key={field}>
                    {field === 'fee' ? 'Fee / side (%)' : 'Slippage / side (%)'}
                    <input
                      type="number"
                      min="0"
                      max="5"
                      step=".01"
                      value={config[field]}
                      onChange={(e) => change(field, e.target.value)}
                      required
                    />
                  </label>
                ))}
              </div>
            </details>
            <button className="button secondary full-width" type="button" onClick={loadSavedRules}>
              Load saved signal rules
            </button>
            <div
              id="backtest-error"
              ref={errorRef}
              tabIndex={-1}
              className={error ? 'form-error' : ''}
              role="alert"
            >
              {error}
            </div>
          </form>
        </Panel>
        <div className="stack">
          <Panel
            title="Historical dataset"
            action={
              <Badge tone={dataset.startsWith('Synthetic') ? 'warning' : 'neutral'}>
                {dataset.startsWith('Synthetic') ? 'Demo data' : 'Custom data'}
              </Badge>
            }
          >
            <div className="padded">
              <p>{dataset}</p>
              <p className="muted small-text">
                {bars.length.toLocaleString()} candles
                {bars.length > 0 && (
                  <>
                    {' '}
                    · {dateLabel(bars[0].time)} – {dateLabel(bars.at(-1)!.time)}{' '}
                    {new Date(bars.at(-1)!.time * 1000).getUTCFullYear()} · UTC
                  </>
                )}
              </p>
              <div className="button-row data-actions">
                <button className="button secondary" onClick={() => upload.current?.click()}>
                  <Upload size={15} aria-hidden="true" />
                  Import CSV
                </button>
                <button className="button secondary" onClick={exportCandles}>
                  <Download size={15} aria-hidden="true" />
                  Export data
                </button>
                {snapshot.mode === 'live' && (
                  <button className="button secondary" disabled={busy} onClick={loadHistory}>
                    {busy ? 'Loading history…' : 'Load recorded history'}
                  </button>
                )}
              </div>
              <input
                type="file"
                ref={upload}
                className="file-input"
                tabIndex={-1}
                accept=".csv,text/csv"
                aria-label="Import historical CSV"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 5 * 1024 * 1024) throw new Error('Choose a CSV smaller than 5 MiB.');
                    const next = parseCsv(await file.text());
                    onChange({
                      history: next,
                      dataset: `Imported: ${file.name}`,
                      range: 'all',
                      result: null,
                      resultConfig: null,
                    });
                    setError('');
                    setStatus(`Imported ${next.length} candles.`);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    e.target.value = '';
                  }
                }}
              />
              <details className="help-details">
                <summary>CSV format and timing</summary>
                <p>
                  Header: <code>time,open,high,low,close,volume,sentiment</code>. Use Unix seconds and
                  increasing times. Sentiment ranges from 0 to 100; leave it blank when unavailable. Scores
                  must have been known by the candle’s close. Imported scores are already aggregated; source
                  weights do not reweight them.
                </p>
              </details>
            </div>
          </Panel>
          {result && resultConfig ? (
            <Panel
              title="Backtest results"
              action={<Badge tone="accent">{result.trades.length} trades</Badge>}
            >
              <div className="result-metrics">
                <Metric
                  label="Net return"
                  value={
                    <span className={result.returnPct >= 0 ? 'positive-text' : 'negative-text'}>
                      {pct(result.returnPct)}
                    </span>
                  }
                  detail="After fees and slippage"
                />
                <Metric
                  label="Max drawdown"
                  value={`${result.maxDrawdown.toFixed(2)}%`}
                  detail="Marked at each bar close"
                />
                <Metric
                  label="Win rate"
                  value={`${result.winRate.toFixed(1)}%`}
                  detail={`${result.trades.filter((t) => t.pnl > 0).length} profitable trades`}
                />
              </div>
              <div className="equity-wrap">
                <div className="equity-heading">
                  <h3>Equity curve</h3>
                  <strong>{money(result.finalEquity)}</strong>
                </div>
                <EquityChart result={result} capital={resultConfig.capital} />
                <p className="muted small-text">
                  Buy and hold, before costs: {pct(result.benchmark)}. Fees: {money(result.feesPaid)} ·
                  Slippage: {money(result.slippageCost)}. {result.evaluatedBars.toLocaleString()} evaluated
                  bars.
                </p>
                {result.protectionEvents.length > 0 && (
                  <p className="callout warning-callout">
                    {result.protectionEvents.length} protection trigger
                    {result.protectionEvents.length === 1 ? '' : 's'}.{' '}
                    {result.halted
                      ? 'New entries halted for the rest of this run.'
                      : 'Daily entry pauses applied.'}
                  </p>
                )}
                <p className="muted small-text">Simulated results do not predict future performance.</p>
              </div>
            </Panel>
          ) : (
            <Panel>
              <div className="empty-state backtest-empty">
                <FlaskConical size={36} aria-hidden="true" />
                <h2>Put your strategy to the test</h2>
                <p>
                  Run a backtest to inspect returns, drawdown, and every simulated trade. Then compare
                  stressed markets and held-out data.
                </p>
                <Badge>
                  {dataset.startsWith('Synthetic')
                    ? 'Synthetic data is ready to explore'
                    : 'Historical data is ready to test'}
                </Badge>
              </div>
            </Panel>
          )}
          <Panel
            title="Scenario stress tests"
            subtitle="Apply explicit shocks to the same rules and dataset."
          >
            <form
              className="padded form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                compute('stress');
              }}
            >
              <div className="field-grid">
                {(
                  [
                    ['crashPct', 'Crash gap (%)', 1, 50, 1],
                    ['volatilityMultiplier', 'Volatility multiplier', 1, 5, 0.1],
                    ['extraSlippage', 'Extra slippage (%)', 0, 4, 0.05],
                  ] as const
                ).map(([field, label, min, max, step]) => (
                  <label key={field}>
                    {label}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      step={step}
                      value={stress[field]}
                      onChange={(e) => setStress({ ...stress, [field]: Number(e.target.value) })}
                      required
                    />
                  </label>
                ))}
              </div>
              <button className="button secondary" disabled={!!working} type="submit">
                <FlaskConical size={16} aria-hidden="true" />
                {working === 'stress' ? 'Running stress tests…' : 'Run stress tests'}
              </button>
              <p className="muted small-text">
                Synthetic shocks hold sentiment and volume constant. The liquidity scenario increases
                slippage; it does not simulate an order book.
              </p>
            </form>
            {scenarios && (
              <>
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Scrollable scenario results"
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Scenario</th>
                        <th scope="col">Net return</th>
                        <th scope="col">Max drawdown</th>
                        <th scope="col">Trades</th>
                        <th scope="col">Guard triggers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((item) => (
                        <tr key={item.id}>
                          <th scope="row">{item.name}</th>
                          <td className={item.result.returnPct >= 0 ? 'positive-text' : 'negative-text'}>
                            {pct(item.result.returnPct)}
                          </td>
                          <td>{item.result.maxDrawdown.toFixed(2)}%</td>
                          <td>{item.result.trades.length}</td>
                          <td>{item.result.protectionEvents.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details className="padded help-details">
                  <summary>Scenario assumptions</summary>
                  {scenarios.map((item) => (
                    <p key={item.id}>
                      <strong>{item.name}:</strong> {item.assumption}
                    </p>
                  ))}
                </details>
              </>
            )}
          </Panel>
        </div>
      </div>
      <Panel
        title="Calibration and holdout"
        subtitle="Tune on the first 70%; evaluate once on the final 30%."
        className="ledger"
        action={
          <button className="button secondary" disabled={!!working} onClick={() => compute('calibration')}>
            <FlaskConical size={16} aria-hidden="true" />
            {working === 'calibration' ? 'Running calibration…' : 'Run calibration'}
          </button>
        }
      >
        <div className="padded">
          <p className="muted small-text">
            Sweep nine nearby buy thresholds and stop distances. Rank training net return minus drawdown,
            preferring at least three trades. The selected rules start the holdout with fresh capital and no
            open position; earlier bars only warm up indicators.
          </p>
        </div>
        {calibration && (
          <>
            <div className="result-metrics">
              <Metric
                label="Holdout return"
                value={pct(calibration.holdout.returnPct)}
                detail={`${calibration.holdout.trades.length} held-out trades`}
              />
              <Metric
                label="Holdout drawdown"
                value={`${calibration.holdout.maxDrawdown.toFixed(2)}%`}
                detail={`Uncalibrated return: ${pct(calibration.baselineHoldout.returnPct)}`}
              />
              <Metric
                label="Sample split"
                value={`${calibration.split.trainingBars} / ${calibration.split.holdoutBars}`}
                detail="Training / holdout candles"
              />
            </div>
            <div className="padded">
              <p>
                <strong>Training choice:</strong> buy at {calibration.selected.config.buy};{' '}
                {stopDescription(calibration.selected.config)}. Training score:{' '}
                {calibration.selected.training.score.toFixed(2)} points. Training return:{' '}
                {pct(calibration.selected.training.returnPct)}.
              </p>
              <p className="muted small-text">
                {calibration.split.scoredTrainingBars} training bars after warmup ·{' '}
                {calibration.holdout.evaluatedBars} held-out bars ·{' '}
                {dateLabel(calibration.split.holdoutStart)} – {dateLabel(calibration.split.holdoutEnd)} UTC.
                Fee {config.fee}% and slippage {config.slippage}% per side. Repeated tuning after viewing
                holdout results weakens its independence.
              </p>
              {calibration.warnings.map((warning) => (
                <p className="callout warning-callout" key={warning}>
                  {warning}
                </p>
              ))}
            </div>
            <details className="help-details padded">
              <summary>Compare all {calibration.candidates.length} training candidates</summary>
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Scrollable calibration candidates"
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Buy threshold</th>
                      <th scope="col">Stop rule</th>
                      <th scope="col">Trades</th>
                      <th scope="col">Net return</th>
                      <th scope="col">Drawdown</th>
                      <th scope="col">Score</th>
                      <th scope="col">Sample</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calibration.candidates.map((item, index) => (
                      <tr key={index}>
                        <td>
                          {item.config.buy}
                          {index === 0 ? ' · selected' : ''}
                        </td>
                        <td>{stopDescription(item.config)}</td>
                        <td>{item.training.trades}</td>
                        <td>{pct(item.training.returnPct)}</td>
                        <td>{item.training.maxDrawdown.toFixed(2)}%</td>
                        <td>{item.training.score.toFixed(2)}</td>
                        <td>{item.eligible ? '≥3 trades' : 'Limited'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
        {(result || scenarios || calibration) && (
          <div className="padded">
            <button className="button secondary" onClick={exportReport}>
              <Download size={15} aria-hidden="true" />
              Export research report
            </button>
          </div>
        )}
      </Panel>
      <details className="panel methodology">
        <summary>Execution and research assumptions</summary>
        <p>
          Signals use the previous closed candle. Entries and sentiment exits fill at the next open, with
          adverse slippage and fees on both sides. If stop and target are both touched, the stop takes
          priority. Gaps fill at the open. ATR stops use the previous bar’s Wilder ATR; trailing stops advance
          after a bar closes and apply from the next bar. A loss-limit breach at a bar close queues
          liquidation at the next open; drawdown halts the rest of the run, and daily limits pause entries
          until the next UTC day. Losses can exceed configured limits. Open positions close on the final
          candle. Risk sizing is capped by available cash; no leverage, shorting, funding, partial fills, or
          latency model. Drawdown uses bar-close equity, not intrabar extremes. Adaptive RSI lengthens its
          smoothing period in higher relative volatility; fixed mode uses 14 bars. Stress scenarios are
          hypothetical sensitivity tests, and calibration is a small parameter sweep, not statistical proof.
        </p>
      </details>
      {result && (
        <Panel
          title="Trade ledger"
          className="ledger"
          action={
            <button
              className="button secondary"
              onClick={() =>
                download(
                  'pulse-backtest-trades.csv',
                  [
                    'entry_time,exit_time,entry,exit,quantity,pnl,reason,equity',
                    ...result.trades.map((t) =>
                      [t.entryTime, t.exitTime, t.entry, t.exit, t.quantity, t.pnl, t.reason, t.equity].join(
                        ',',
                      ),
                    ),
                  ].join('\n'),
                  'text/csv',
                )
              }
            >
              <Download size={15} aria-hidden="true" />
              Export trades
            </button>
          }
        >
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Scrollable backtest trade ledger"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Entry (UTC)</th>
                  <th scope="col">Exit (UTC)</th>
                  <th scope="col">Entry price</th>
                  <th scope="col">Exit price</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Net P&amp;L</th>
                  <th scope="col">Exit reason</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((t, i) => (
                  <tr key={i}>
                    <td>{new Date(t.entryTime * 1000).toISOString().slice(5, 16).replace('T', ' ')}</td>
                    <td>{new Date(t.exitTime * 1000).toISOString().slice(5, 16).replace('T', ' ')}</td>
                    <td>{money(t.entry)}</td>
                    <td>{money(t.exit)}</td>
                    <td>{t.quantity.toFixed(6)}</td>
                    <td className={t.pnl >= 0 ? 'positive-text' : 'negative-text'}>{money(t.pnl)}</td>
                    <td>{t.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!result.trades.length && (
              <p className="empty-state">
                No trades matched these rules. Try a lower buy threshold or a wider RSI ceiling.
              </p>
            )}
          </div>
        </Panel>
      )}
    </>
  );
}

function stopDescription(config: BacktestConfig): string {
  return config.stopMode === 'atr'
    ? `${config.atrMultiplier ?? 2}× ATR stop`
    : config.stopMode === 'trailing'
      ? `${config.trailingPct ?? config.stop}% trailing stop`
      : `${config.stop}% fixed stop`;
}
