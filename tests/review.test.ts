import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSentiment, dateTimeLabel, DEFAULT_STRATEGY, sourceFreshness } from '../src/lib/engine';
import { demoSnapshot } from '../src/lib/data';

test('Source display and aggregation share the inclusive freshness boundary and reject missing evidence', () => {
  const snapshot = demoSnapshot('BTC'), source = snapshot.sources[0];
  source.updatedAt = snapshot.asOf - 900;
  assert.equal(sourceFreshness(source, snapshot.asOf), 'ready');
  assert.equal(aggregateSentiment(snapshot, DEFAULT_STRATEGY.weights).covered, 3);
  source.updatedAt--;
  assert.equal(sourceFreshness(source, snapshot.asOf), 'stale');
  assert.equal(aggregateSentiment(snapshot, DEFAULT_STRATEGY.weights).covered, 2);
  source.updatedAt = snapshot.asOf + 61;
  assert.equal(sourceFreshness(source, snapshot.asOf), 'stale');
  source.updatedAt = snapshot.asOf + 60;
  assert.equal(sourceFreshness(source, snapshot.asOf), 'ready');
  source.score = null;
  assert.equal(sourceFreshness(source, snapshot.asOf), 'unavailable');
  source.score = 78; source.updatedAt = null;
  assert.equal(sourceFreshness(source, snapshot.asOf), 'unavailable');
  assert.equal(aggregateSentiment(snapshot, DEFAULT_STRATEGY.weights).covered, 2);
  assert.equal(sourceFreshness(undefined, snapshot.asOf), 'unavailable');
});

test('Candle identifiers distinguish days and years in UTC regardless of browser timezone', () => {
  const stamp = (iso: string) => Date.parse(iso) / 1000;
  assert.equal(dateTimeLabel(stamp('2026-05-18T12:00:00Z')), '18 May 2026, 12:00 UTC');
  assert.equal(dateTimeLabel(stamp('2026-05-17T12:00:00Z')), '17 May 2026, 12:00 UTC');
  assert.equal(dateTimeLabel(stamp('2027-01-01T00:00:00Z')), '1 Jan 2027, 00:00 UTC');
});
