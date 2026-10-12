import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Calculator, Check, ShieldCheck, WandSparkles } from 'lucide-react';
import { Badge, Metric, Panel } from '../components';
import { money } from '../lib/engine';
import {
  evaluateProtection,
  loadRiskAccount,
  loadRiskProfile,
  protectedPosition,
  recordEquity,
  saveRiskAccount,
  saveRiskProfile,
  stopPrice,
  validateRiskProfile,
  type RiskAccount,
  type RiskProfile,
  type StopMode,
} from '../lib/risk';
import type { Snapshot, Strategy } from '../types';

type PlanResult = ReturnType<typeof protectedPosition> & {
  entry: number;
  stop: number;
  target: number;
  side: 'buy' | 'sell';
};
const STOP_LABELS: Record<StopMode, string> = {
  fixed: 'Fixed percentage',
  atr: 'ATR volatility',
  trailing: 'Trailing percentage',
};

export default function Risk({
  snapshot,
  strategy,
  onRiskChange,
  initialProfile,
  initialAccount,
}: {
  snapshot: Snapshot;
  strategy: Strategy;
  initialProfile?: RiskProfile;
  initialAccount?: RiskAccount | null;
  onRiskChange?: (profile: RiskProfile, account: RiskAccount | null) => void;
}) {
  const [profile, setProfile] = useState(() => initialProfile ?? loadRiskProfile(strategy)),
    [account, setAccount] = useState(() =>
      initialAccount === undefined ? loadRiskAccount() : initialAccount,
    );
  const [draft, setDraft] = useState(profile),
    [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [capital, setCapital] = useState(String(account?.equity ?? 10000)),
    [entry, setEntry] = useState(snapshot.price.toFixed(2));
  const [stop, setStop] = useState(() => {
    try {
      return stopPrice(profile, snapshot.price, 'buy', snapshot.candles).toFixed(2);
    } catch {
      return '';
    }
  });
  const [target, setTarget] = useState((snapshot.price * (1 + strategy.target / 100)).toFixed(2));
  const [error, setError] = useState(''),
    [profileError, setProfileError] = useState(''),
    [profileErrorField, setProfileErrorField] = useState('profile-risk'),
    [accountError, setAccountError] = useState('');
  const [result, setResult] = useState<PlanResult | null>(null),
    [note, setNote] = useState(''),
    [profileNote, setProfileNote] = useState(''),
    [accountNote, setAccountNote] = useState('');
  const [equity, setEquity] = useState(account ? String(account.equity) : ''),
    [resetConfirmed, setResetConfirmed] = useState(false);
  const [mark, setMark] = useState(''),
    [trail, setTrail] = useState<{ best: number; stop: number; tripped: boolean } | null>(null),
    [trailNote, setTrailNote] = useState('');
  const [, tickProtection] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tickProtection((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const protection = evaluateProtection(profile, account);
  function clearPlan() {
    setResult(null);
    setError('');
    setTrail(null);
    setTrailNote('');
  }
  function applyStop(nextProfile = profile, nextSide = side) {
    try {
      const value = stopPrice(nextProfile, Number(entry), nextSide, snapshot.candles);
      setStop(value.toFixed(2));
      setNote(
        `${STOP_LABELS[nextProfile.stopMode]} stop applied. Calculate again to update position sizing.`,
      );
      clearPlan();
    } catch (issue) {
      setError((issue as Error).message);
    }
  }
  function changeSide(next: 'buy' | 'sell') {
    setSide(next);
    setTarget((Number(entry) * (1 + ((next === 'buy' ? 1 : -1) * strategy.target) / 100)).toFixed(2));
    applyStop(profile, next);
  }
  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const values = protectedPosition(
        profile,
        account,
        Number(capital),
        Number(entry),
        Number(stop),
        Number(target),
        side,
      );
      setResult({ ...values, entry: Number(entry), stop: Number(stop), target: Number(target), side });
      setError('');
    } catch (issue) {
      setError((issue as Error).message);
      setResult(null);
      document.getElementById('risk-stop')?.focus();
    }
  }
  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const issue = validateRiskProfile(draft);
    if (issue) {
      const field = issue.startsWith('Set the daily loss') ? 'profile-daily' : 'profile-risk';
      setProfileError(issue);
      setProfileErrorField(field);
      document.getElementById(field)?.focus();
      return;
    }
    const nextAccount = account
      ? {
          ...account,
          drawdownTripped:
            account.drawdownTripped ||
            ((account.peakEquity - account.equity) / account.peakEquity) * 100 >= draft.maxDrawdownPct,
          dailyTripped:
            account.dailyTripped ||
            ((account.dayStartEquity - account.equity) / account.dayStartEquity) * 100 >= draft.dailyLossPct,
        }
      : null;
    const stored = saveRiskProfile(draft),
      accountStored = nextAccount ? saveRiskAccount(nextAccount) : true;
    setProfile({ ...draft });
    setAccount(nextAccount);
    setProfileError('');
    clearPlan();
    setProfileNote(
      `Risk profile ${draft.armed ? 'armed' : 'saved with protections off'}.${stored && accountStored ? ' Saved in this browser.' : ' Applied for this session; browser storage is unavailable.'}`,
    );
    onRiskChange?.(draft, nextAccount);
    applyStop(draft);
  }
  function updateEquity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (!equity.trim()) throw new Error('Enter your paper account equity in USD.');
      const next = recordEquity(account, Number(equity), profile);
      const stored = saveRiskAccount(next);
      setAccount(next);
      setCapital(String(next.equity));
      clearPlan();
      setAccountError('');
      setAccountNote(
        `Paper equity updated.${stored ? ' Baselines saved in this browser.' : ' Browser storage is unavailable; this update lasts for this session.'}`,
      );
      onRiskChange?.(profile, next);
    } catch (issue) {
      setAccountError((issue as Error).message);
      document.getElementById('paper-equity')?.focus();
    }
  }
  function resetBaseline() {
    if (!resetConfirmed) return;
    try {
      if (!equity.trim()) throw new Error('Enter positive paper equity before starting a new baseline.');
      const next = recordEquity(null, Number(equity), profile);
      const stored = saveRiskAccount(next);
      setAccount(next);
      setCapital(String(next.equity));
      setResetConfirmed(false);
      clearPlan();
      setAccountError('');
      setAccountNote(
        `New paper baseline started. Previous protection trips have been cleared.${stored ? '' : ' Browser storage is unavailable.'}`,
      );
      onRiskChange?.(profile, next);
    } catch (issue) {
      setAccountError((issue as Error).message);
    }
  }
  function updateTrail() {
    try {
      const current = Number(mark);
      if (!Number.isFinite(current) || current <= 0)
        throw new Error('Enter a positive observed price for the preview.');
      const initial = stopPrice(profile, Number(entry), side, snapshot.candles);
      const previous = trail ?? { best: Number(entry), stop: initial, tripped: false };
      const tripped =
        previous.tripped || (side === 'buy' ? current <= previous.stop : current >= previous.stop);
      const best = side === 'buy' ? Math.max(previous.best, current) : Math.min(previous.best, current);
      const nextStop = tripped
        ? previous.stop
        : stopPrice(profile, Number(entry), side, snapshot.candles, best, previous.stop);
      setTrail({ best, stop: nextStop, tripped });
      setTrailNote(
        tripped
          ? 'Preview stop triggered. No order was sent. Reset the preview to start again.'
          : 'Preview stop updated. It can tighten but cannot move away from the favorable price.',
      );
    } catch (issue) {
      setTrailNote((issue as Error).message);
    }
  }
  return (
    <div className="two-column settings-grid risk-workspace">
      <div className="stack">
        <Panel
          title="Plan your position"
          subtitle="Size a paper position before you enter."
          action={<ShieldCheck size={20} className="muted" aria-hidden="true" />}
        >
          <form className="form-stack" onSubmit={calculate}>
            <div className="segmented wide">
              <button
                type="button"
                aria-pressed={side === 'buy'}
                className={side === 'buy' ? 'selected' : ''}
                onClick={() => changeSide('buy')}
              >
                Long position
              </button>
              <button
                type="button"
                aria-pressed={side === 'sell'}
                className={side === 'sell' ? 'selected' : ''}
                onClick={() => changeSide('sell')}
              >
                Short position
              </button>
            </div>
            <div className="field-grid">
              <label>
                Planning capital (USD)
                <input
                  type="number"
                  min="1"
                  max="1000000000"
                  step="any"
                  value={capital}
                  onChange={(event) => {
                    setCapital(event.target.value);
                    clearPlan();
                  }}
                  required
                />
                <span className="field-hint">
                  {profile.armed
                    ? 'Capped at your reported paper equity.'
                    : 'Illustrative capital, not a connected balance.'}
                </span>
              </label>
              <label>
                Entry price (USD)
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={entry}
                  onChange={(event) => {
                    setEntry(event.target.value);
                    clearPlan();
                  }}
                  required
                />
              </label>
            </div>
            <div className="field-grid">
              <label>
                Stop price (USD)
                <input
                  id="risk-stop"
                  type="number"
                  min="0.000001"
                  step="any"
                  value={stop}
                  onChange={(event) => {
                    setStop(event.target.value);
                    clearPlan();
                  }}
                  required
                  aria-invalid={!!error}
                  aria-describedby={error ? 'risk-error' : undefined}
                />
              </label>
              <label>
                Take profit (USD)
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={target}
                  onChange={(event) => {
                    setTarget(event.target.value);
                    clearPlan();
                  }}
                  required
                />
              </label>
            </div>
            <div className="button-row">
              <button type="button" className="button secondary" onClick={() => applyStop()}>
                <WandSparkles size={16} aria-hidden="true" />
                Apply saved stop
              </button>
              <Badge>{STOP_LABELS[profile.stopMode]}</Badge>
              <span className="muted small-text">{profile.riskPct}% position risk</span>
            </div>
            <p className="field-hint" role="status">
              {note ||
                'Edit the stop directly for this estimate, or apply the saved stop rule. New paper entries use the saved profile.'}
            </p>
            {error && (
              <p className="form-error" id="risk-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" type="submit">
              <Calculator size={17} aria-hidden="true" />
              Calculate position
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </form>
        </Panel>
        <Panel title="Saved risk profile" subtitle="Applied to new paper entries in this browser.">
          <form className="form-stack" onSubmit={saveProfile}>
            <label>
              Stop method
              <select
                value={draft.stopMode}
                onChange={(event) => {
                  setDraft({ ...draft, stopMode: event.target.value as StopMode });
                  setProfileNote('');
                }}
              >
                {Object.entries(STOP_LABELS).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="field-grid">
              <label>
                Fixed stop (%)
                <input
                  type="number"
                  min="0.1"
                  max="50"
                  step="0.1"
                  value={draft.fixedStopPct}
                  onChange={(event) => setDraft({ ...draft, fixedStopPct: Number(event.target.value) })}
                  required
                />
              </label>
              <label>
                ATR multiplier
                <input
                  type="number"
                  min="0.5"
                  max="10"
                  step="0.1"
                  value={draft.atrMultiplier}
                  onChange={(event) => setDraft({ ...draft, atrMultiplier: Number(event.target.value) })}
                  required
                />
              </label>
              <label>
                Trailing distance (%)
                <input
                  type="number"
                  min="0.1"
                  max="50"
                  step="0.1"
                  value={draft.trailingPct}
                  onChange={(event) => setDraft({ ...draft, trailingPct: Number(event.target.value) })}
                  required
                />
              </label>
              <label>
                Position risk (%)
                <input
                  id="profile-risk"
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={draft.riskPct}
                  onChange={(event) => setDraft({ ...draft, riskPct: Number(event.target.value) })}
                  required
                  aria-invalid={!!profileError && profileErrorField === 'profile-risk'}
                  aria-describedby={
                    profileError && profileErrorField === 'profile-risk' ? 'profile-error' : undefined
                  }
                />
              </label>
            </div>
            <p className="field-hint">
              ATR uses the average true range of the latest 14 completed bars. A trailing profile starts at
              the configured distance from entry. The preview below demonstrates subsequent tightening.
            </p>
            <fieldset>
              <legend>Paper account protections</legend>
              <div className="field-grid">
                <label>
                  Maximum drawdown (%)
                  <input
                    type="number"
                    min="0.5"
                    max="50"
                    step="0.1"
                    value={draft.maxDrawdownPct}
                    onChange={(event) => setDraft({ ...draft, maxDrawdownPct: Number(event.target.value) })}
                    required
                  />
                </label>
                <label>
                  Daily loss limit (%)
                  <input
                    id="profile-daily"
                    type="number"
                    aria-invalid={!!profileError && profileErrorField === 'profile-daily'}
                    aria-describedby={
                      profileError && profileErrorField === 'profile-daily' ? 'profile-error' : undefined
                    }
                    min="0.1"
                    max="20"
                    step="0.1"
                    value={draft.dailyLossPct}
                    onChange={(event) => setDraft({ ...draft, dailyLossPct: Number(event.target.value) })}
                    required
                  />
                </label>
              </div>
            </fieldset>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.armed}
                onChange={(event) => setDraft({ ...draft, armed: event.target.checked })}
              />
              Pause new paper entries when either protection limit is reached
            </label>
            {profileError && (
              <p id="profile-error" className="form-error" role="alert">
                {profileError}
              </p>
            )}
            <button className="button secondary" type="submit">
              <Check size={16} aria-hidden="true" />
              Save risk profile
            </button>
            <p className="form-status" role="status">
              {profileNote}
            </p>
          </form>
        </Panel>
      </div>
      <div className="stack">
        <Panel
          title="Paper protection status"
          action={
            <Badge
              tone={
                protection.status === 'armed'
                  ? 'positive'
                  : protection.status === 'off'
                    ? 'neutral'
                    : 'warning'
              }
            >
              {protection.status === 'armed'
                ? 'Armed'
                : protection.status === 'tripped'
                  ? 'Tripped'
                  : protection.status === 'setup'
                    ? 'Update required'
                    : 'Off'}
            </Badge>
          }
        >
          <div className="padded stack">
            <p className="muted">{protection.reason}</p>
            <div className="mini-metrics">
              <Metric
                label="Drawdown / limit"
                value={`${protection.drawdownPct.toFixed(2)}% / ${profile.maxDrawdownPct}%`}
              />
              <Metric
                label="Daily loss / limit"
                value={`${protection.dailyLossPct.toFixed(2)}% / ${profile.dailyLossPct}%`}
              />
            </div>
            {account && (
              <dl className="detail-list">
                <div>
                  <dt>Reported equity</dt>
                  <dd>{money(account.equity)}</dd>
                </div>
                <div>
                  <dt>Recorded peak</dt>
                  <dd>{money(account.peakEquity)}</dd>
                </div>
                <div>
                  <dt>UTC day baseline</dt>
                  <dd>{money(account.dayStartEquity)}</dd>
                </div>
                <div>
                  <dt>Last manual update</dt>
                  <dd>
                    {new Date(account.updatedAt * 1000).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
                  </dd>
                </div>
              </dl>
            )}
            <form className="stack" onSubmit={updateEquity}>
              <label>
                Manual paper equity (USD)
                <input
                  id="paper-equity"
                  type="number"
                  min="0"
                  max="1000000000"
                  step="any"
                  value={equity}
                  onChange={(event) => setEquity(event.target.value)}
                  required
                  aria-invalid={!!accountError}
                  aria-describedby={
                    accountError ? 'paper-equity-help paper-equity-error' : 'paper-equity-help'
                  }
                />
              </label>
              <p id="paper-equity-help" className="field-hint">
                Enter your paper account’s current equity, including unrealized gains or losses. The first
                entry sets your peak and UTC day baseline. This app does not fetch account balances.
              </p>
              {accountError && (
                <p id="paper-equity-error" className="form-error" role="alert">
                  {accountError}
                </p>
              )}
              <button className="button secondary" type="submit">
                Update paper equity
              </button>
            </form>
            <details>
              <summary>Start a new protection baseline</summary>
              <div className="stack">
                <p className="muted small-text">
                  This clears recorded drawdown and daily-loss trips, using the equity value above as a new
                  baseline. Existing paper journal records are kept.
                </p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={resetConfirmed}
                    onChange={(event) => setResetConfirmed(event.target.checked)}
                  />
                  I intend to clear the protection history for a new paper session
                </label>
                <button
                  className="button secondary"
                  type="button"
                  disabled={!resetConfirmed}
                  onClick={resetBaseline}
                >
                  Reset protection baseline
                </button>
              </div>
            </details>
            <p className="form-status" role="status">
              {accountNote}
            </p>
          </div>
        </Panel>
        <Panel title="Position estimate" action={<Badge>{snapshot.asset}/USD</Badge>}>
          {result ? (
            <div className="risk-results" role="status">
              <div className="position-total">
                <span className="muted">Position size</span>
                <strong>
                  {result.quantity.toFixed(6)} <span>{snapshot.asset}</span>
                </strong>
                <p>{money(result.notional)} notional</p>
              </div>
              <div className="mini-metrics">
                <Metric label="Planned stop loss" value={money(result.maxLoss)} />
                <Metric label="Potential profit" value={money(result.reward)} />
                <Metric label="Risk / reward" value={`1 : ${result.ratio.toFixed(2)}`} />
                <Metric label="Risk budget" value={money(result.riskBudget)} />
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Direction</dt>
                  <dd>{result.side === 'buy' ? 'Long' : 'Short'}</dd>
                </div>
                <div>
                  <dt>Entry</dt>
                  <dd>{money(result.entry)}</dd>
                </div>
                <div>
                  <dt>Stop loss</dt>
                  <dd>{money(result.stop)}</dd>
                </div>
                <div>
                  <dt>Take profit</dt>
                  <dd>{money(result.target)}</dd>
                </div>
              </dl>
              {result.capped && (
                <p className="callout">Position capped at available capital. No leverage is assumed.</p>
              )}
              {result.protectionCapped && (
                <p className="callout">Risk reduced to fit the remaining drawdown or daily-loss allowance.</p>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <Calculator size={30} aria-hidden="true" />
              <h3>Check your next position</h3>
              <p>
                Set your entry, stop, and target, then calculate a position within your saved risk limits.
              </p>
            </div>
          )}
        </Panel>
        {profile.stopMode === 'trailing' && (
          <Panel title="Trailing stop preview" subtitle="Manually simulate a price path; no orders are sent.">
            <div className="padded stack">
              <label>
                Observed price (USD)
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={mark}
                  onChange={(event) => setMark(event.target.value)}
                />
              </label>
              <div className="button-row">
                <button className="button secondary" type="button" onClick={updateTrail}>
                  Update trailing preview
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setTrail(null);
                    setTrailNote('Preview reset to the planned entry.');
                  }}
                >
                  Reset preview
                </button>
              </div>
              {trail && (
                <dl className="detail-list">
                  <div>
                    <dt>Best observed price</dt>
                    <dd>{money(trail.best)}</dd>
                  </div>
                  <div>
                    <dt>Current preview stop</dt>
                    <dd>{money(trail.stop)}</dd>
                  </div>
                  <div>
                    <dt>Preview state</dt>
                    <dd>{trail.tripped ? 'Stop triggered' : 'Watching manually entered prices'}</dd>
                  </div>
                </dl>
              )}
              <p className="form-status" role="status">
                {trailNote}
              </p>
            </div>
          </Panel>
        )}
        <div className="callout risk-note">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>Research safeguards only</strong>
            <p>
              Protections gate new paper journal entries using manually reported equity. Stops and trailing
              previews do not manage exchange orders, existing paper positions, or live account balances.
              Fees, slippage, funding, and liquidation are excluded from this estimate. A stop cannot
              guarantee an exit price.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
