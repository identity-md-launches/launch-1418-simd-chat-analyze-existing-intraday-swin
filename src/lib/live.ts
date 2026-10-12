import { useCallback, useEffect, useRef, useState } from 'react';
import type { Asset, Candle, Snapshot, SourceKind } from '../types';

export const MARKET_ENDPOINT = 'wss://ws.kraken.com/v2';
export const HISTORY_ENDPOINT = 'https://api.kraken.com/0/public/OHLC';
export const STREAM_BATCH_MS = 250;
export const MARKET_STALE_MS = 60_000;
const TRANSPORT_STALE_MS = 25_000;
const MAX_RETRIES = 8;
const MAX_CANDLES = 720;
const INTERVAL_SECONDS = 300;

export type MarketStreamStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'paused'
  | 'stale'
  | 'error';
export type MarketStreamState = {
  snapshot: Snapshot | null;
  status: MarketStreamStatus;
  detail: string;
  lastMessageAt: number | null;
  lastMarketAt: number | null;
  /** Local receipt time minus exchange timestamp; includes clock skew, not network RTT. */
  latencyMs: number | null;
  retries: number;
  dropped: number;
  historyStatus: 'loading' | 'ready' | 'unavailable';
};
export type MarketStream = MarketStreamState & {
  paused: boolean;
  reconnect: () => void;
  setPaused: (paused: boolean) => void;
};
export const initialMarketState = (): MarketStreamState => ({
  snapshot: null,
  status: 'idle',
  detail: 'Connect the public market stream. No API key is needed.',
  lastMessageAt: null,
  lastMarketAt: null,
  latencyMs: null,
  retries: 0,
  dropped: 0,
  historyStatus: 'loading',
});

export type MarketSocket = Pick<
  WebSocket,
  'readyState' | 'send' | 'close' | 'onopen' | 'onmessage' | 'onerror' | 'onclose'
>;
type Timer = ReturnType<typeof setTimeout>;
export type StreamDependencies = {
  socket?: (url: string) => MarketSocket;
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
};
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const epoch = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
};
const unavailableSources = () =>
  (['Social', 'News', 'On-chain'] as SourceKind[]).map((kind) => ({
    kind,
    score: null,
    count: 0,
    updatedAt: null,
    status: 'unavailable' as const,
    detail:
      'Market streaming does not include sentiment. Connect your optional source service to enable this source.',
  }));

/** Never copy demo sentiment or restamp a provider's observation time. */
export function mergeMarketSnapshot(market: Snapshot, sentiment: Snapshot | null): Snapshot {
  return sentiment?.asset === market.asset && sentiment.mode === 'live'
    ? { ...market, sources: sentiment.sources, feed: sentiment.feed }
    : market;
}

function validCandle(c: Candle, now: number): boolean {
  return (
    [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) &&
    c.time > 0 &&
    c.time % INTERVAL_SECONDS === 0 &&
    c.time <= now / 1000 + 60 &&
    Math.min(c.open, c.high, c.low, c.close) > 0 &&
    c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) &&
    c.volume >= 0
  );
}

/** REST gives one unfinished candle: exclude it, rather than backtesting its future close. */
export function parseKrakenHistory(value: unknown, now = Date.now()): Candle[] {
  if (!record(value) || !Array.isArray(value.error) || value.error.length || !record(value.result))
    throw new Error('Kraken price history is unavailable.');
  const rows = Object.entries(value.result).filter(([key]) => key !== 'last');
  if (rows.length !== 1 || !Array.isArray(rows[0][1]))
    throw new Error('Kraken returned an unsupported history format.');
  const candles: Candle[] = [];
  for (const row of rows[0][1]) {
    if (
      !Array.isArray(row) ||
      row.length < 8 ||
      row.slice(0, 7).some((v) => v === null || v === '' || typeof v === 'boolean')
    )
      throw new Error('Kraken returned an invalid historical candle.');
    const c: Candle = {
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[6]),
      sentiment: null,
    };
    if (!validCandle(c, now) || (candles.length && c.time <= candles.at(-1)!.time))
      throw new Error('Kraken returned invalid or unordered price history.');
    if ((c.time + INTERVAL_SECONDS) * 1000 <= now) candles.push(c);
  }
  if (!candles.length) throw new Error('No closed candles are available yet.');
  return candles.slice(-MAX_CANDLES);
}

/** Keyless public stream. No account endpoints, credentials, order calls or synthetic fallback. */
export class KrakenMarketStream {
  private state = initialMarketState();
  private readonly socketFactory: (url: string) => MarketSocket;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly schedule: (callback: () => void, delay: number) => Timer;
  private readonly cancel: (timer: Timer) => void;
  private socket: MarketSocket | null = null;
  private timers = new Set<Timer>();
  private batch: Timer | null = null;
  private historyAbort: AbortController | null = null;
  private generation = 0;
  private stopped = true;
  private retryCount = 0;
  private openedAt = 0;
  private lastPing = 0;
  private tickerTime = 0;
  private candles = new Map<number, Candle>();
  private candleVersions = new Map<number, { trades: number; volume: number }>();
  private ticker: { price: number; change: number; volume: number } | null = null;

  constructor(
    readonly asset: Asset,
    private readonly onChange: (state: MarketStreamState) => void,
    dependencies: StreamDependencies = {},
  ) {
    this.socketFactory = dependencies.socket ?? ((url) => new WebSocket(url));
    this.fetcher = dependencies.fetch ?? ((input, init) => fetch(input, init));
    this.now = dependencies.now ?? Date.now;
    this.random = dependencies.random ?? Math.random;
    this.schedule = dependencies.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.cancel = dependencies.cancel ?? ((timer) => clearTimeout(timer));
  }

  getState(): MarketStreamState {
    return this.state;
  }
  start(): void {
    this.stopped = false;
    this.retryCount = 0;
    this.connect();
  }
  reconnect(): void {
    this.start();
  }
  /** Browser lifecycle events retain the retry budget and never bypass backoff. */
  recover(): void {
    if (!this.stopped && this.state.status === 'stale') this.retry('Refreshing the stale market stream.');
  }
  pause(): void {
    this.stopped = true;
    this.cleanup();
    this.patch({ status: 'paused', detail: 'Stream paused. Prices are frozen; signals are held.' }, true);
  }
  destroy(): void {
    this.stopped = true;
    this.cleanup();
  }

  private later(callback: () => void, delay: number): Timer {
    const timer = this.schedule(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
    return timer;
  }
  private cleanup(): void {
    this.generation++;
    for (const timer of this.timers) this.cancel(timer);
    this.timers.clear();
    this.batch = null;
    this.historyAbort?.abort();
    this.historyAbort = null;
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
  }
  private patch(patch: Partial<MarketStreamState>, immediate = false): void {
    this.state = { ...this.state, ...patch };
    if (immediate) {
      if (this.batch !== null) {
        this.cancel(this.batch);
        this.timers.delete(this.batch);
        this.batch = null;
      }
      this.publish();
    } else if (this.batch === null)
      this.batch = this.later(() => {
        this.batch = null;
        this.publish();
      }, STREAM_BATCH_MS);
  }
  private publish(): void {
    const now = this.now();
    const closed = [...this.candles.values()]
      .filter((c) => (c.time + INTERVAL_SECONDS) * 1000 <= now)
      .sort((a, b) => a.time - b.time)
      .slice(-MAX_CANDLES);
    if (this.ticker && this.state.lastMarketAt !== null)
      this.state = {
        ...this.state,
        snapshot: {
          asset: this.asset,
          mode: 'live',
          asOf: this.state.lastMarketAt / 1000,
          ...this.ticker,
          candles: closed,
          sources: unavailableSources(),
          feed: [],
        },
      };
    this.onChange(this.state);
  }
  private connect(): void {
    if (this.stopped) return;
    this.cleanup();
    const generation = this.generation;
    this.candleVersions.clear();
    this.patch(
      {
        status: this.retryCount ? 'reconnecting' : 'connecting',
        detail: `Connecting to ${this.asset}/USD on Kraken…`,
        retries: this.retryCount,
        historyStatus: 'loading',
        lastMessageAt: null,
      },
      true,
    );
    this.loadHistory(generation);
    let socket: MarketSocket;
    try {
      socket = this.socketFactory(MARKET_ENDPOINT);
      this.socket = socket;
    } catch {
      this.retry('Your browser could not open the market stream.');
      return;
    }
    const active = () => !this.stopped && generation === this.generation;
    socket.onopen = () => {
      if (!active()) return;
      this.openedAt = this.now();
      this.lastPing = this.openedAt;
      this.patch({ lastMessageAt: this.openedAt, detail: 'Connected. Waiting for market data…' });
      this.send({
        method: 'subscribe',
        params: { channel: 'ticker', symbol: [`${this.asset}/USD`], snapshot: true, event_trigger: 'trades' },
        req_id: 1,
      });
      this.send({
        method: 'subscribe',
        params: { channel: 'ohlc', symbol: [`${this.asset}/USD`], snapshot: true, interval: 5 },
        req_id: 2,
      });
      this.watch(generation);
    };
    socket.onmessage = (event) => {
      if (active()) this.receive(event.data);
    };
    socket.onerror = () => {
      if (active()) this.retry('The market stream could not be reached.');
    };
    socket.onclose = () => {
      if (active()) this.retry('The market stream disconnected.');
    };
    this.later(() => {
      if (
        active() &&
        (!this.ticker || this.state.status === 'connecting' || this.state.status === 'reconnecting')
      )
        this.retry('Market subscription timed out.');
    }, 15_000);
  }
  private send(message: unknown): void {
    if (this.socket?.readyState !== 1) return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      this.retry('Unable to send to the market stream.');
    }
  }
  private retry(reason: string): void {
    if (this.stopped) return;
    this.cleanup();
    if (this.retryCount >= MAX_RETRIES) {
      this.stopped = true;
      this.patch(
        {
          status: 'error',
          detail: `${reason} Automatic retries stopped after ${MAX_RETRIES} attempts. Check your network and choose Reconnect.`,
          retries: this.retryCount,
        },
        true,
      );
      return;
    }
    this.retryCount++;
    const base = Math.min(30_000, 1_000 * 2 ** (this.retryCount - 1));
    const delay = Math.round(base * (0.8 + this.random() * 0.4));
    this.patch(
      {
        status: 'reconnecting',
        detail: `${reason} Retrying in ${(delay / 1000).toFixed(1)} seconds (${this.retryCount}/${MAX_RETRIES}).`,
        retries: this.retryCount,
      },
      true,
    );
    this.later(() => this.connect(), delay);
  }
  private watch(generation: number): void {
    this.later(() => {
      if (this.stopped || generation !== this.generation) return;
      const now = this.now();
      if (this.state.lastMessageAt !== null && now - this.state.lastMessageAt > TRANSPORT_STALE_MS) {
        this.retry('No heartbeat received for 25 seconds.');
        return;
      }
      if (now - this.lastPing >= 15_000) {
        this.send({ method: 'ping', req_id: 3 });
        this.lastPing = now;
      }
      if (
        this.state.lastMarketAt !== null &&
        now - this.state.lastMarketAt > MARKET_STALE_MS &&
        this.state.status === 'live'
      )
        this.patch(
          {
            status: 'stale',
            detail: 'No recent market trades. Last prices remain visible; signals are held.',
          },
          true,
        );
      if (this.state.status === 'live' && now - this.openedAt > 30_000 && this.retryCount) {
        this.retryCount = 0;
        this.patch({ retries: 0 });
      }
      this.watch(generation);
    }, 2_000);
  }
  private async loadHistory(generation: number): Promise<void> {
    const controller = new AbortController();
    this.historyAbort = controller;
    const timeout = this.later(() => controller.abort(), 12_000);
    try {
      const pair = this.asset === 'BTC' ? 'XBTUSD' : `${this.asset}USD`;
      const response = await this.fetcher(`${HISTORY_ENDPOINT}?pair=${pair}&interval=5`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`History request failed (${response.status}).`);
      const parsed = parseKrakenHistory(await response.json(), this.now());
      if (this.stopped || generation !== this.generation) return;
      // Stream observations received during the request have priority over its older response.
      const combined = new Map(parsed.map((c) => [c.time, c]));
      for (const [time, candle] of this.candles)
        if (this.candleVersions.has(time)) combined.set(time, candle);
      this.candles = combined;
      this.trim();
      this.patch({ historyStatus: 'ready' });
    } catch {
      if (!this.stopped && generation === this.generation) this.patch({ historyStatus: 'unavailable' });
    } finally {
      this.cancel(timeout);
      this.timers.delete(timeout);
    }
  }
  private trim(): void {
    const keys = [...this.candles.keys()].sort((a, b) => a - b);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_CANDLES - 1))) {
      this.candles.delete(key);
      this.candleVersions.delete(key);
    }
  }
  private reject(): void {
    this.patch({ dropped: this.state.dropped + 1 });
  }
  private receive(raw: unknown): void {
    if (typeof raw !== 'string' || raw.length > 1_000_000) {
      this.reject();
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      this.reject();
      return;
    }
    if (!record(message)) {
      this.reject();
      return;
    }
    const now = this.now();
    if (message.channel === 'heartbeat' || message.method === 'pong' || message.channel === 'status') {
      this.patch({ lastMessageAt: now });
      return;
    }
    if (message.method === 'subscribe') {
      if (message.success === false) {
        this.stopped = true;
        this.cleanup();
        this.patch(
          {
            status: 'error',
            detail: `Kraken could not subscribe to ${this.asset}/USD. ${typeof message.error === 'string' ? message.error.slice(0, 180) : 'Select another market or retry later.'}`,
          },
          true,
        );
      } else this.patch({ lastMessageAt: now });
      return;
    }
    if (
      !['ticker', 'ohlc'].includes(String(message.channel)) ||
      !['snapshot', 'update'].includes(String(message.type)) ||
      !Array.isArray(message.data) ||
      message.data.length > 1000
    ) {
      this.reject();
      return;
    }
    for (const item of message.data) {
      if (!record(item) || item.symbol !== `${this.asset}/USD`) {
        this.reject();
        continue;
      }
      if (message.channel === 'ticker') {
        const timestamp = epoch(item.timestamp);
        if (
          !positive(item.last) ||
          !finite(item.change_pct) ||
          !finite(item.volume) ||
          item.volume < 0 ||
          !positive(item.vwap) ||
          !Number.isFinite(item.volume * item.vwap) ||
          timestamp === null ||
          timestamp < this.tickerTime ||
          timestamp > now + 60_000 ||
          now - timestamp > MARKET_STALE_MS
        ) {
          this.reject();
          continue;
        }
        // Equal timestamps are legal at Kraken; arrival order on this socket breaks ties.
        this.tickerTime = timestamp;
        this.ticker = { price: item.last, change: item.change_pct, volume: item.volume * item.vwap };
        this.patch({
          status: 'live',
          detail: `${this.asset}/USD streaming from Kraken. Prices update at most four times per second.`,
          lastMessageAt: now,
          lastMarketAt: timestamp,
          latencyMs: now - timestamp,
        });
      } else {
        const timestamp = epoch(item.interval_begin);
        const candle: Candle = {
          time: (timestamp ?? 0) / 1000,
          open: item.open as number,
          high: item.high as number,
          low: item.low as number,
          close: item.close as number,
          volume: item.volume as number,
          sentiment: null,
        };
        const version = this.candleVersions.get(candle.time);
        if (
          timestamp === null ||
          item.interval !== 5 ||
          !validCandle(candle, now) ||
          !finite(item.trades) ||
          !Number.isInteger(item.trades) ||
          item.trades < 0 ||
          (version && (item.trades < version.trades || candle.volume < version.volume))
        ) {
          this.reject();
          continue;
        }
        // Per-candle cumulative trade/volume counters reject regressive updates without
        // mistaking interval_begin (a candle boundary) for an event timestamp.
        this.candleVersions.set(candle.time, { trades: item.trades, volume: candle.volume });
        this.candles.set(candle.time, candle);
        this.trim();
        this.patch({ lastMessageAt: now });
      }
    }
  }
}

export function useMarketStream(asset: Asset, enabled: boolean): MarketStream {
  const [state, setState] = useState<MarketStreamState>(initialMarketState);
  const [paused, setPaused] = useState(false);
  const client = useRef<KrakenMarketStream | null>(null);
  useEffect(() => {
    if (!enabled) {
      setState(initialMarketState());
      setPaused(false);
      return;
    }
    const next = new KrakenMarketStream(asset, setState);
    client.current = next;
    next.start();
    setPaused(false);
    const visible = () => {
      if (!document.hidden) next.recover();
    };
    const online = () => next.recover();
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', online);
    return () => {
      next.destroy();
      client.current = null;
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', online);
    };
  }, [asset, enabled]);
  const reconnect = useCallback(() => {
    setPaused(false);
    client.current?.reconnect();
  }, []);
  const pause = useCallback((value: boolean) => {
    setPaused(value);
    if (value) client.current?.pause();
    else client.current?.reconnect();
  }, []);
  return { ...state, paused, reconnect, setPaused: pause };
}
