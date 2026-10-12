import type { Asset, Snapshot } from '../types';

export function validateSnapshot(value: unknown, asset: Asset): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Snapshot;
  if (
    s.asset !== asset ||
    s.mode !== 'live' ||
    ![s.asOf, s.price, s.change, s.volume].every(Number.isFinite) ||
    s.price <= 0 ||
    s.volume < 0 ||
    s.asOf > Date.now() / 1000 + 60 ||
    s.asOf < Date.now() / 1000 - 120 ||
    !Array.isArray(s.candles) ||
    s.candles.length < 30 ||
    s.candles.length > 25000
  )
    return false;
  if (
    !s.candles.every(
      (c, i) =>
        c &&
        [c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) &&
        c.time <= s.asOf &&
        Math.min(c.open, c.high, c.low, c.close) > 0 &&
        c.high >= Math.max(c.open, c.close) &&
        c.low <= Math.min(c.open, c.close) &&
        c.volume >= 0 &&
        (!i || c.time > s.candles[i - 1].time) &&
        (c.sentiment === null || (Number.isFinite(c.sentiment) && c.sentiment >= 0 && c.sentiment <= 100)),
    )
  )
    return false;
  if (s.asOf - s.candles.at(-1)!.time > 900 || s.candles.at(-1)!.time + 300 > s.asOf) return false;
  const kinds = ['Social', 'News', 'On-chain'];
  if (
    !Array.isArray(s.sources) ||
    s.sources.length !== 3 ||
    !kinds.every((kind) => s.sources.filter((source) => source.kind === kind).length === 1)
  )
    return false;
  if (
    !s.sources.every(
      (source) =>
        ['ready', 'unavailable'].includes(source.status) &&
        (source.score === null ||
          (Number.isFinite(source.score) && source.score >= 0 && source.score <= 100)) &&
        Number.isFinite(source.count) &&
        source.count >= 0 &&
        (source.updatedAt === null ||
          (Number.isFinite(source.updatedAt) && source.updatedAt <= s.asOf + 60)) &&
        typeof source.detail === 'string',
    )
  )
    return false;
  if (
    !Array.isArray(s.feed) ||
    s.feed.length > 1000 ||
    !s.feed.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        kinds.includes(item.kind) &&
        typeof item.title === 'string' &&
        typeof item.publisher === 'string' &&
        Number.isFinite(item.score) &&
        item.score >= 0 &&
        item.score <= 100 &&
        Number.isFinite(item.time) &&
        item.time <= s.asOf + 60 &&
        (!item.url || /^https?:\/\//.test(item.url)),
    )
  )
    return false;
  return true;
}
