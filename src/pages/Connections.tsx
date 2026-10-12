import { useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  Check,
  Download,
  Pause,
  Play,
  Plug,
  Radio,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Badge, Panel, SourceIcon, SourceStatus } from '../components';
import { dateTimeLabel, download, observationAge } from '../lib/engine';
import type { Snapshot, Strategy } from '../types';
import type { MarketStream } from '../lib/live';

const exchanges = [
  {
    id: 'kraken',
    name: 'Kraken',
    mark: 'K',
    color: '#ba9df6',
    pair: 'BTC/USD',
    url: 'https://pro.kraken.com/app/trade/btc-usd',
  },
  {
    id: 'binance',
    name: 'Binance',
    mark: '◇',
    color: '#edcf62',
    pair: 'BTC/USDT',
    url: 'https://www.binance.com/en/trade/BTC_USDT',
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    mark: 'C',
    color: '#92afff',
    pair: 'BTC/USD',
    url: 'https://www.coinbase.com/advanced-trade/spot/BTC-USD',
  },
];
export default function Connections({
  snapshot,
  strategy,
  serviceUrl,
  onConnect,
  onDemo,
  busy,
  connectionError,
  market,
  onMarketConnect,
}: {
  snapshot: Snapshot | null;
  strategy: Strategy;
  serviceUrl: string;
  onConnect: (url: string) => Promise<void>;
  onDemo: () => void;
  busy: boolean;
  connectionError: string;
  market?: MarketStream;
  onMarketConnect?: () => void;
}) {
  const [url, setUrl] = useState(serviceUrl || 'http://127.0.0.1:8000'),
    [error, setError] = useState(''),
    [mode, setMode] = useState('manual'),
    [notice, setNotice] = useState('');
  const streamActive = !!market && market.status !== 'idle';
  const streamLabel =
    market?.status === 'live'
      ? 'Streaming'
      : market?.status === 'paused'
        ? 'Paused'
        : market?.status === 'stale'
          ? 'Stale prices'
          : market?.status === 'error'
            ? 'Disconnected'
            : streamActive
              ? 'Connecting'
              : 'Demo workspace';
  function connect(e: FormEvent) {
    e.preventDefault();
    try {
      const parsed = new URL(url);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      )
        throw new Error();
      if (
        location.protocol === 'https:' &&
        parsed.protocol === 'http:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      ) {
        setError('Use HTTPS for a remote service when the workspace is hosted on HTTPS.');
        return;
      }
      setError('');
      void onConnect(url.replace(/\/$/, ''));
    } catch {
      setError('Enter an HTTP or HTTPS service URL without credentials, query parameters, or a fragment.');
    }
  }
  return (
    <div className="stack">
      <Panel
        title="Live market stream"
        subtitle="Trade-by-trade prices, with no API key."
        action={<Radio size={20} className="muted" aria-hidden="true" />}
      >
        <div className="padded form-stack">
          <div className="connection-status">
            <span className={`status-dot ${market?.status === 'live' ? '' : 'demo'}`} />
            <span role="status">{streamLabel}</span>
            <Badge tone={market?.status === 'live' ? 'positive' : 'neutral'}>Kraken WebSocket</Badge>
          </div>
          <p className="muted">
            Stream the selected USD market directly from Kraken. Closed five-minute candles power the
            indicators; unfinished candles never enter signal calculations.
          </p>
          <div className="button-row">
            {!streamActive ? (
              <button type="button" className="button primary" onClick={onMarketConnect}>
                <Plug size={16} />
                Connect market stream
              </button>
            ) : (
              <>
                <button type="button" className="button primary" onClick={market.reconnect}>
                  <RefreshCw size={16} />
                  Reconnect stream
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => market.setPaused(!market.paused)}
                >
                  {market.paused ? <Play size={16} /> : <Pause size={16} />}
                  {market.paused ? 'Resume stream' : 'Pause stream'}
                </button>
              </>
            )}
            <button className="button secondary" type="button" onClick={onDemo}>
              Use demo data
            </button>
            {market?.snapshot && (
              <a className="button secondary" href="#overview">
                Open market overview
                <ArrowUpRight size={16} />
              </a>
            )}
          </div>
          {streamActive && (
            <>
              <p
                className={market.status === 'error' ? 'form-error' : 'field-hint'}
                role={market.status === 'error' ? 'alert' : undefined}
              >
                {market.detail}
              </p>
              <dl className="detail-list">
                <div>
                  <dt>Update cadence</dt>
                  <dd>Up to 4 updates per second</dd>
                </div>
                <div>
                  <dt>Message delay estimate</dt>
                  <dd>
                    {market.latencyMs === null
                      ? 'Waiting for a trade'
                      : market.latencyMs < 0
                        ? 'Device clock differs'
                        : `${Math.round(market.latencyMs)} ms`}
                  </dd>
                </div>
                <div>
                  <dt>Closed price history</dt>
                  <dd>
                    {market.historyStatus === 'loading'
                      ? 'Loading…'
                      : market.historyStatus === 'unavailable'
                        ? 'Limited to received stream candles'
                        : `${market.snapshot?.candles.length ?? 0} candles ready`}
                  </dd>
                </div>
                <div>
                  <dt>Rejected messages</dt>
                  <dd>{market.dropped}</dd>
                </div>
              </dl>
              <p className="field-hint">
                Message delay includes your device’s clock difference. Heartbeats detect disconnects;
                reconnects use limited, spaced retries. Pause holds signals immediately.
              </p>
              {market.historyStatus === 'unavailable' && (
                <p className="form-error">
                  Price history could not load. The stream still receives new candles; reconnect to retry
                  history. Indicators wait until enough closed candles are available.
                </p>
              )}
            </>
          )}
        </div>
      </Panel>
      <div className="two-column settings-grid">
        <Panel title="Optional sentiment service" subtitle="Add source evidence to your market stream.">
          <form className="form-stack" onSubmit={connect}>
            <p className="muted">
              For social, news and on-chain scores, run the included Pulse service and enter its URL. Provider
              keys stay on that service.
            </p>
            <label>
              Service URL
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={!!(error || connectionError)}
                aria-describedby={error || connectionError ? 'connection-error' : 'connection-hint'}
                required
              />
              <span className="field-hint" id="connection-hint">
                Use the origin and optional path of your Pulse service.
              </span>
            </label>
            {(error || connectionError) && (
              <p className="form-error" id="connection-error" role="alert">
                {error || connectionError}
              </p>
            )}
            <div className="button-row">
              <button className="button secondary" type="submit" disabled={busy}>
                <Plug size={16} />
                {busy ? 'Connecting…' : 'Connect sentiment service'}
              </button>
            </div>
            <p className="field-hint">
              Source scores refresh every 30 seconds. Market prices arrive independently over WebSocket.
            </p>
          </form>
        </Panel>
        <Panel title="Source coverage">
          <div className="padded source-connections">
            {(['Social', 'News', 'On-chain'] as const).map((kind) => {
              const source = snapshot?.sources.find((s) => s.kind === kind);
              return (
                <div className="source-connection" key={kind}>
                  <span className="feed-icon">
                    <SourceIcon kind={kind} size={20} />
                  </span>
                  <div>
                    <h3>{kind}</h3>
                    <p className="muted small-text">
                      {kind === 'Social'
                        ? 'X via TwitterAPI.io · server key required'
                        : kind === 'News'
                          ? 'CoinDesk + Cointelegraph RSS · no key'
                          : 'Owner-configured on-chain score provider'}
                    </p>
                    {source?.updatedAt != null && (
                      <p className="muted small-text">
                        Last observation: {dateTimeLabel(source.updatedAt)} ({observationAge(source.updatedAt, snapshot!.asOf)})
                      </p>
                    )}
                  </div>
                  <SourceStatus source={source} asOf={snapshot?.asOf ?? 0} demo={snapshot?.mode === 'demo'} />
                </div>
              );
            })}
            <div className="callout">
              <p>
                Unavailable or old sources hold sentiment-based signals. Market streaming never substitutes a
                demo score. <a href="#guide">Read the setup guide</a>.
              </p>
            </div>
          </div>
        </Panel>
      </div>
      <Panel
        title="Exchange connections"
        subtitle="Prepare a manual or automated execution integration."
        action={<Badge>Templates only</Badge>}
      >
        <div className="padded">
          <div className="connection-intro">
            <p className="muted">
              Choose an exchange and download its configuration. Each template starts in dry-run mode. No
              funds or trading keys are connected.
            </p>
            <label className="inline-label">
              Execution mode
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="manual">Manual review</option>
                <option value="automated">Automated template</option>
              </select>
            </label>
          </div>
          <div className="exchange-grid">
            {exchanges.map((exchange) => (
              <div className="exchange-card" key={exchange.id}>
                <div className="exchange-title">
                  <span
                    className="exchange-mark"
                    style={{ color: exchange.color, backgroundColor: `${exchange.color}16` }}
                  >
                    {exchange.mark}
                  </span>
                  <h3>{exchange.name}</h3>
                  <Badge>Not connected</Badge>
                </div>
                <p>
                  {mode === 'manual'
                    ? 'Review each order before execution.'
                    : 'Evaluate signals on each new closed candle.'}
                </p>
                <ul className="feature-list">
                  <li>
                    <Check size={14} />
                    CCXT API adapter
                  </li>
                  <li>
                    <Check size={14} />
                    Dry-run order validation
                  </li>
                  <li>
                    <Check size={14} />
                    Keys stay on your server
                  </li>
                </ul>
                <button
                  className="button secondary full-width"
                  onClick={() => {
                    download(
                      `pulse-${exchange.id}-${mode}.json`,
                      JSON.stringify(
                        {
                          exchange: exchange.id,
                          mode,
                          dry_run: true,
                          symbol: exchange.pair,
                          api_key_env: `${exchange.id.toUpperCase()}_API_KEY`,
                          secret_env: `${exchange.id.toUpperCase()}_API_SECRET`,
                          signal: {
                            name: strategy.name,
                            buy_above: strategy.buy,
                            sell_below: strategy.sell,
                            rsi_ceiling: strategy.maxRsi,
                            weights: strategy.weights,
                          },
                          execution: {
                            type: 'limit',
                            max_notional_usd: 100,
                            account_risk_percent: strategy.risk,
                            stop_loss_percent: strategy.stop,
                            take_profit_percent: strategy.target,
                            require_fresh_sources: true,
                          },
                          notes:
                            'Template only. The included runner never submits live orders. Review templates/README.md before integration.',
                        },
                        null,
                        2,
                      ),
                      'application/json',
                    );
                    setNotice(`${exchange.name} ${mode} template downloaded.`);
                  }}
                >
                  <Download size={15} />
                  Download template
                </button>
                <a className="exchange-link" href={exchange.url} target="_blank" rel="noreferrer">
                  Open {exchange.name}
                  <ArrowUpRight size={14} />
                </a>
              </div>
            ))}
          </div>
          <p className="form-status" role="status">
            {notice}
          </p>
        </div>
      </Panel>
      <div className="callout">
        <ShieldCheck size={20} />
        <p>
          Paper trades are local simulations. Exchange templates require a separate, reviewed server
          integration before any real execution. The included service exposes data endpoints only.
        </p>
      </div>
    </div>
  );
}
