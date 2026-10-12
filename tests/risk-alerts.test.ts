import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceAlerts, appendAlerts, DEFAULT_ALERT_SETTINGS, emptyAlertMemory, isAlertLog, isAlertSettings, type AlertInput } from '../src/lib/alerts';
import { DEFAULT_RISK_PROFILE, evaluateProtection } from '../src/lib/risk';

const settings = { ...DEFAULT_ALERT_SETTINGS, enabled: true };
const input: AlertInput = { scope: 'BTC:demo:strategy', asset: 'BTC', mode: 'demo', action: 'Hold', reason: 'Test strategy threshold crossed.', healthy: true, price: 100, now: 1000 };

test('Alert monitoring establishes a baseline and emits entry/exit only on a transition', () => {
  const baseline = advanceAlerts(emptyAlertMemory(), input, settings);
  assert.equal(baseline.alerts.length, 0);
  const entry = advanceAlerts(baseline.memory, { ...input, action: 'Buy', now: 1001 }, settings);
  assert.equal(entry.alerts.length, 1); assert.equal(entry.alerts[0].kind, 'entry');
  assert.match(entry.alerts[0].detail, /Synthetic demo/);
  const repeat = advanceAlerts(entry.memory, { ...input, action: 'Buy', now: 1002 }, settings);
  assert.equal(repeat.alerts.length, 0);
  const exit = advanceAlerts(repeat.memory, { ...input, action: 'Sell', now: 1003 }, settings);
  assert.equal(exit.alerts.length, 1); assert.equal(exit.alerts[0].kind, 'exit');
  assert.match(exit.alerts[0].detail, /no order is sent/);
});

test('Cooldown suppresses oscillating signals while permitting a later fresh transition', () => {
  let state = advanceAlerts(emptyAlertMemory(), input, settings);
  state = advanceAlerts(state.memory, { ...input, action: 'Buy', now: 1001 }, settings);
  state = advanceAlerts(state.memory, { ...input, now: 1002 }, settings);
  state = advanceAlerts(state.memory, { ...input, action: 'Buy', now: 1003 }, settings);
  assert.equal(state.alerts.length, 0);
  state = advanceAlerts(state.memory, { ...input, now: 1061 }, settings);
  state = advanceAlerts(state.memory, { ...input, action: 'Buy', now: 1062 }, settings);
  assert.equal(state.alerts.length, 1);
});

test('Stale data blocks entry and exit cues and recovery does not create a spurious trade alert', () => {
  const base = advanceAlerts(emptyAlertMemory(), input, settings);
  const stale = advanceAlerts(base.memory, { ...input, action: 'Buy', healthy: false, now: 1001 }, settings);
  assert.deepEqual(stale.alerts.map(alert => alert.kind), ['data']);
  const stillStale = advanceAlerts(stale.memory, { ...input, action: 'Sell', healthy: false, now: 1002 }, settings);
  assert.equal(stillStale.alerts.length, 0);
  const recovery = advanceAlerts(stillStale.memory, { ...input, action: 'Buy', now: 1003 }, settings);
  assert.deepEqual(recovery.alerts.map(alert => alert.kind), ['data']);
  assert.match(recovery.alerts[0].title, /restored/);
});

test('Pause, individual alert rules and strategy changes do not produce unexpected alerts', () => {
  const baseline = advanceAlerts(emptyAlertMemory(), input, settings);
  assert.equal(advanceAlerts(baseline.memory, { ...input, action: 'Buy' }, { ...settings, enabled: false }).alerts.length, 0);
  assert.equal(advanceAlerts(baseline.memory, { ...input, action: 'Buy' }, { ...settings, entries: false }).alerts.length, 0);
  assert.equal(advanceAlerts(baseline.memory, { ...input, action: 'Sell' }, { ...settings, exits: false }).alerts.length, 0);
  assert.equal(advanceAlerts(baseline.memory, { ...input, action: 'Buy', scope: 'BTC:demo:new-strategy' }, settings).alerts.length, 0);
});

test('Revisiting a market or strategy resets its baseline rather than comparing an unobserved old signal', () => {
  const initial = advanceAlerts(emptyAlertMemory(), input, settings);
  const otherMarket = advanceAlerts(initial.memory, { ...input, scope: 'ETH:demo:strategy', asset: 'ETH' }, settings);
  const returned = advanceAlerts(otherMarket.memory, { ...input, action: 'Buy', now: 1002 }, settings);
  assert.equal(returned.alerts.length, 0);
  const exit = advanceAlerts(returned.memory, { ...input, action: 'Sell', now: 1003 }, settings);
  assert.equal(exit.alerts[0].kind, 'exit');
  const changed = advanceAlerts(exit.memory, { ...input, scope: 'BTC:demo:other-strategy' }, settings);
  const original = advanceAlerts(changed.memory, { ...input, action: 'Buy', now: 1004 }, settings);
  assert.equal(original.alerts.length, 0);
});

test('Reenabling alerts establishes a baseline even if the signal changed during the enable event', () => {
  const initial = advanceAlerts(emptyAlertMemory(), input, settings);
  const paused = advanceAlerts(initial.memory, input, { ...settings, enabled: false });
  const enabled = advanceAlerts(paused.memory, { ...input, action: 'Buy', now: 1001 }, settings);
  assert.equal(enabled.alerts.length, 0);
  assert.equal(advanceAlerts(enabled.memory, { ...input, action: 'Sell', now: 1002 }, settings).alerts[0].kind, 'exit');
});

test('Protection stops entry alerts while retaining exit cues and emitting an immediate risk event', () => {
  const off = evaluateProtection(DEFAULT_RISK_PROFILE, null);
  const paused = evaluateProtection({ ...DEFAULT_RISK_PROFILE, armed: true }, null);
  const baseline = advanceAlerts(emptyAlertMemory(), { ...input, protection: off }, settings);
  const entry = advanceAlerts(baseline.memory, { ...input, action: 'Buy', protection: paused, now: 1001 }, settings);
  assert.deepEqual(entry.alerts.map(alert => alert.kind), ['risk']);
  const exit = advanceAlerts(entry.memory, { ...input, action: 'Sell', protection: paused, now: 1002 }, settings);
  assert.deepEqual(exit.alerts.map(alert => alert.kind), ['exit']);
});

test('Alert persistence accepts only valid bounded records and deduplicates existing IDs', () => {
  assert.equal(isAlertSettings(settings), true);
  assert.equal(isAlertSettings({ ...settings, cooldownSeconds: -1 }), false);
  assert.equal(isAlertSettings({ ...settings, cooldownSeconds: 0.5 }), false);
  assert.equal(isAlertSettings({ ...settings, entries: 'yes' }), false);
  const baseline = advanceAlerts(emptyAlertMemory(), input, settings);
  const emitted = advanceAlerts(baseline.memory, { ...input, action: 'Buy' }, settings).alerts;
  assert.equal(isAlertLog(emitted), true);
  assert.equal(appendAlerts(emitted, emitted).length, 1);
  assert.equal(appendAlerts([], [...emitted, ...emitted]).length, 1);
  assert.equal(isAlertLog([{ ...emitted[0], time: Number.MAX_VALUE }]), false);
  const many = Array.from({ length: 100 }, (_, index) => ({ ...emitted[0], id: String(index) }));
  assert.equal(appendAlerts([], many).length, 50);
  assert.equal(isAlertLog(many), false);
});
