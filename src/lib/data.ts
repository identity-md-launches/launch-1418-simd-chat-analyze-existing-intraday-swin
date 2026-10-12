import type { Asset, Candle, FeedItem, Snapshot } from '../types';

export const ASSETS: { symbol: Asset; name: string; color: string; mark: string; base: number }[] = [
  { symbol: 'BTC', name: 'Bitcoin', color: '#f6ae57', mark: '₿', base: 67432.8 },
  { symbol: 'ETH', name: 'Ethereum', color: '#acb5f5', mark: 'Ξ', base: 3518.62 },
  { symbol: 'SOL', name: 'Solana', color: '#b399f4', mark: '≋', base: 164.27 },
  { symbol: 'BNB', name: 'BNB', color: '#edcf62', mark: '◇', base: 594.86 },
];
export const DEMO_END = Date.UTC(2026, 4, 18, 14, 30) / 1000;
function generator(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function demoHistory(asset: Asset): Candle[] {
  const spec = ASSETS.find((a) => a.symbol === asset)!,
    random = generator(73 + ASSETS.indexOf(spec) * 106);
  let price = spec.base * 0.96;
  const bars: Candle[] = [];
  for (let i = 0; i < 2016; i++) {
    const open = price,
      close = open * (1 + (random() - 0.48) * 0.003 + Math.sin(i / 29) * 0.00025);
    const spread = open * (0.0003 + random() * 0.0012);
    bars.push({
      time: DEMO_END - (2016 - i) * 300,
      open,
      close,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      volume: (12 + random() * 120) * (67432 / spec.base),
      sentiment: Math.round(Math.max(5, Math.min(95, 52 + Math.sin(i / 31) * 23 + (random() - 0.5) * 18))),
    });
    price = close;
  }
  const scale = spec.base / price;
  return bars.map((c, i) => ({
    ...c,
    open: c.open * scale,
    high: c.high * scale,
    low: c.low * scale,
    close: c.close * scale,
    sentiment: i === bars.length - 1 ? 74 - ASSETS.indexOf(spec) * 5 : c.sentiment,
  }));
}
export function demoSnapshot(asset: Asset): Snapshot {
  const candles = demoHistory(asset),
    last = candles.at(-1)!;
  const offset = ASSETS.findIndex((a) => a.symbol === asset) * 5;
  const feed: FeedItem[] = [
    {
      id: 'demo-1',
      kind: 'News',
      publisher: 'Market wire',
      title: `${asset} spot demand strengthens as trading volume picks up`,
      score: 83 - offset,
      time: DEMO_END - 180,
    },
    {
      id: 'demo-2',
      kind: 'Social',
      publisher: 'Social pulse',
      title: `${asset} traders watch the next resistance level after a steady session`,
      score: 72 - offset,
      time: DEMO_END - 420,
    },
    {
      id: 'demo-3',
      kind: 'On-chain',
      publisher: 'Chain monitor',
      title: 'Exchange outflows suggest a shift toward longer holding periods',
      score: 76 - offset,
      time: DEMO_END - 660,
    },
    {
      id: 'demo-4',
      kind: 'News',
      publisher: 'Market wire',
      title: 'Macro uncertainty keeps short-term risk appetite in check',
      score: 38,
      time: DEMO_END - 900,
    },
    {
      id: 'demo-5',
      kind: 'Social',
      publisher: 'Social pulse',
      title: `Discussion of ${asset} accumulation rises across the sample`,
      score: 81 - offset,
      time: DEMO_END - 1020,
    },
    {
      id: 'demo-6',
      kind: 'On-chain',
      publisher: 'Chain monitor',
      title: 'Active addresses remain stable through the afternoon session',
      score: 57,
      time: DEMO_END - 1380,
    },
  ];
  return {
    asset,
    mode: 'demo',
    asOf: DEMO_END,
    price: last.close,
    change: (last.close / candles.at(-289)!.close - 1) * 100,
    volume: candles.slice(-288).reduce((s, c) => s + c.volume * c.close, 0),
    candles,
    sources: [
      {
        kind: 'Social',
        score: 78 - offset,
        count: 846,
        updatedAt: DEMO_END,
        status: 'ready',
        detail: 'Synthetic social posts · keyword polarity',
      },
      {
        kind: 'News',
        score: 72 - offset,
        count: 42,
        updatedAt: DEMO_END - 60,
        status: 'ready',
        detail: 'Synthetic headlines · keyword polarity',
      },
      {
        kind: 'On-chain',
        score: 69 - offset,
        count: 128,
        updatedAt: DEMO_END - 120,
        status: 'ready',
        detail: 'Synthetic activity · directional proxy',
      },
    ],
    feed,
  };
}
