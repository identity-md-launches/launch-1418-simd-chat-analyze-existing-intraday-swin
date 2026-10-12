import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Radio } from 'lucide-react';
import { Badge, Panel } from '../components';
import { evaluate } from '../lib/engine';
import {
  advanceAlerts,
  appendAlerts,
  DEFAULT_ALERT_SETTINGS,
  emptyAlertMemory,
  isAlertLog,
  isAlertSettings,
  type AlertSettings,
  type MarketAlert,
} from '../lib/alerts';
import { readStored, writeStored } from '../lib/storage';
import type { Protection } from '../lib/risk';
import type { Snapshot, Strategy } from '../types';

export default function AlertCenter({
  snapshot,
  strategy,
  feedFresh = true,
  protection,
  visible = true,
}: {
  snapshot: Snapshot | null;
  strategy: Strategy;
  feedFresh?: boolean;
  protection?: Protection;
  visible?: boolean;
}) {
  const [settings, setSettings] = useState(() =>
    readStored('simd.alert.settings.v1', DEFAULT_ALERT_SETTINGS, isAlertSettings),
  );
  const [log, setLog] = useState<MarketAlert[]>(() => readStored('simd.alert.log.v1', [], isAlertLog));
  const [message, setMessage] = useState(''),
    [settingsError, setSettingsError] = useState(''),
    [cooldownDraft, setCooldownDraft] = useState(String(settings.cooldownSeconds));
  const [clock, setClock] = useState(Date.now() / 1000);
  const memory = useRef(emptyAlertMemory()),
    latestAsset = useRef(snapshot?.asset ?? 'BTC'),
    latestMode = useRef(snapshot?.mode ?? 'demo');
  const persisted = useRef(true);
  if (snapshot) {
    latestAsset.current = snapshot.asset;
    latestMode.current = snapshot.mode;
  }
  const unread = log.filter((alert) => !alert.acknowledged).length;
  const healthy = !!snapshot && feedFresh && (snapshot.mode === 'demo' || clock - snapshot.asOf <= 120);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now() / 1000), 5000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const now = Date.now() / 1000;
    const result = snapshot ? evaluate(snapshot, strategy, now) : null;
    const scope = `${latestAsset.current}:${latestMode.current}:${JSON.stringify(strategy)}`;
    const update = advanceAlerts(
      memory.current,
      {
        scope,
        asset: latestAsset.current,
        mode: latestMode.current,
        now,
        healthy,
        action: result?.action ?? 'Wait',
        reason: result?.reason ?? 'Waiting for market data.',
        price: snapshot?.price ?? 0,
        protection,
      },
      settings,
    );
    memory.current = update.memory;
    if (update.alerts.length) {
      setLog((current) => appendAlerts(current, update.alerts));
      setMessage(update.alerts.map((alert) => `${alert.asset}: ${alert.title}.`).join(' '));
    }
  }, [snapshot, strategy, healthy, settings, protection]);
  useEffect(() => {
    if (!writeStored('simd.alert.log.v1', log) && persisted.current) {
      persisted.current = false;
      setMessage('Alert history is available for this session. Browser storage is unavailable.');
    }
  }, [log]);
  function updateSettings(next: AlertSettings) {
    if (!isAlertSettings(next)) {
      setSettingsError('Use a whole-number cooldown between 0 and 3,600 seconds.');
      return;
    }
    setSettings(next);
    setSettingsError('');
    const stored = writeStored('simd.alert.settings.v1', next);
    setMessage(
      `${next.enabled ? 'Alerts enabled. Watching for the next signal change.' : 'Alerts paused.'}${stored ? '' : ' Settings apply only to this session; browser storage is unavailable.'}`,
    );
  }
  function testAlert() {
    const now = Date.now() / 1000;
    const alert: MarketAlert = {
      id: `test:${now}`,
      time: now,
      asset: latestAsset.current,
      mode: latestMode.current,
      kind: 'test',
      title: 'Test alert received',
      detail: 'This checks the in-app alert log. It is not a market signal and no order was sent.',
      acknowledged: false,
    };
    setLog((current) => appendAlerts(current, [alert]));
    setMessage('Test alert added. Use Acknowledge to mark it as reviewed.');
  }
  return (
    <div hidden={!visible} className="alert-center">
      <Panel
        title="Signal alerts"
        subtitle="Entry and exit changes, in one place."
        action={<Badge tone={unread ? 'warning' : 'neutral'}>{unread} unread</Badge>}
      >
        <div className="padded stack">
          <div className="button-row">
            <button
              className="button secondary"
              type="button"
              aria-pressed={settings.enabled}
              onClick={() => updateSettings({ ...settings, enabled: !settings.enabled })}
            >
              <Bell size={16} aria-hidden="true" />
              {settings.enabled ? 'Pause alerts' : 'Enable alerts'}
            </button>
            <Badge tone={!settings.enabled ? 'neutral' : healthy ? 'positive' : 'warning'}>
              {!settings.enabled ? 'Paused' : healthy ? 'Watching changes' : 'Waiting for fresh data'}
            </Badge>
            <button className="text-button" type="button" onClick={testAlert}>
              Send test alert
            </button>
          </div>
          <p className="muted small-text">
            {snapshot?.mode === 'demo' ? 'Demo alerts use synthetic market data. ' : ''}Alerts run while this
            workspace is open, for the selected asset. They do not place orders.
          </p>
          <details>
            <summary>Configure alert rules</summary>
            <form
              className="alert-settings form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                updateSettings({ ...settings, cooldownSeconds: Number(cooldownDraft) });
              }}
            >
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.entries}
                  onChange={(event) => updateSettings({ ...settings, entries: event.target.checked })}
                />
                Entry alerts when the signal changes to Buy
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.exits}
                  onChange={(event) => updateSettings({ ...settings, exits: event.target.checked })}
                />
                Exit alerts when the signal changes to Sell
              </label>
              <label>
                Repeat alert cooldown (seconds)
                <input
                  type="number"
                  min="0"
                  max="3600"
                  step="1"
                  value={cooldownDraft}
                  onChange={(event) => setCooldownDraft(event.target.value)}
                  required
                  aria-invalid={!!settingsError}
                  aria-describedby={
                    settingsError ? 'alert-cooldown-help alert-cooldown-error' : 'alert-cooldown-help'
                  }
                />
                <span className="field-hint" id="alert-cooldown-help">
                  Repeated entry or exit signals within this interval are suppressed. Feed and protection
                  alerts stay immediate.
                </span>
              </label>
              {settingsError && (
                <p id="alert-cooldown-error" className="form-error" role="alert">
                  {settingsError}
                </p>
              )}
              <button type="submit" className="button secondary">
                Save alert rules
              </button>
            </form>
          </details>
          <p className="form-status" role="status">
            {message}
          </p>
          {log.length ? (
            <>
              <div className="button-row">
                <strong>Recent alerts</strong>
                <button
                  type="button"
                  className="text-button"
                  disabled={!unread}
                  onClick={() => {
                    setLog((current) => current.map((alert) => ({ ...alert, acknowledged: true })));
                    setMessage('All alerts acknowledged.');
                  }}
                >
                  <CheckCheck size={16} aria-hidden="true" />
                  Acknowledge all
                </button>
              </div>
              <ol className="alert-log">
                {log.slice(0, 8).map((alert) => (
                  <li key={alert.id} className={alert.acknowledged ? 'acknowledged' : ''}>
                    <div className="button-row">
                      <Badge
                        tone={
                          alert.kind === 'exit' || alert.kind === 'risk'
                            ? 'warning'
                            : alert.kind === 'entry'
                              ? 'positive'
                              : 'neutral'
                        }
                      >
                        {alert.kind === 'test' ? 'Test' : alert.mode === 'demo' ? 'Demo' : 'Live'} ·{' '}
                        {alert.asset}
                      </Badge>
                      <time dateTime={new Date(alert.time * 1000).toISOString()}>
                        {new Date(alert.time * 1000).toLocaleTimeString('en-GB', { timeZone: 'UTC' })} UTC
                      </time>
                    </div>
                    <strong>{alert.title}</strong>
                    <p>{alert.detail}</p>
                    <button
                      type="button"
                      className="text-button"
                      disabled={alert.acknowledged}
                      aria-label={`${alert.acknowledged ? 'Acknowledged' : 'Acknowledge'} ${alert.title} at ${new Date(alert.time * 1000).toLocaleTimeString('en-GB', { timeZone: 'UTC' })}`}
                      onClick={() => {
                        setLog((current) =>
                          current.map((item) =>
                            item.id === alert.id ? { ...item, acknowledged: true } : item,
                          ),
                        );
                        setMessage('Alert acknowledged.');
                      }}
                    >
                      {alert.acknowledged ? 'Acknowledged' : 'Acknowledge'}
                    </button>
                  </li>
                ))}
              </ol>
              {log.length > 8 && (
                <p className="muted small-text">Showing the 8 most recent of {log.length} retained alerts.</p>
              )}
            </>
          ) : (
            <div className="callout">
              <Radio size={18} aria-hidden="true" />
              <p>No alerts yet. Enable monitoring, then watch for a change in the saved strategy’s signal.</p>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
