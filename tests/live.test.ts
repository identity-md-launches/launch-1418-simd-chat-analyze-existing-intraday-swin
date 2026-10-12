import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { KrakenMarketStream, mergeMarketSnapshot, parseKrakenHistory, STREAM_BATCH_MS, type MarketSocket, type MarketStreamState } from '../src/lib/live';
import { demoSnapshot } from '../src/lib/data';

const START = Date.parse('2026-10-12T12:42:00Z');
class MockSocket implements MarketSocket {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: WebSocket['onopen'] = null;
  onmessage: WebSocket['onmessage'] = null;
  onerror: WebSocket['onerror'] = null;
  onclose: WebSocket['onclose'] = null;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) { this.sent.push(JSON.parse(String(data))); }
  close() { this.readyState = 3; this.closed = true; }
  open() { this.readyState = 1; this.onopen?.call(this as unknown as WebSocket, new Event('open')); }
  message(data: unknown) { this.onmessage?.call(this as unknown as WebSocket, new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) })); }
  fail() { this.onerror?.call(this as unknown as WebSocket, new Event('error')); }
}
function fixture(fetcher?: typeof fetch) {
  let now = START, id = 0;
  const jobs = new Map<number, { due: number; callback: () => void }>();
  const sockets: MockSocket[] = [], states: MarketStreamState[] = [];
  const client = new KrakenMarketStream('BTC', state => states.push(state), {
    socket: () => { const socket = new MockSocket(); sockets.push(socket); return socket; },
    fetch: fetcher ?? (async () => new Response('{}', { status: 503 })),
    now: () => now,
    random: () => .5,
    schedule: (callback, delay) => { jobs.set(++id, { due: now + delay, callback }); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel: timer => { jobs.delete(timer as unknown as number); },
  });
  const advance = (ms: number) => {
    const target = now + ms;
    while (true) {
      const next = [...jobs].sort((a, b) => a[1].due - b[1].due).find(([, job]) => job.due <= target);
      if (!next) break;
      now = next[1].due; jobs.delete(next[0]); next[1].callback();
    }
    now = target;
  };
  return { client, sockets, states, advance, jobs, now: () => now };
}
const ticker = (at = START, price = 100, patch = {}) => ({ channel: 'ticker', type: 'update', data: [{ symbol: 'BTC/USD', last: price, change_pct: 2, volume: 10, vwap: 99, timestamp: new Date(at).toISOString(), ...patch }] });
const ohlc = (time = Date.parse('2026-10-12T12:35:00Z'), patch = {}) => ({ channel: 'ohlc', type: 'update', data: [{ symbol: 'BTC/USD', interval: 5, interval_begin: new Date(time).toISOString(), open: 99, high: 103, low: 98, close: 100, volume: 8, trades: 20, ...patch }] });

test('WebSocket subscribes once per channel and coalesces a burst into the newest market snapshot', () => {
  const f = fixture(); f.client.start(); const socket = f.sockets[0]; socket.open();
  assert.deepEqual(socket.sent.map(m => (m.params as { channel: string }).channel), ['ticker', 'ohlc']);
  const before = f.states.length;
  socket.message(ohlc());
  for (let i = 0; i < 100; i++) socket.message(ticker(START, 100 + i));
  assert.equal(f.states.length, before);
  f.advance(STREAM_BATCH_MS);
  assert.equal(f.states.length, before + 1);
  const state = f.states.at(-1)!;
  assert.equal(state.snapshot?.price, 199);
  assert.equal(state.snapshot?.volume, 990);
  assert.equal(state.snapshot?.candles.length, 1);
  assert.equal(state.status, 'live');
  assert.ok(state.snapshot?.sources.every(s => s.status === 'unavailable' && s.score === null));
  f.client.destroy();
});

test('Wrong market, malformed, future, stale and out-of-order tickers cannot replace a valid quote', () => {
  const f = fixture(); f.client.start(); const socket = f.sockets[0]; socket.open();
  socket.message(ticker());
  socket.message('not json');
  socket.message(ticker(START, 200, { symbol: 'ETH/USD' }));
  socket.message(ticker(START - 1, 300));
  socket.message(ticker(START + 61_000, 400));
  socket.message(ticker(START - 61_000, 500));
  socket.message(ticker(START, 600, { vwap: -1 }));
  f.advance(STREAM_BATCH_MS);
  assert.equal(f.client.getState().snapshot?.price, 100);
  assert.equal(f.client.getState().dropped, 6);
  // Identical timestamps are legal and must not drop a genuine later value.
  socket.message(ticker(START, 101)); f.advance(STREAM_BATCH_MS);
  assert.equal(f.client.getState().snapshot?.price, 101);
  f.client.destroy();
});

test('Closed candles reject regressive cumulative counters and never include the unfinished interval', () => {
  const f = fixture(); f.client.start(); const socket = f.sockets[0]; socket.open(); socket.message(ticker());
  socket.message(ohlc());
  socket.message(ohlc(undefined, { close: 99, trades: 19 }));
  socket.message(ohlc(undefined, { volume: 7, trades: 21 }));
  socket.message(ohlc(Date.parse('2026-10-12T12:40:00Z')));
  f.advance(STREAM_BATCH_MS);
  assert.equal(f.client.getState().snapshot?.candles.length, 1);
  assert.equal(f.client.getState().snapshot?.candles[0].close, 100);
  assert.equal(f.client.getState().dropped, 2);
  f.client.destroy();
});

test('History validates order/OHLC and excludes incomplete final bars', () => {
  const t = Date.parse('2026-10-12T12:35:00Z') / 1000;
  const rows = [[t, '99', '103', '98', '100', '99', '8', 20], [t + 300, '99', '103', '98', '100', '99', '8', 20]];
  const payload = (data: unknown) => ({ error: [], result: { XXBTZUSD: data, last: t } });
  assert.equal(parseKrakenHistory(payload(rows), START).length, 1);
  assert.throws(() => parseKrakenHistory(payload([rows[0], rows[0]]), START), /unordered/);
  assert.throws(() => parseKrakenHistory(payload([[t, '99', '90', '98', '100', '99', '8', 20]]), START), /invalid/);
  assert.throws(() => parseKrakenHistory({ error: ['EQuery:Unknown asset pair'] }, START), /unavailable/);
});

test('Late history response hydrates older bars without overwriting a newer stream candle', async () => {
  let resolve!: (value: Response) => void;
  const response = new Promise<Response>(done => { resolve = done; });
  const f = fixture(async () => response); f.client.start(); const socket = f.sockets[0]; socket.open();
  socket.message(ticker()); socket.message(ohlc(undefined, { close: 102, trades: 30 }));
  const t = Date.parse('2026-10-12T12:30:00Z') / 1000;
  resolve(new Response(JSON.stringify({ error: [], result: { XXBTZUSD: [[t, '99', '103', '98', '100', '99', '8', 20], [t + 300, '99', '103', '98', '100', '99', '8', 20]], last: t } })));
  await setImmediate(); f.advance(STREAM_BATCH_MS);
  assert.equal(f.client.getState().snapshot?.candles.length, 2);
  assert.equal(f.client.getState().snapshot?.candles.at(-1)?.close, 102);
  assert.equal(f.client.getState().historyStatus, 'ready');
  f.client.destroy();
});

test('A live transport heartbeat does not conceal stale market prices; a new quote recovers the stream', () => {
  const f = fixture(); f.client.start(); const socket = f.sockets[0]; socket.open(); socket.message(ticker()); f.advance(250);
  for (let i = 0; i < 7; i++) { socket.message({ channel: 'heartbeat' }); f.advance(10_000); }
  assert.equal(f.client.getState().status, 'stale');
  assert.equal(f.client.getState().snapshot?.asOf, START / 1000);
  assert.ok(socket.sent.some(m => m.method === 'ping'));
  socket.message(ticker(f.now(), 110)); f.advance(250);
  assert.equal(f.client.getState().status, 'live'); assert.equal(f.client.getState().snapshot?.price, 110);
  f.client.destroy();
});

test('A silent socket reconnects with backoff and stops after the retry budget', () => {
  const f = fixture(); f.client.start(); f.sockets[0].open(); f.sockets[0].message(ticker()); f.advance(26_000);
  assert.equal(f.client.getState().status, 'reconnecting');
  assert.equal(f.sockets[0].closed, true);
  f.advance(1_000); assert.equal(f.sockets.length, 2);
  for (let attempt = 1; attempt <= 8; attempt++) {
    f.sockets.at(-1)!.fail();
    if (attempt < 8) f.advance(Math.min(30_000, 1_000 * 2 ** attempt));
  }
  assert.equal(f.client.getState().status, 'error');
  assert.equal(f.client.getState().retries, 8);
  assert.equal(f.jobs.size, 0);
  f.client.reconnect(); assert.equal(f.client.getState().status, 'connecting');
  f.client.destroy();
});

test('Pause and disposal clear timers, abort history, close sockets and ignore late callbacks', () => {
  let signal: AbortSignal | undefined;
  const f = fixture(async (_url, init) => { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}); });
  f.client.start(); const socket = f.sockets[0]; socket.open(); socket.message(ticker()); f.advance(250);
  f.client.pause();
  assert.equal(f.client.getState().status, 'paused'); assert.equal(signal?.aborted, true); assert.equal(socket.closed, true); assert.equal(f.jobs.size, 0);
  socket.message(ticker(START, 200)); f.advance(500_000);
  assert.equal(f.client.getState().snapshot?.price, 100); assert.equal(f.sockets.length, 1);
  f.client.reconnect(); assert.equal(f.sockets.length, 2);
  f.client.destroy(); assert.equal(f.jobs.size, 0); assert.equal(f.sockets[1].closed, true);
});

test('Subscription rejection is actionable and does not retry an unsupported market forever', () => {
  const f = fixture(); f.client.start(); f.sockets[0].open();
  f.sockets[0].message({ method: 'subscribe', success: false, error: 'Currency pair not supported BTC/USD' });
  assert.equal(f.client.getState().status, 'error'); assert.match(f.client.getState().detail, /not supported/);
  assert.equal(f.jobs.size, 0); assert.equal(f.sockets[0].closed, true);
});

test('Sentiment merge preserves provider timestamps and refuses demo/cross-market source leakage', () => {
  const market = { ...demoSnapshot('BTC'), mode: 'live' as const, sources: [] };
  const sentiment = demoSnapshot('BTC');
  assert.equal(mergeMarketSnapshot(market, sentiment), market);
  sentiment.mode = 'live'; sentiment.sources[0].updatedAt = START / 1000 - 10_000;
  const result = mergeMarketSnapshot(market, sentiment);
  assert.equal(result.sources[0].updatedAt, START / 1000 - 10_000);
  assert.equal(result.price, market.price);
  assert.equal(mergeMarketSnapshot(market, { ...sentiment, asset: 'ETH' }), market);
});


test('Automatic browser recovery respects a pending retry and cannot reset an exhausted budget', () => {
  const f = fixture(); f.client.start();
  for (let attempt = 0; attempt <= 8; attempt++) {
    f.sockets.at(-1)!.fail();
    const count = f.sockets.length;
    f.client.recover(); f.client.recover();
    assert.equal(f.sockets.length, count);
    if (attempt < 8) f.advance(Math.min(30_000, 1_000 * 2 ** attempt));
  }
  assert.equal(f.client.getState().status, 'error');
  f.client.recover(); assert.equal(f.client.getState().retries, 8); assert.equal(f.jobs.size, 0);
  f.client.destroy();
});


test('Reconnect snapshots cannot regress the last accepted market timestamp', () => {
  const f = fixture(); f.client.start(); f.sockets[0].open(); f.sockets[0].message(ticker(START, 100)); f.advance(250);
  f.client.reconnect(); const socket = f.sockets.at(-1)!; socket.open();
  socket.message(ticker(START - 1, 90)); f.advance(250);
  assert.equal(f.client.getState().snapshot?.price, 100);
  assert.equal(f.client.getState().status, 'connecting');
  socket.message(ticker(START + 100, 101)); f.advance(250);
  assert.equal(f.client.getState().snapshot?.price, 101);
  assert.equal(f.client.getState().status, 'live');
  f.client.destroy();
});
