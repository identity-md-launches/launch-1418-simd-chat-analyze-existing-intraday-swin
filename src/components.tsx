import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  ExternalLink,
  Newspaper,
  Radio,
  Waypoints,
  X,
} from 'lucide-react';
import { ASSETS } from './lib/data';
import { compact, sourceFreshness, timeLabel } from './lib/engine';
import type { Asset, FeedItem, Source, SourceKind } from './types';

export function AssetIcon({ asset, small = false }: { asset: Asset; small?: boolean }) {
  const spec = ASSETS.find((a) => a.symbol === asset)!;
  return (
    <span
      aria-hidden="true"
      className={`asset-icon ${small ? 'small' : ''}`}
      style={{ color: spec.color, background: `${spec.color}16` }}
    >
      <svg
        viewBox="0 0 24 24"
        width={small ? 17 : 25}
        height={small ? 17 : 25}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {asset === 'BTC' ? (
          <>
            <path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H8m0 0h6a3.5 3.5 0 0 1 0 7H7M9 5v14M11 2v3m4-3v3m-4 14v3m4-3v3" />
          </>
        ) : asset === 'ETH' ? (
          <>
            <path d="m12 2 6 10-6 4-6-4 6-10Z" />
            <path d="m6 15 6 7 6-7-6 4-6-4Z" fill="currentColor" stroke="none" />
          </>
        ) : asset === 'SOL' ? (
          <>
            <path
              d="M6 5h13l-3 3H3l3-3Zm-3 6h13l3 3H6l-3-3Zm3 6h13l-3 3H3l3-3Z"
              fill="currentColor"
              stroke="none"
            />
          </>
        ) : (
          <>
            <path d="m12 3 9 9-9 9-9-9 9-9Z" />
            <path d="m12 8 4 4-4 4-4-4 4-4Z" fill="currentColor" stroke="none" />
          </>
        )}
      </svg>
    </span>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'positive' | 'negative' | 'neutral' | 'warning' | 'accent';
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Change({ value }: { value: number }) {
  return (
    <span className={`change ${value >= 0 ? 'positive-text' : 'negative-text'}`}>
      {value >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {Math.abs(value).toFixed(2)}%
    </span>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = '',
  headingRef,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <div>
            <h2 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</h2>
            {subtitle && <p className="muted small-text">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function SourceIcon({ kind, size = 16 }: { kind: SourceKind; size?: number }) {
  const Icon = kind === 'Social' ? Radio : kind === 'News' ? Newspaper : Waypoints;
  return <Icon size={size} aria-hidden="true" />;
}
export function Gauge({ score }: { score: number | null }) {
  const label =
    score === null ? 'Unavailable' : score >= 65 ? 'Bullish' : score <= 35 ? 'Bearish' : 'Neutral';
  return (
    <div
      className="gauge"
      role="img"
      aria-label={`Aggregated sentiment: ${score ?? 'unavailable'} out of 100, ${label}`}
    >
      <svg viewBox="0 0 220 142" aria-hidden="true">
        <path
          d="M 24 116 A 86 86 0 0 1 196 116"
          pathLength="100"
          fill="none"
          stroke="var(--surface-raised)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          d="M 24 116 A 86 86 0 0 1 196 116"
          pathLength="100"
          fill="none"
          stroke={score !== null && score <= 35 ? 'var(--negative)' : 'var(--accent)'}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${score ?? 0} 100`}
        />
        <path
          d="M24 116 A86 86 0 0 1 196 116"
          pathLength="100"
          fill="none"
          stroke="var(--surface)"
          strokeWidth="15"
          strokeDasharray=".8 9.2"
        />
      </svg>
      <div className="gauge-value">
        <strong>{score ?? '—'}</strong>
        <span className="muted">out of 100</span>
      </div>
      <div className="gauge-ends">
        <span>Bearish</span>
        <Badge
          tone={score === null ? 'neutral' : score <= 35 ? 'negative' : score >= 65 ? 'positive' : 'neutral'}
        >
          {label}
        </Badge>
        <span>Bullish</span>
      </div>
    </div>
  );
}
export function SourceBars({ sources }: { sources: Source[] }) {
  return (
    <div className="source-bars">
      {sources.map((s) => (
        <div className="source-row" key={s.kind}>
          <div className="source-label">
            <SourceIcon kind={s.kind} />
            <span>{s.kind}</span>
            <strong>
              {s.score ?? '—'}
              <span className="sr-only"> out of 100</span>
            </strong>
          </div>
          <div className="bar-track">
            <span
              style={{ width: `${s.score ?? 0}%` }}
              className={s.kind === 'News' ? 'news-bar' : s.kind === 'On-chain' ? 'chain-bar' : ''}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
export function SourceStatus({ source, asOf, demo }: { source?: Source; asOf: number; demo: boolean }) {
  const status = sourceFreshness(source, asOf);
  return (
    <Badge tone={status === 'ready' ? (demo ? 'neutral' : 'positive') : 'warning'}>
      {status === 'ready' ? (demo ? 'Demo' : 'Ready') : status === 'stale' ? 'Stale' : 'Unavailable'}
    </Badge>
  );
}
export function Feed({ items, asOf, limit, empty = 'unavailable' }: {
  items: FeedItem[]; asOf: number; limit?: number;
  empty?: 'unconnected' | 'unavailable' | 'filtered';
}) {
  if (!items.length)
    return (
      <div className="empty-state">
        <Radio size={24} aria-hidden="true" />
        <h3>{empty === 'unconnected' ? 'No sentiment service connected' : empty === 'filtered' ? 'No matching activity' : 'No source activity yet'}</h3>
        <p>{empty === 'unconnected'
          ? 'Connect a sentiment service to load source activity.'
          : empty === 'filtered'
            ? 'Choose another source or clear the search to see more activity.'
            : 'The sentiment service has returned no activity. Check source availability in Connections.'}</p>
        {empty !== 'filtered' && <a className="button secondary" href="#connections">Open Connections</a>}
      </div>
    );
  return (
    <div className="feed-list">
      {items.slice(0, limit).map((item) => (
        <article className="feed-item" key={item.id}>
          <span
            className={`feed-icon ${item.kind === 'News' ? 'news' : item.kind === 'On-chain' ? 'chain' : ''}`}
          >
            <SourceIcon kind={item.kind} size={18} />
          </span>
          <div className="feed-copy">
            <div className="feed-meta">
              <span>{item.publisher}</span>
              <span>·</span>
              <span>{Math.max(0, Math.floor((asOf - item.time) / 60))}m ago</span>
            </div>
            <h3>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                  <ExternalLink size={12} />
                </a>
              ) : (
                item.title
              )}
            </h3>
            <span className="feed-kind">{item.kind}</span>
          </div>
          <Badge tone={item.score >= 65 ? 'positive' : item.score <= 40 ? 'negative' : 'neutral'}>
            {item.score >= 65 ? 'Bullish' : item.score <= 40 ? 'Bearish' : 'Neutral'}
          </Badge>
        </article>
      ))}
    </div>
  );
}
export function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      {detail && <div className="metric-detail">{detail}</div>}
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
            onClose();
        }
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function InlineSuccess({ children }: { children: ReactNode }) {
  return (
    <div className="inline-success" role="status">
      <Check size={16} />
      {children}
    </div>
  );
}
export function SmallLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="text-link" href={href}>
      {children}
      <ChevronRight size={14} />
    </a>
  );
}
export function DataFooter({ demo, asOf, count }: { demo: boolean; asOf: number; count: number }) {
  return (
    <div className="data-footer">
      <span>
        <span className={`status-dot ${demo ? 'demo' : ''}`} />
        {demo ? 'Synthetic demo data' : 'Connected data'} · {timeLabel(asOf)} UTC
      </span>
      <span>{compact(count)} observations</span>
    </div>
  );
}
