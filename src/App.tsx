import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Activity,
  Bell,
  Radio,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FlaskConical,
  LayoutDashboard,
  Menu,
  Plug,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import Chart, { Sparkline } from './Chart';
import {
  AssetIcon,
  Badge,
  Change,
  DataFooter,
  Feed,
  Gauge,
  Metric,
  Modal,
  Panel,
  SmallLink,
  SourceBars,
  SourceIcon,
  SourceStatus,
} from './components';
import { ASSETS, demoSnapshot } from './lib/data';
import {
  aggregateSentiment,
  compact,
  dateTimeLabel,
  DEFAULT_STRATEGY,
  download,
  evaluate,
  money,
  observationAge,
  sourceFreshness,
  sizePosition,
  timeLabel,
  validateStrategy,
} from './lib/engine';
import { readStored, writeStored } from './lib/storage';
import { validateSnapshot } from './lib/validation';
import { MARKET_STALE_MS, mergeMarketSnapshot, useMarketStream } from './lib/live';
import {
  evaluateProtection,
  loadRiskAccount,
  loadRiskProfile,
  protectedPosition,
  stopPrice,
  type RiskAccount,
  type RiskProfile,
} from './lib/risk';
import AlertCenter from './components/AlertCenter';
import Signals from './pages/Signals';
import Risk from './pages/Risk';
import Backtest, { createBacktestSession } from './pages/Backtest';
import Connections from './pages/Connections';
import Guide from './pages/Guide';
import type { Asset, BacktestSession, Page, PaperOrder, Snapshot, SourceKind, Strategy } from './types';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sentiment', label: 'Sentiment', icon: Activity },
  { id: 'signals', label: 'Trading signals', icon: SlidersHorizontal },
  { id: 'backtest', label: 'Strategy lab', icon: FlaskConical },
  { id: 'risk', label: 'Risk calculator', icon: ShieldCheck },
  { id: 'connections', label: 'Connections', icon: Plug },
] as const;
const TITLES: Record<Page, string> = {
  overview: 'Market overview',
  sentiment: 'Sentiment intelligence',
  signals: 'Trading signals',
  backtest: 'Strategy lab',
  risk: 'Risk calculator',
  connections: 'Connections',
  guide: 'Workspace guide',
};
function getPage(): Page {
  const value = location.hash.slice(1);
  return Object.hasOwn(TITLES, value) ? (value as Page) : 'overview';
}
function isStrategy(value: unknown): value is Strategy {
  if (!value || typeof value !== 'object') return false;
  const s = value as Strategy;
  return (
    typeof s.name === 'string' &&
    !!s.weights &&
    ['Social', 'News', 'On-chain'].every((k) => typeof s.weights[k as SourceKind] === 'number') &&
    !validateStrategy(s)
  );
}
function isOrders(value: unknown): value is PaperOrder[] {
  return (
    Array.isArray(value) &&
    value.length <= 500 &&
    value.every(
      (o) =>
        o &&
        typeof o.id === 'string' &&
        ASSETS.some((a) => a.symbol === o.asset) &&
        ['buy', 'sell'].includes(o.side) &&
        typeof o.exchange === 'string' &&
        [o.time, o.quantity, o.price, o.stop, o.target].every((v) => Number.isFinite(v) && v > 0),
    )
  );
}

export default function App() {
  const [page, setPage] = useState<Page>(getPage),
    [asset, setAsset] = useState<Asset>('BTC'),
    [strategy, setStrategy] = useState(() => readStored('pulse.strategy.v1', DEFAULT_STRATEGY, isStrategy));
  const [mode, setMode] = useState<'demo' | 'live'>('demo'),
    [baseSnapshot, setSnapshot] = useState<Snapshot | null>(() => demoSnapshot('BTC')),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState('');
  const [serviceUrl, setServiceUrl] = useState(() =>
    readStored('pulse.service.v1', '', (v): v is string => typeof v === 'string' && v.length < 2048),
  );
  const [filter, setFilter] = useState<'All sources' | SourceKind>('All sources'),
    [query, setQuery] = useState(''),
    [menu, setMenu] = useState(false),
    [modal, setModal] = useState<'analysis' | 'paper' | 'search' | null>(null),
    [search, setSearch] = useState('');
  const [orders, setOrders] = useState<PaperOrder[]>(() => readStored('pulse.orders.v1', [], isOrders)),
    [orderNote, setOrderNote] = useState('');
  const [serviceEnabled, setServiceEnabled] = useState(false);
  const market = useMarketStream(asset, mode === 'live');
  const snapshot =
    mode === 'demo'
      ? baseSnapshot
      : market.snapshot?.asset === asset
        ? mergeMarketSnapshot(
            market.snapshot,
            baseSnapshot?.mode === 'live' && baseSnapshot.asset === asset ? baseSnapshot : null,
          )
        : null;
  const feedFresh = mode === 'demo' || market.status === 'live';
  const [riskProfile, setRiskProfile] = useState(() => loadRiskProfile(strategy));
  const [riskAccount, setRiskAccount] = useState(loadRiskAccount);
  const protection = evaluateProtection(riskProfile, riskAccount);
  function riskChanged(profile: RiskProfile, account: RiskAccount | null) {
    setRiskProfile(profile);
    setRiskAccount(account);
  }
  const [backtests, setBacktests] = useState<Partial<Record<Asset, BacktestSession>>>({});
  const [, tickFreshness] = useState(0);
  const request = useRef(0),
    controller = useRef<AbortController | null>(null),
    heading = useRef<HTMLHeadingElement>(null),
    hasNavigated = useRef(false);
  const demoMarkets = useMemo(() => ASSETS.map((a) => demoSnapshot(a.symbol)), []);
  useEffect(() => {
    const handle = () => {
      setPage(getPage());
      setMenu(false);
      hasNavigated.current = true;
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, []);
  useEffect(() => {
    if (hasNavigated.current) heading.current?.focus();
  }, [page]);
  useEffect(() => {
    if (page === 'backtest')
      setBacktests((previous) =>
        previous[asset] ? previous : { ...previous, [asset]: createBacktestSession(asset, strategy) },
      );
  }, [page, asset, strategy]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setSearch('');
        setModal('search');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const fetchSnapshot = useCallback(async (url: string, currentAsset: Asset, signal: AbortSignal) => {
    const response = await fetch(`${url.replace(/\/$/, '')}/api/snapshot?asset=${currentAsset}`, { signal });
    if (!response.ok)
      throw new Error(
        response.status === 503
          ? 'Market data is unavailable at the service. Check the exchange connection and retry.'
          : `The service returned ${response.status}. Check its URL and CORS settings, then retry.`,
      );
    const data: unknown = await response.json();
    if (!validateSnapshot(data, currentAsset))
      throw new Error(
        'The service returned an unsupported or invalid data format. Use the included Pulse service.',
      );
    return data;
  }, []);
  const refresh = useCallback(
    async (url = serviceUrl, currentAsset = asset, currentMode = mode) => {
      const id = ++request.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setBusy(true);
      setError('');
      const timer = setTimeout(() => abort.abort(), 20000);
      try {
        const next =
          currentMode === 'demo'
            ? demoSnapshot(currentAsset)
            : await fetchSnapshot(url, currentAsset, abort.signal);
        if (id === request.current) {
          setSnapshot(next);
          setStatus(
            currentMode === 'demo'
              ? `${currentAsset} demo analysis updated.`
              : `${currentAsset} live data refreshed.`,
          );
          return true;
        }
      } catch (e) {
        if (id === request.current) {
          setError(
            (e as Error).name === 'AbortError'
              ? 'The service did not respond in time. Check the URL and retry.'
              : (e as Error).message === 'Failed to fetch'
                ? 'Unable to reach the service. Check the URL, start the service, and allow this site’s origin.'
                : (e as Error).message,
          );
          setSnapshot(null);
        }
      } finally {
        clearTimeout(timer);
        if (id === request.current) setBusy(false);
      }
      return false;
    },
    [asset, mode, serviceUrl, fetchSnapshot],
  );
  useEffect(() => {
    if (mode !== 'live' || !serviceEnabled) return;
    const timer = setInterval(() => {
      if (!document.hidden && !busy) void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [mode, serviceEnabled, refresh, busy]);
  useEffect(() => {
    if (mode !== 'live' && !riskProfile.armed) return;
    const timer = setInterval(() => tickFreshness((value) => value + 1), 10000);
    return () => clearInterval(timer);
  }, [mode, riskProfile.armed]);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  async function selectAsset(next: Asset) {
    if (next === asset) return;
    setAsset(next);
    setSnapshot(null);
    if (mode === 'demo' || serviceEnabled) await refresh(serviceUrl, next, mode);
  }
  async function connect(url: string) {
    setServiceEnabled(true);
    setServiceUrl(url);
    writeStored('pulse.service.v1', url);
    setMode('live');
    setSnapshot(null);
    await refresh(url, asset, 'live');
  }
  function connectMarket() {
    request.current++;
    controller.current?.abort();
    setMode('live');
    setSnapshot(null);
    setServiceEnabled(false);
    setError('');
    setBusy(false);
    market.setPaused(false);
    market.reconnect();
    setStatus('Connecting to Kraken public market data. Sentiment requires an optional service.');
  }
  function useDemo() {
    setServiceEnabled(false);
    request.current++;
    controller.current?.abort();
    setMode('demo');
    setSnapshot(demoSnapshot(asset));
    setError('');
    setBusy(false);
    setStatus('Demo workspace restored. All data is synthetic.');
  }
  function saveStrategy(next: Strategy) {
    setStrategy(next);
    return writeStored('pulse.strategy.v1', next);
  }
  function analyze() {
    if (snapshot) setModal('analysis');
    else if (mode === 'live') {
      market.reconnect();
      setStatus('Reconnecting the market stream.');
    }
  }
  function exportSnapshot() {
    if (snapshot) {
      download(
        `pulse-${asset.toLowerCase()}-snapshot.json`,
        JSON.stringify(
          {
            ...snapshot,
            strategy,
            analysis: result,
            marketFeed:
              mode === 'live'
                ? {
                    status: market.status,
                    lastMarketAt: market.lastMarketAt,
                    historyStatus: market.historyStatus,
                  }
                : null,
          },
          null,
          2,
        ),
        'application/json',
      );
      setStatus('Snapshot downloaded.');
    }
  }
  const rawResult = snapshot ? evaluate(snapshot, strategy) : null;
  const result =
    rawResult && !feedFresh
      ? {
          ...rawResult,
          action: 'Wait' as const,
          reason: 'The market stream is not current. Resume or reconnect before reviewing an entry.',
        }
      : rawResult;
  const sentiment = snapshot ? aggregateSentiment(snapshot, strategy.weights) : null;
  const feed =
    snapshot?.feed.filter(
      (item) =>
        (filter === 'All sources' || item.kind === filter) &&
        `${item.title} ${item.publisher}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const sourceFilter = (
    <div className="source-tabs" aria-label="Filter sentiment sources">
      {(['All sources', 'Social', 'News', 'On-chain'] as const).map((v) => (
        <button
          key={v}
          onClick={() => setFilter(v)}
          aria-pressed={filter === v}
          className={filter === v ? 'active' : ''}
        >
          {v}
        </button>
      ))}
    </div>
  );
  const feedEmpty = mode === 'live' && !serviceEnabled ? 'unconnected'
    : snapshot?.feed.length ? 'filtered' : 'unavailable';
  const navLinks = NAV.map((item) => (
    <a
      key={item.id}
      href={`#${item.id}`}
      onClick={() => setMenu(false)}
      className={page === item.id ? 'nav-link active' : 'nav-link'}
      aria-current={page === item.id ? 'page' : undefined}
    >
      <item.icon size={18} />
      <span>{item.label}</span>
      {item.id === 'signals' && (
        <span className="nav-count">{result?.action === 'Buy' || result?.action === 'Sell' ? '1' : '0'}</span>
      )}
    </a>
  ));
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
          document.getElementById('main')?.scrollIntoView();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <span className="brand-symbol">
            <Activity size={23} strokeWidth={2.3} />
          </span>
          <span>
            pulse<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace-label">SIMD trading workspace</div>
        <nav aria-label="Main navigation">{navLinks}</nav>
        <div className="sidebar-bottom">
          <div className="foundation">
            <span className="foundation-icon">
              <Sparkles size={17} />
            </span>
            <span>Built on Jev-X</span>
          </div>
          <a
            className={`nav-link ${page === 'guide' ? 'active' : ''}`}
            href="#guide"
            aria-current={page === 'guide' ? 'page' : undefined}
          >
            <CircleHelp size={18} />
            Help &amp; guide
            <ArrowUpRight size={14} />
          </a>
          <div className="workspace-profile">
            <span className="profile-mark">P</span>
            <div>
              Personal account<small>Local workspace</small>
            </div>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-leading">
            <button
              className="icon-button mobile-menu-button"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <a className="mobile-brand" href="#overview">
              <Activity size={22} />
              pulse.
            </a>
            <div className="breadcrumb">
              <span>Workspace</span>
              <ChevronRight size={14} />
              <strong>{NAV.find((n) => n.id === page)?.label ?? 'Help & guide'}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="search-button"
              aria-label="Search markets"
              onClick={() => {
                setSearch('');
                setModal('search');
              }}
            >
              <Search size={16} />
              <span>Search markets</span>
              <kbd>/</kbd>
            </button>
            <span className="topbar-divider" />
            <span className="data-mode">
              <span
                className={`status-dot ${mode === 'demo' ? 'demo' : market.status !== 'live' ? 'error' : ''}`}
              />
              {mode === 'demo'
                ? 'Demo mode'
                : market.status === 'live'
                  ? 'Live stream'
                  : market.status === 'paused'
                    ? 'Paused'
                    : market.status === 'stale'
                      ? 'Stale feed'
                      : market.status === 'error'
                        ? 'Disconnected'
                        : 'Connecting'}
            </span>
            <a href="#signals" className="icon-button alert-shortcut" aria-label="Review signals and alerts">
              <Bell size={18} />
            </a>
            <span className="avatar" aria-label="Personal workspace">
              P
            </span>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <h1 ref={heading} tabIndex={-1}>
                {TITLES[page]}
              </h1>
              {page === 'overview' && (
                <p className="page-description">Your intraday and swing trading workspace.</p>
              )}
            </div>
            <div className="page-actions">
              {page !== 'connections' && page !== 'guide' && (
                <>
                  <button
                    className="button secondary export-button"
                    disabled={!snapshot}
                    onClick={exportSnapshot}
                  >
                    <ArrowDownToLine size={16} />
                    Export
                  </button>
                  <button
                    key={page}
                    className={`button ${page === 'overview' || page === 'sentiment' ? 'primary' : 'secondary'}`}
                    onClick={analyze}
                    disabled={!snapshot && mode === 'demo'}
                  >
                    <ChartNoAxesCombined size={16} />
                    {!snapshot && mode === 'live' ? 'Reconnect stream' : 'Analyze market'}
                  </button>
                </>
              )}
            </div>
          </div>
          {mode === 'demo' && (
            <div className="demo-banner">
              <span>
                <span className="status-dot demo" />
                Demo workspace <span className="banner-secondary">· Synthetic market data, May 18, 2026</span>
              </span>
              <a href="#connections">
                Connect live data
                <ArrowRight size={13} />
              </a>
            </div>
          )}
          {mode === 'live' && (
            <div className={`live-banner ${feedFresh ? '' : 'feed-interrupted'}`}>
              <div>
                <Radio size={16} />
                <span>
                  <strong>
                    {market.status === 'live'
                      ? 'Kraken market stream'
                      : market.status === 'paused'
                        ? 'Market stream paused'
                        : market.status === 'stale'
                          ? 'Market data is stale'
                          : market.status === 'error'
                            ? 'Market stream disconnected'
                            : 'Connecting market stream'}
                  </strong>
                  <span className="stream-detail">
                    {market.lastMarketAt
                      ? `Last price ${timeLabel(market.lastMarketAt / 1000)} UTC`
                      : market.detail}
                    {serviceEnabled ? ' · Sentiment refresh: 30s' : ' · Price data only'}
                  </span>
                </span>
              </div>
              <div className="button-row">
                <button
                  className="text-button"
                  onClick={() => {
                    market.setPaused(!market.paused);
                  }}
                >
                  {market.paused ? 'Resume stream' : 'Pause stream'}
                </button>
                {!feedFresh && !market.paused && (
                  <button className="text-button" onClick={market.reconnect}>
                    Reconnect
                  </button>
                )}
                <a className="text-link" href="#connections">
                  Feed details
                  <ArrowRight size={13} />
                </a>
              </div>
            </div>
          )}
          {error && page !== 'connections' && (
            <div className="error-banner" role="alert">
              <p>{error}</p>
              <div className="button-row">
                <button className="button secondary" onClick={() => void refresh()} disabled={busy}>
                  Retry connection
                </button>
                <button className="button secondary" onClick={useDemo}>
                  Use demo data
                </button>
              </div>
            </div>
          )}
          {!snapshot && !['connections', 'guide'].includes(page) && (
            <Panel>
              <div className="empty-state">
                <Plug size={30} />
                <h2>
                  {mode === 'live' && ['connecting', 'reconnecting'].includes(market.status)
                    ? 'Connecting to the market…'
                    : 'Live data is unavailable'}
                </h2>
                <p>
                  {mode === 'live' && ['connecting', 'reconnecting'].includes(market.status)
                    ? market.detail
                    : 'Open Connections to retry the stream or return to the demo workspace.'}
                </p>
                <a className="button secondary" href="#connections">
                  Open Connections
                </a>
              </div>
            </Panel>
          )}
          {page === 'overview' && snapshot && (
            <>
              <div className="decision-strip">
                <a href="#signals" className="decision-item">
                  <span>
                    <Activity size={15} />
                    Current decision
                  </span>
                  <strong
                    className={
                      result!.action === 'Sell'
                        ? 'negative-text'
                        : ['Hold', 'Wait'].includes(result!.action)
                          ? 'warning-text'
                          : 'positive-text'
                    }
                  >
                    {result!.action === 'Buy'
                      ? 'Entry signal'
                      : result!.action === 'Sell'
                        ? 'Exit signal'
                        : result!.action === 'Wait'
                          ? 'Waiting for data'
                          : 'No entry signal'}
                    <ArrowUpRight size={16} />
                  </strong>
                  <small>
                    {asset}/USD · {mode === 'demo' ? 'Synthetic demo' : 'Live research'}
                  </small>
                </a>
                <div className="decision-item">
                  <span>
                    <ChartNoAxesCombined size={15} />
                    Volatility regime
                  </span>
                  <strong>
                    {result!.regime}
                    <span className="adaptive-label">
                      {strategy.adaptive === false ? 'Fixed RSI' : 'Adaptive'}
                    </span>
                  </strong>
                  <small>
                    ATR (14) {result!.atr == null ? 'warming up' : money(result!.atr)} · 5m candles
                  </small>
                </div>
                <a href="#risk" className="decision-item">
                  <span>
                    <ShieldCheck size={15} />
                    Paper protection
                  </span>
                  <strong>
                    {protection.status === 'armed'
                      ? 'Armed'
                      : protection.status === 'off'
                        ? 'Not armed'
                        : 'Entries paused'}
                    <ArrowUpRight size={16} />
                  </strong>
                  <small>
                    {protection.status === 'off'
                      ? 'Set your stop and loss limits'
                      : `Drawdown ${protection.drawdownPct.toFixed(2)}% / ${riskProfile.maxDrawdownPct}%`}
                  </small>
                </a>
              </div>
              <div className="market-strip">
                {(mode === 'demo' ? demoMarkets : [snapshot]).map((m) => {
                  const spec = ASSETS.find((a) => a.symbol === m.asset)!;
                  return (
                    <button
                      key={m.asset}
                      className={`market-card ${asset === m.asset ? 'active' : ''}`}
                      onClick={() => void selectAsset(m.asset)}
                      aria-pressed={asset === m.asset}
                    >
                      <div className="market-card-top">
                        <AssetIcon asset={m.asset} small />
                        <strong>
                          {m.asset}
                          <span> / USD</span>
                        </strong>
                        <span className="market-name">{spec.name}</span>
                        {asset === m.asset && <span className="selected-market" />}
                      </div>
                      <div className="market-card-bottom">
                        <div>
                          <span className="market-price">{money(m.price)}</span>
                          <Change value={m.change} />
                        </div>
                        <Sparkline
                          values={m.candles.slice(-36).map((c) => c.close)}
                          positive={m.change >= 0}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="dashboard-grid">
                <Panel className="price-panel">
                  <div className="price-panel-head">
                    <div className="asset-heading">
                      <AssetIcon asset={asset} />
                      <div>
                        <label className="asset-select-label">
                          <span className="sr-only">Chart asset</span>
                          <select value={asset} onChange={(e) => void selectAsset(e.target.value as Asset)}>
                            {ASSETS.map((a) => (
                              <option key={a.symbol} value={a.symbol}>
                                {a.name} / USD
                              </option>
                            ))}
                          </select>
                        </label>
                        <span className="muted small-text">{asset} · Spot market</span>
                      </div>
                    </div>
                    <div className="current-price">
                      <strong>{money(snapshot.price)}</strong>
                      <Change value={snapshot.change} />
                    </div>
                    <div className="volume-stat">
                      <span>24h volume</span>
                      <strong>${compact(snapshot.volume)}</strong>
                    </div>
                  </div>
                  <Chart candles={snapshot.candles} asset={asset} />
                  <div className="chart-caption">
                    <span>Price action · UTC</span>
                    <span>
                      {snapshot.mode === 'demo' ? 'Synthetic market' : 'Kraken WebSocket · closed bars'}
                    </span>
                  </div>
                </Panel>
                <Panel
                  title="Your trading signal"
                  action={<Badge tone="accent">Custom strategy</Badge>}
                  className="signal-panel"
                >
                  <div className="signal-body">
                    <div className="signal-summary">
                      <div className={`signal-icon ${result!.action.toLowerCase()}`}>
                        <ArrowUpRight size={24} />
                      </div>
                      <div>
                        <strong>
                          {result!.action === 'Buy'
                            ? 'Buy signal'
                            : result!.action === 'Sell'
                              ? 'Sell signal'
                              : result!.action === 'Wait'
                                ? 'Wait for data'
                                : 'Hold position'}
                        </strong>
                        <span>
                          {asset}/USD · {strategy.name}
                        </span>
                      </div>
                    </div>
                    <p>{result!.reason}</p>
                    <dl className="signal-details">
                      <div>
                        <dt>Sentiment score</dt>
                        <dd>
                          {result!.score ?? '—'} <span>/ 100</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Buy threshold</dt>
                        <dd>≥ {strategy.buy}</dd>
                      </div>
                      <div>
                        <dt>
                          {strategy.adaptive === false ? 'RSI (14)' : `Adaptive RSI (${result!.rsiPeriod})`}
                        </dt>
                        <dd>
                          {result!.rsi?.toFixed(1) ?? '—'} <span>/ {strategy.maxRsi} ceiling</span>
                        </dd>
                      </div>
                    </dl>
                    <button
                      className="button secondary full-width"
                      onClick={() => {
                        setOrderNote('');
                        setModal('paper');
                      }}
                    >
                      Review paper trade
                      <ArrowRight size={16} />
                    </button>
                    <a className="signal-config" href="#signals">
                      <SlidersHorizontal size={14} />
                      Configure signal rules
                    </a>
                  </div>
                </Panel>
                <Panel
                  title="Sentiment feed"
                  subtitle="The conversation behind the movement."
                  action={<SmallLink href="#sentiment">View all</SmallLink>}
                  className="feed-panel"
                >
                  {sourceFilter}
                  <Feed items={feed} asOf={snapshot.asOf} limit={3} empty={feedEmpty} />
                </Panel>
                <Panel
                  title="Market sentiment"
                  action={
                    <a className="icon-button" href="#sentiment" aria-label="Explore sentiment sources">
                      <ArrowUpRight size={17} />
                    </a>
                  }
                  className="sentiment-panel"
                >
                  <div className="sentiment-summary">
                    <Gauge score={sentiment!.score} />
                    <p className="sentiment-context">
                      {sentiment!.complete
                        ? 'A combined view of your enabled sources'
                        : 'Some enabled sources are unavailable'}
                    </p>
                    <SourceBars sources={snapshot.sources} />
                    <div className="sentiment-foot">
                      <span>
                        <span className="status-dot" />
                        {sentiment!.covered} of {sentiment!.requested} sources ready
                      </span>
                      <a href="#signals" aria-label="Configure sentiment source weights">
                        <Settings2 size={15} />
                      </a>
                    </div>
                  </div>
                </Panel>
              </div>
              <div className="overview-bottom">
                <span>
                  <ShieldCheck size={15} />
                  Research and paper trading. No real orders are placed.
                </span>
                <a href="#backtest">
                  Test your strategy
                  <ArrowRight size={14} />
                </a>
              </div>
            </>
          )}
          {page === 'sentiment' && snapshot && (
            <>
              <div className="sentiment-metrics">
                <Metric
                  label="Aggregated sentiment"
                  value={`${sentiment!.score ?? '—'} / 100`}
                  detail={`${sentiment!.covered} of ${sentiment!.requested} enabled sources`}
                  icon={<Activity size={17} />}
                />
                {snapshot.sources.map((s) => (
                  <Metric
                    key={s.kind}
                    label={`${s.kind} sentiment`}
                    value={s.score ?? '—'}
                    detail={`${sourceFreshness(s, snapshot.asOf) === 'stale' ? `Stale · ${observationAge(s.updatedAt, snapshot.asOf)} · ` : ''}${compact(s.count)} ${s.kind === 'Social' ? 'posts' : s.kind === 'News' ? 'headlines' : 'observations'}`}
                    icon={<SourceIcon kind={s.kind} />}
                  />
                ))}
              </div>
              <Panel
                title="Source activity"
                subtitle="Inspect the evidence behind the aggregated score."
                action={
                  <label className="feed-search">
                    <Search size={15} />
                    <span className="sr-only">Search sentiment activity</span>
                    <input
                      placeholder="Search activity…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                }
              >
                {sourceFilter}
                <Feed items={feed} asOf={snapshot.asOf} empty={feedEmpty} />
                {!feed.length && !!snapshot.feed.length && (filter !== 'All sources' || query !== '') && (
                  <div className="empty-action">
                    <button
                      className="button secondary"
                      onClick={() => {
                        setQuery('');
                        setFilter('All sources');
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
                <DataFooter
                  demo={mode === 'demo'}
                  asOf={snapshot.asOf}
                  count={snapshot.sources.reduce((sum, s) => sum + s.count, 0)}
                />
              </Panel>
              <div className="source-detail-grid">
                {snapshot.sources.map((s) => (
                  <Panel
                    key={s.kind}
                    title={s.kind}
                    action={
                      <SourceStatus source={s} asOf={snapshot.asOf} demo={mode === 'demo'} />
                    }
                  >
                    <div className="padded">
                      <p>{s.detail}</p>
                      <dl className="detail-list">
                        <div>
                          <dt>Source weight</dt>
                          <dd>{strategy.weights[s.kind]}</dd>
                        </div>
                        <div>
                          <dt>Last observation</dt>
                          <dd>{s.updatedAt !== null ? `${dateTimeLabel(s.updatedAt)} (${observationAge(s.updatedAt, snapshot.asOf)})` : 'Unavailable'}</dd>
                        </div>
                      </dl>
                    </div>
                  </Panel>
                ))}
              </div>
            </>
          )}
          {page === 'signals' && snapshot && (
            <>
              <Signals
                feedFresh={feedFresh}
                snapshot={snapshot}
                strategy={strategy}
                onSave={saveStrategy}
                onReview={() => {
                  setOrderNote('');
                  setModal('paper');
                }}
              />
              <Panel
                title="Paper order journal"
                className="ledger"
                action={
                  orders.length > 0 ? (
                    <button
                      className="button secondary"
                      onClick={() =>
                        download(
                          'pulse-paper-orders.json',
                          JSON.stringify(orders, null, 2),
                          'application/json',
                        )
                      }
                    >
                      <ArrowDownToLine size={15} />
                      Export journal
                    </button>
                  ) : undefined
                }
              >
                {orders.length ? (
                  <div className="table-scroll" tabIndex={0} role="region" aria-label="Paper order journal">
                    <table>
                      <thead>
                        <tr>
                          <th>Time (UTC)</th>
                          <th>Market</th>
                          <th>Side</th>
                          <th>Quantity</th>
                          <th>Price</th>
                          <th>Venue</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.id}>
                            <td>{timeLabel(o.time)}</td>
                            <td>{o.asset}/USD</td>
                            <td>{o.side === 'buy' ? 'Buy' : 'Sell'}</td>
                            <td>{o.quantity.toFixed(6)}</td>
                            <td>{money(o.price)}</td>
                            <td>{o.exchange}</td>
                            <td>
                              <Badge>Paper only</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <h3>Your first paper trade starts here</h3>
                    <p>Review a signal and record a simulated order to build a decision journal.</p>
                    <button className="button secondary" onClick={() => setModal('paper')}>
                      Review paper trade
                    </button>
                  </div>
                )}
              </Panel>
            </>
          )}
          {page === 'risk' && snapshot && (
            <Risk
              key={asset}
              snapshot={snapshot}
              strategy={strategy}
              initialProfile={riskProfile}
              initialAccount={riskAccount}
              onRiskChange={riskChanged}
            />
          )}
          {page === 'backtest' && snapshot && backtests[asset] && (
            <Backtest
              key={asset}
              snapshot={snapshot}
              strategy={strategy}
              serviceUrl={serviceUrl}
              session={backtests[asset]}
              onChange={(patch) =>
                setBacktests((previous) => ({ ...previous, [asset]: { ...previous[asset]!, ...patch } }))
              }
            />
          )}
          {page === 'connections' && (
            <Connections
              snapshot={snapshot}
              strategy={strategy}
              serviceUrl={serviceUrl}
              onConnect={connect}
              onDemo={useDemo}
              onMarketConnect={connectMarket}
              market={market}
              busy={busy}
              connectionError={error}
            />
          )}
          <div
            hidden={page !== 'overview' && page !== 'signals'}
            className="alerts-section"
            id="signal-alerts"
          >
            <AlertCenter
              snapshot={snapshot}
              strategy={strategy}
              feedFresh={feedFresh}
              protection={protection}
            />
          </div>
          {page === 'guide' && <Guide />}
          <footer className="site-footer">
            <span>
              Pulse <span className="footer-dot">·</span> Personal trading intelligence
            </span>
            <span>
              Built on{' '}
              <a
                href="https://github.com/brainstormity/Jev-X-Sentiment-Analysis"
                target="_blank"
                rel="noreferrer"
              >
                Jev-X
              </a>
              <span className="footer-dot">·</span>
              <a href="#guide">Workspace guide</a>
            </span>
          </footer>
          <div className="sr-only" role="status">
            {status}
          </div>
        </main>
      </div>
      {menu && (
        <Modal title="Navigate your workspace" onClose={() => setMenu(false)}>
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {navLinks}
            <a className="nav-link" href="#guide" onClick={() => setMenu(false)}>
              <BookOpen size={18} />
              Help &amp; guide
            </a>
          </nav>
        </Modal>
      )}
      {modal === 'search' && (
        <Modal title="Find a market" onClose={() => setModal(null)}>
          <div className="search-modal">
            <label>
              Search assets
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Bitcoin, ETH, Solana…"
              />
            </label>
            <div className="search-results">
              {ASSETS.filter((a) => `${a.symbol} ${a.name}`.toLowerCase().includes(search.toLowerCase())).map(
                (a) => (
                  <button
                    key={a.symbol}
                    onClick={() => {
                      void selectAsset(a.symbol);
                      location.hash = 'overview';
                      setModal(null);
                    }}
                  >
                    <AssetIcon asset={a.symbol} />
                    <span>
                      <strong>{a.name}</strong>
                      <small>{a.symbol}/USD</small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                ),
              )}
              {!ASSETS.some((a) => `${a.symbol} ${a.name}`.toLowerCase().includes(search.toLowerCase())) && (
                <p className="empty-state">No assets match “{search}”. Try BTC, ETH, SOL, or BNB.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
      {modal === 'analysis' && snapshot && result && (
        <Modal title={`${asset} market analysis`} onClose={() => setModal(null)}>
          <div className="padded analysis-modal">
            <div className="analysis-title">
              <Badge tone="accent">Rules-based analysis</Badge>
              <Badge tone={mode === 'demo' ? 'warning' : 'positive'}>
                {mode === 'demo' ? 'Synthetic demo' : 'Live market'}
              </Badge>
            </div>
            <div className={`analysis-action ${result.action.toLowerCase()}`}>{result.action}</div>
            <p>{result.reason}</p>
            <SourceBars sources={snapshot.sources} />
            <dl className="detail-list">
              <div>
                <dt>Price</dt>
                <dd>{money(snapshot.price)}</dd>
              </div>
              <div>
                <dt>Aggregated sentiment</dt>
                <dd>{result.score ?? '—'} / 100</dd>
              </div>
              <div>
                <dt>{strategy.adaptive === false ? 'RSI (14)' : `Adaptive RSI (${result!.rsiPeriod})`}</dt>
                <dd>{result.rsi?.toFixed(2) ?? '—'}</dd>
              </div>
              <div>
                <dt>Source coverage</dt>
                <dd>
                  {result.covered} / {result.requested}
                </dd>
              </div>
            </dl>
            <p className="muted small-text">
              This decision uses your saved thresholds and source weights. A sentiment score is not a
              confidence probability.
            </p>
            <div className="button-row">
              <button
                className="button primary"
                onClick={() => {
                  setOrderNote('');
                  setModal('paper');
                }}
              >
                Review paper trade
                <ArrowRight size={16} />
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setModal(null);
                  location.hash = 'signals';
                }}
              >
                Edit rules
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === 'paper' && snapshot && (
        <PaperTrade
          snapshot={snapshot}
          strategy={strategy}
          riskProfile={riskProfile}
          riskAccount={riskAccount}
          feedFresh={feedFresh}
          note={orderNote}
          onClose={() => setModal(null)}
          onSave={(order) => {
            const next = [order, ...orders].slice(0, 500);
            setOrders(next);
            const persisted = writeStored('pulse.orders.v1', next);
            setOrderNote(
              persisted
                ? 'Paper order recorded in your journal. No real order was sent.'
                : 'Paper order recorded for this session. Browser storage is unavailable.',
            );
          }}
        />
      )}
    </div>
  );
}

function PaperTrade({
  snapshot,
  strategy,
  riskProfile,
  riskAccount,
  feedFresh,
  note,
  onSave,
  onClose,
}: {
  snapshot: Snapshot;
  strategy: Strategy;
  riskProfile: RiskProfile;
  riskAccount: RiskAccount | null;
  feedFresh: boolean;
  note: string;
  onSave: (order: PaperOrder) => void;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState('0.01'),
    [side, setSide] = useState<'buy' | 'sell'>('buy'),
    [exchange, setExchange] = useState('Kraken'),
    [error, setError] = useState(''),
    [checked, setChecked] = useState(false);
  const protection = evaluateProtection(riskProfile, riskAccount);
  let stop = 0,
    stopError = '';
  try {
    stop = stopPrice(riskProfile, snapshot.price, side, snapshot.candles);
  } catch (e) {
    stopError = (e as Error).message;
  }
  const target = snapshot.price * (1 + ((side === 'buy' ? 1 : -1) * strategy.target) / 100);
  let maxQuantity: number | null = null;
  if (riskProfile.armed && riskAccount && protection.canEnter && stop > 0) {
    try {
      maxQuantity = protectedPosition(
        riskProfile,
        riskAccount,
        riskAccount.equity,
        snapshot.price,
        stop,
        target,
        side,
      ).quantity;
    } catch (e) {
      stopError = (e as Error).message;
    }
  }
  const targetValid = Number.isFinite(target) && target > 0;
  if (!targetValid)
    stopError =
      'Use a take-profit percentage below 100% for a short position. Edit the strategy, then review again.';
  const formatCap = (value: number) => (Math.floor(value * 1e8) / 1e8).toFixed(8);
  const recoveryHref = !feedFresh ? '#connections' : !targetValid ? '#signals' : '#risk';
  const recoveryLabel = !feedFresh
    ? 'Review the feed connection'
    : !targetValid
      ? 'Edit signal rules'
      : 'Review protection settings';
  const blockedReason = !feedFresh
    ? 'The market feed is not current. Resume or reconnect it before recording a paper entry.'
    : !protection.canEnter
      ? protection.reason
      : stopError;
  function submit(e: FormEvent) {
    e.preventDefault();
    const currentProtection = evaluateProtection(riskProfile, riskAccount);
    const currentFeedFresh =
      feedFresh && (snapshot.mode === 'demo' || Date.now() - snapshot.asOf * 1000 <= MARKET_STALE_MS);
    if (!currentFeedFresh) {
      setError('The market price is no longer current. Resume or reconnect before recording a paper entry.');
      return;
    }
    if (!currentProtection.canEnter) {
      setError(currentProtection.reason);
      return;
    }
    if (stopError || blockedReason) {
      setError(stopError || blockedReason);
      return;
    }
    if (
      !Number.isFinite(+quantity) ||
      +quantity <= 0 ||
      +quantity > 1000000 ||
      !Number.isFinite(snapshot.price * +quantity)
    ) {
      setError('Enter a quantity above zero and at most 1,000,000 with a finite notional.');
      return;
    }
    if (riskProfile.armed && riskAccount) {
      try {
        const maximum = protectedPosition(
          riskProfile,
          riskAccount,
          riskAccount.equity,
          snapshot.price,
          stop,
          target,
          side,
        ).quantity;
        if (+quantity > maximum) {
          setError(`Reduce quantity to ${formatCap(maximum)} or less to stay within your paper risk budget.`);
          return;
        }
      } catch (issue) {
        setError((issue as Error).message);
        return;
      }
    }
    if (!checked) {
      setError('Confirm that you understand this is a paper order.');
      return;
    }
    onSave({
      id: crypto.randomUUID(),
      time: Date.now() / 1000,
      asset: snapshot.asset,
      exchange,
      side,
      quantity: +quantity,
      price: snapshot.price,
      stop,
      target,
    });
  }
  return (
    <Modal title="Review paper trade" onClose={onClose}>
      {note ? (
        <div className="empty-state order-success">
          <span className="success-icon">
            <Check size={28} />
          </span>
          <h3>Paper order recorded</h3>
          <p role="status">{note}</p>
          <button
            className="button primary"
            onClick={() => {
              onClose();
              location.hash = 'signals';
            }}
          >
            View paper journal
            <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <form className="form-stack" onSubmit={submit}>
          <div className="paper-market">
            <AssetIcon asset={snapshot.asset} />
            <div>
              <strong>{snapshot.asset}/USD</strong>
              <span>{money(snapshot.price)}</span>
            </div>
            <Badge tone="warning">Paper only</Badge>
          </div>
          <div className="field-grid">
            <label>
              Side
              <select value={side} onChange={(e) => setSide(e.target.value as 'buy' | 'sell')}>
                <option value="buy">Buy / long</option>
                <option value="sell">Sell / short</option>
              </select>
            </label>
            <label>
              Planned exchange
              <select value={exchange} onChange={(e) => setExchange(e.target.value)}>
                <option>Kraken</option>
                <option>Binance</option>
                <option>Coinbase</option>
              </select>
            </label>
          </div>
          <label>
            Quantity ({snapshot.asset})
            <input
              id="paper-quantity"
              aria-invalid={error.startsWith('Enter a quantity') || error.startsWith('Reduce quantity')}
              aria-describedby={error ? 'paper-order-error' : undefined}
              type="number"
              min="0.000001"
              max="1000000"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </label>
          <dl className="detail-list">
            <div>
              <dt>Estimated notional</dt>
              <dd>{money(snapshot.price * (+quantity || 0))}</dd>
            </div>
            <div>
              <dt>Planned stop</dt>
              <dd>{stop > 0 ? money(stop) : 'Unavailable'}</dd>
            </div>
            <div>
              <dt>Planned target</dt>
              <dd>{money(target)}</dd>
            </div>
          </dl>
          <p className="paper-protection-note">
            <ShieldCheck size={15} />
            {riskProfile.armed
              ? `Paper safeguards armed · Maximum quantity ${maxQuantity === null ? 'unavailable' : formatCap(maxQuantity)}`
              : `Paper safeguards off · ${riskProfile.stopMode === 'trailing' ? 'Initial trailing' : riskProfile.stopMode.toUpperCase()} stop`}
          </p>
          {blockedReason && (
            <p className="form-error" role="alert">
              {blockedReason}{' '}
              <a href={recoveryHref} onClick={onClose}>
                {recoveryLabel}
              </a>
              .
            </p>
          )}
          <p className="muted small-text">
            A simulated fill at the displayed {snapshot.mode === 'demo' ? 'demo' : 'snapshot'} price. Fees,
            liquidity and exchange availability are not checked. Stops are planned levels; journal entries do
            not track subsequent exits.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              required
            />
            I understand this records a paper order only.
          </label>
          {error && (
            <p id="paper-order-error" role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="button primary full-width" type="submit" disabled={!!blockedReason}>
            Record paper order
            <ArrowRight size={16} />
          </button>
        </form>
      )}
    </Modal>
  );
}
