import type { Asset } from '../types';
import type { Protection } from './risk';

export type AlertSettings = { enabled: boolean; entries: boolean; exits: boolean; cooldownSeconds: number };
export type SignalAction = 'Buy' | 'Sell' | 'Hold' | 'Wait';
export type MarketAlert = {
  id: string;
  time: number;
  asset: Asset;
  mode: 'demo' | 'live';
  kind: 'entry' | 'exit' | 'data' | 'risk' | 'test';
  title: string;
  detail: string;
  acknowledged: boolean;
};
export type AlertInput = {
  scope: string;
  asset: Asset;
  mode: 'demo' | 'live';
  action: SignalAction;
  reason: string;
  healthy: boolean;
  price: number;
  now: number;
  protection?: Protection;
};
type ObservedState = { action: SignalAction; healthy: boolean; protection: Protection['status'] | null };
export type AlertMemory = {
  activeScope: string | null;
  enabled: boolean;
  previous: Record<string, ObservedState>;
  lastSent: Record<string, number>;
};
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: false,
  entries: true,
  exits: true,
  cooldownSeconds: 60,
};
export const emptyAlertMemory = (): AlertMemory => ({
  activeScope: null,
  enabled: false,
  previous: {},
  lastSent: {},
});

export function isAlertSettings(value: unknown): value is AlertSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as AlertSettings;
  return (
    [settings.enabled, settings.entries, settings.exits].every((flag) => typeof flag === 'boolean') &&
    Number.isInteger(settings.cooldownSeconds) &&
    settings.cooldownSeconds >= 0 &&
    settings.cooldownSeconds <= 3600
  );
}
export function isAlertLog(value: unknown): value is MarketAlert[] {
  return (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every(
      (alert) =>
        alert &&
        typeof alert.id === 'string' &&
        alert.id.length <= 4000 &&
        Number.isFinite(alert.time) &&
        alert.time > 0 &&
        alert.time <= Date.now() / 1000 + 60 &&
        ['BTC', 'ETH', 'SOL', 'BNB'].includes(alert.asset) &&
        ['demo', 'live'].includes(alert.mode) &&
        ['entry', 'exit', 'data', 'risk', 'test'].includes(alert.kind) &&
        typeof alert.title === 'string' &&
        alert.title.length <= 200 &&
        typeof alert.detail === 'string' &&
        alert.detail.length <= 2000 &&
        typeof alert.acknowledged === 'boolean',
    )
  );
}

/** Pure transition reducer. Opening, changing strategy, or reconnecting establishes a fresh signal baseline. */
export function advanceAlerts(
  memory: AlertMemory,
  input: AlertInput,
  settings: AlertSettings,
): { memory: AlertMemory; alerts: MarketAlert[] } {
  const observed: ObservedState = {
    action: input.action,
    healthy: input.healthy,
    protection: input.protection?.status ?? null,
  };
  const prior = memory.previous[input.scope];
  const next: AlertMemory = {
    activeScope: input.scope,
    enabled: settings.enabled,
    previous: { ...memory.previous, [input.scope]: observed },
    lastSent: { ...memory.lastSent },
  };
  // Bound per-session memory across strategy edits and market switches.
  if (Object.keys(next.previous).length > 32) delete next.previous[Object.keys(next.previous)[0]];
  if (Object.keys(next.lastSent).length > 128) delete next.lastSent[Object.keys(next.lastSent)[0]];
  const alerts: MarketAlert[] = [];
  if (
    !settings.enabled ||
    !isAlertSettings(settings) ||
    !Number.isFinite(input.now) ||
    !prior ||
    !memory.enabled ||
    memory.activeScope !== input.scope
  )
    return { memory: next, alerts };
  function emit(kind: MarketAlert['kind'], title: string, detail: string, cooldown = false) {
    const key = `${input.scope}:${kind}`;
    if (
      cooldown &&
      next.lastSent[key] !== undefined &&
      input.now - next.lastSent[key] < settings.cooldownSeconds
    )
      return;
    next.lastSent[key] = input.now;
    alerts.push({
      id: `${input.scope}:${kind}:${input.now}`,
      time: input.now,
      asset: input.asset,
      mode: input.mode,
      kind,
      title,
      detail,
      acknowledged: false,
    });
  }
  if (input.protection && input.protection.status !== prior.protection && !input.protection.canEnter) {
    emit('risk', 'Paper entries paused', input.protection.reason);
  }
  if (!input.healthy) {
    if (prior.healthy)
      emit(
        'data',
        'Signal alerts paused',
        'Market data is stale or unavailable. Entry and exit signals are blocked until a fresh feed returns.',
      );
    return { memory: next, alerts };
  }
  if (!prior.healthy) {
    emit(
      'data',
      'Fresh data restored',
      'Monitoring has resumed from the current signal. Reconnection does not create an entry or exit alert.',
    );
    return { memory: next, alerts };
  }
  if (input.action === prior.action || !Number.isFinite(input.price) || input.price <= 0)
    return { memory: next, alerts };
  const context = `${input.mode === 'demo' ? 'Synthetic demo' : 'Live market'} · ${input.asset}/USD at ${input.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}. ${input.reason}`;
  if (input.action === 'Buy' && settings.entries && input.protection?.canEnter !== false)
    emit('entry', 'Entry signal detected', context, true);
  if (input.action === 'Sell' && settings.exits)
    emit(
      'exit',
      'Exit signal detected',
      `${context} Review an existing long position; no order is sent.`,
      true,
    );
  return { memory: next, alerts };
}

export function appendAlerts(log: MarketAlert[], incoming: MarketAlert[]): MarketAlert[] {
  const known = new Set(log.map((alert) => alert.id));
  const unique = incoming.filter((alert) => {
    if (known.has(alert.id)) return false;
    known.add(alert.id);
    return true;
  });
  return [...unique.reverse(), ...log].slice(0, 50);
}
