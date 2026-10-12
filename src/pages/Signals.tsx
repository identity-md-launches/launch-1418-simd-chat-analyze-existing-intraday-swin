import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, SlidersHorizontal } from 'lucide-react';
import { Badge, Panel, SourceIcon } from '../components';
import { DEFAULT_STRATEGY, evaluate, validateStrategy } from '../lib/engine';
import type { Snapshot, SourceKind, Strategy } from '../types';

export default function Signals({
  snapshot,
  strategy,
  onSave,
  onReview,
  feedFresh = true,
}: {
  feedFresh?: boolean;
  snapshot: Snapshot;
  strategy: Strategy;
  onSave: (s: Strategy) => boolean;
  onReview: () => void;
}) {
  const [draft, setDraft] = useState(strategy),
    [error, setError] = useState(''),
    [saved, setSaved] = useState('');
  const evaluated = evaluate(snapshot, strategy);
  const result = feedFresh
    ? evaluated
    : {
        ...evaluated,
        action: 'Wait' as const,
        reason: 'The market stream is not current. Resume or reconnect it before reviewing a trade.',
      };
  function field(key: keyof Strategy, value: string) {
    setDraft({ ...draft, [key]: key === 'name' ? value : Number(value) });
    setSaved('');
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const message = validateStrategy(draft);
    setError(message ?? '');
    if (message) {
      e.currentTarget.querySelector<HTMLInputElement>('#buy-threshold')?.focus();
      return;
    }
    const persisted = onSave(draft);
    setSaved(
      persisted
        ? 'Strategy saved. Your signals now use these rules.'
        : 'Strategy applied for this session. Browser storage is unavailable.',
    );
  }
  return (
    <div className="two-column settings-grid">
      <Panel title="Build your signal" subtitle="Turn sentiment into a repeatable decision.">
        <form onSubmit={submit} className="form-stack">
          <label>
            Strategy name
            <input
              value={draft.name}
              maxLength={60}
              onChange={(e) => field('name', e.target.value)}
              required
            />
          </label>
          <div className="field-grid">
            <label>
              Buy at or above
              <input
                id="buy-threshold"
                type="number"
                min="1"
                max="100"
                value={draft.buy}
                onChange={(e) => field('buy', e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'strategy-error' : undefined}
                required
              />
              <span className="field-hint">Sentiment score · 0–100</span>
            </label>
            <label>
              Sell at or below
              <input
                type="number"
                min="0"
                max="99"
                value={draft.sell}
                onChange={(e) => field('sell', e.target.value)}
                required
              />
              <span className="field-hint">Must be below the buy threshold</span>
            </label>
          </div>
          <label>
            RSI entry ceiling
            <input
              type="number"
              min="1"
              max="100"
              value={draft.maxRsi}
              onChange={(e) => field('maxRsi', e.target.value)}
              required
            />
            <span className="field-hint">
              A buy signal also requires the selected RSI at or below this value.
            </span>
          </label>
          <label className="checkbox-label adaptive-setting">
            <input
              type="checkbox"
              checked={draft.adaptive ?? true}
              onChange={(e) => {
                setDraft({ ...draft, adaptive: e.target.checked });
                setSaved('');
              }}
            />
            <span>
              Adapt indicators to volatility
              <span className="field-hint">
                Lengthen RSI smoothing in volatile markets; shorten it in quiet markets. Turn off to use fixed
                RSI (14).
              </span>
            </span>
          </label>
          <fieldset>
            <legend>Source weights</legend>
            <p className="muted small-text">Weights are normalized. Set a source to zero to exclude it.</p>
            {(Object.keys(draft.weights) as SourceKind[]).map((kind) => (
              <label className="range-label" key={kind}>
                <span>
                  <SourceIcon kind={kind} />
                  {kind}
                  <b>{draft.weights[kind]}</b>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={draft.weights[kind]}
                  onChange={(e) => {
                    setDraft({ ...draft, weights: { ...draft.weights, [kind]: Number(e.target.value) } });
                    setSaved('');
                  }}
                />
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Strategy backtest defaults</legend>
            <p className="field-hint">
              These values initialize new Strategy lab sessions. Paper stop and account-risk rules are set in{' '}
              <a href="#risk">Risk calculator</a>; take profit also sets the paper target.
            </p>
            <div className="field-grid three-fields">
              <label>
                Stop loss (%)
                <input
                  type="number"
                  min="0.1"
                  max="50"
                  step="0.1"
                  value={draft.stop}
                  onChange={(e) => field('stop', e.target.value)}
                  required
                />
              </label>
              <label>
                Take profit (%)
                <input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={draft.target}
                  onChange={(e) => field('target', e.target.value)}
                  required
                />
              </label>
              <label>
                Account risk (%)
                <input
                  type="number"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={draft.risk}
                  onChange={(e) => field('risk', e.target.value)}
                  required
                />
              </label>
            </div>
          </fieldset>
          {error && (
            <p className="form-error" id="strategy-error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button className="button primary" type="submit">
              <Check size={16} />
              Save strategy
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setDraft(DEFAULT_STRATEGY);
                setError('');
                setSaved('Default values loaded. Save to apply them.');
              }}
            >
              Load defaults
            </button>
          </div>
          <p className="form-status" role="status">
            {saved}
          </p>
        </form>
      </Panel>
      <div className="stack">
        <Panel title="Current signal" action={<Badge tone="accent">{snapshot.asset}/USD</Badge>}>
          <div className="signal-preview">
            <div className={`signal-action ${result.action.toLowerCase()}`}>
              <SlidersHorizontal size={22} />
              {result.action}
            </div>
            <p>{result.reason}</p>
            <dl className="detail-list">
              <div>
                <dt>Active strategy</dt>
                <dd>{strategy.name}</dd>
              </div>
              <div>
                <dt>Sentiment score</dt>
                <dd>{result.score ?? '—'} / 100</dd>
              </div>
              <div>
                <dt>{strategy.adaptive === false ? 'RSI (14)' : `Adaptive RSI (${result.rsiPeriod})`}</dt>
                <dd>{result.rsi?.toFixed(1) ?? '—'}</dd>
              </div>
              <div>
                <dt>Source coverage</dt>
                <dd>
                  {result.covered} / {result.requested}
                </dd>
              </div>
            </dl>
            <button className="button secondary full-width" onClick={onReview}>
              Review paper trade
              <ArrowRight size={16} />
            </button>
          </div>
        </Panel>
        <Panel title="How signals work">
          <div className="prose padded">
            <p>
              <strong>Buy</strong> when sentiment meets your entry threshold and RSI stays below your ceiling.{' '}
              <strong>Sell</strong> when sentiment meets your exit threshold. Otherwise, <strong>Hold</strong>
              .
            </p>
            <p>
              Live signals wait when the market stream is paused, reconnecting or stale, when an enabled
              sentiment source is missing or older than 15 minutes, or when price history is still warming up.
            </p>
            <p>
              Rules generate research signals. They do not submit exchange orders. Use Strategy lab to test
              the rules against historical candles.
            </p>
            <a className="text-link" href="#backtest">
              Test this strategy
              <ArrowRight size={14} />
            </a>
          </div>
        </Panel>
      </div>
    </div>
  );
}
