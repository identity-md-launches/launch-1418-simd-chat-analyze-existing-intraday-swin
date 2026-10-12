import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react';
import { aggregateCandles, compact, indicators, money, timeLabel } from './lib/engine';
import type { Candle } from './types';

export function Sparkline({ values, positive = true }: { values: number[]; positive?: boolean }) {
  if (!values.length) return null;
  const min = Math.min(...values),
    max = Math.max(...values),
    scale = max - min || 1;
  const path = values
    .map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1 || 1)) * 110},${35 - ((v - min) / scale) * 28}`)
    .join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 110 42" aria-hidden="true">
      <path d={`${path} L110,42 L0,42 Z`} fill={positive ? 'var(--positive-soft)' : 'var(--negative-soft)'} />
      <path d={path} fill="none" stroke={positive ? 'var(--accent)' : 'var(--negative)'} strokeWidth="1.6" />
    </svg>
  );
}
export default function Chart({ candles, asset }: { candles: Candle[]; asset: string }) {
  const [interval, setInterval] = useState(15),
    [overlays, setOverlays] = useState(['Adaptive', 'Volume']),
    [inspect, setInspect] = useState<number | null>(null),
    [expanded, setExpanded] = useState(false);
  const container = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(720);
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(260, entries[0].contentRect.width - 20)),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const { bars, technical } = useMemo(() => {
    const all = aggregateCandles(candles, interval),
      full = indicators(all),
      count = width < 480 ? 32 : 64;
    return {
      bars: all.slice(-count),
      technical: {
        vwap: full.vwap.slice(-count),
        rsi: full.rsi.slice(-count),
        macd: full.macd.slice(-count),
        signal: full.signal.slice(-count),
        histogram: full.histogram.slice(-count),
        adaptive: {
          ema: full.adaptive.ema.slice(-count),
          upper: full.adaptive.upper.slice(-count),
          lower: full.adaptive.lower.slice(-count),
          rsi: full.adaptive.rsi.slice(-count),
          periods: full.adaptive.periods.slice(-count),
          rsiPeriods: full.adaptive.rsiPeriods.slice(-count),
          regimes: full.adaptive.regimes.slice(-count),
          ratio: full.adaptive.volatilityRatio.slice(-count),
        },
      },
    };
  }, [candles, interval, width]);
  if (!bars.length)
    return <div className="empty-state">No price history. Refresh the connected service.</div>;
  const chartWidth = width,
    plotWidth = width - 76,
    height = expanded ? 380 : 266,
    plotTop = 24,
    plotBottom = height - 48;
  const adaptive = overlays.includes('Adaptive');
  const bandValues = adaptive
    ? [...technical.adaptive.upper, ...technical.adaptive.lower].filter((v): v is number => v !== null)
    : [];
  const min = Math.min(
      ...bars.map((c) => c.low),
      ...bandValues,
      ...(overlays.includes('VWAP') ? technical.vwap : []),
    ),
    max = Math.max(
      ...bars.map((c) => c.high),
      ...bandValues,
      ...(overlays.includes('VWAP') ? technical.vwap : []),
    ),
    delta = max - min || 1;
  const low = min - delta * 0.12,
    high = max + delta * 0.12;
  const x = (i: number) => 14 + (i / (bars.length - 1 || 1)) * (plotWidth - 24),
    y = (v: number) => plotBottom - ((v - low) / (high - low)) * (plotBottom - plotTop);
  const selectedRsi = adaptive ? technical.adaptive.rsi : technical.rsi;
  const selected = inspect === null ? bars.length - 1 : Math.min(inspect, bars.length - 1),
    candle = bars[selected];
  const path = (values: (number | null)[], scale: (v: number) => number) =>
    values
      .map((v, i) =>
        v === null ? '' : `${i === 0 || values[i - 1] === null ? 'M' : 'L'} ${x(i)} ${scale(v)}`,
      )
      .join(' ');
  const maxVolume = Math.max(...bars.map((c) => c.volume), 1),
    candleWidth = Math.max(3, ((plotWidth - 24) / bars.length) * 0.58);
  function toggle(name: string) {
    setOverlays((prev) => (prev.includes(name) ? prev.filter((v) => v !== name) : [...prev, name]));
  }
  const labels = ['5m', '15m', '1h', '4h'],
    tickCount = width < 480 ? 3 : 6;
  return (
    <div ref={container} className={`technical-chart ${expanded ? 'expanded-chart' : ''}`}>
      <div className="chart-toolbar">
        <div className="segmented" aria-label="Candle interval">
          {[5, 15, 60, 240].map((v, i) => (
            <button
              key={v}
              className={interval === v ? 'selected' : ''}
              aria-pressed={interval === v}
              onClick={() => {
                setInterval(v);
                setInspect(null);
              }}
            >
              {labels[i]}
            </button>
          ))}
        </div>
        <div className="chart-tools">
          <span className="muted small-text">USD</span>
          <button
            className="icon-button"
            aria-label={expanded ? 'Reduce chart height' : 'Expand chart height'}
            aria-pressed={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <Maximize2 size={16} />
          </button>
        </div>
      </div>
      <div className="adaptive-chart-meta">
        <span>
          <span className="chart-key adaptive-key" />
          {adaptive
            ? `Adaptive EMA (${technical.adaptive.periods.at(-1)}) ${money(technical.adaptive.ema.at(-1)!)} + bands`
            : 'Standard indicators'}
        </span>
        <span>
          {technical.adaptive.regimes.at(-1)} volatility · {technical.adaptive.ratio.at(-1)?.toFixed(2)}×
          baseline
        </span>
      </div>
      <div className="chart-legend">
        <span>
          <span className="chart-key price-key" />
          {asset}/USD
        </span>
        <span>
          O <b>{money(candle.open)}</b>
        </span>
        <span>
          H <b>{money(candle.high)}</b>
        </span>
        <span>
          L <b>{money(candle.low)}</b>
        </span>
        <span>
          C{' '}
          <b className={candle.close >= candle.open ? 'positive-text' : 'negative-text'}>
            {money(candle.close)}
          </b>
        </span>
      </div>
      <svg
        className="price-chart"
        viewBox={`0 0 ${chartWidth} ${height}`}
        role="img"
        aria-label={`${asset} ${labels[[5, 15, 60, 240].indexOf(interval)]} candlestick chart. Latest close ${money(bars.at(-1)!.close)}. Use candle inspection controls below for exact values.`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setInspect(
            Math.max(
              0,
              Math.min(
                bars.length - 1,
                Math.round(
                  ((((e.clientX - r.left) / r.width) * chartWidth - 14) / (plotWidth - 24)) *
                    (bars.length - 1),
                ),
              ),
            ),
          );
        }}
        onPointerLeave={() => setInspect(null)}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const val = low + ((high - low) * i) / 4;
          return (
            <g key={i}>
              <line
                x1="0"
                y1={y(val)}
                x2={plotWidth}
                y2={y(val)}
                stroke="var(--chart-grid)"
                strokeDasharray="3 5"
              />
              <text x={plotWidth + 10} y={y(val) + 4} fill="var(--muted)">
                {val.toLocaleString('en-US', { maximumFractionDigits: asset === 'BTC' ? 0 : 1 })}
              </text>
            </g>
          );
        })}
        {Array.from({ length: tickCount }, (_, i) => (
          <g key={i}>
            <line
              x1={(i * plotWidth) / (tickCount - 1)}
              y1={plotTop}
              x2={(i * plotWidth) / (tickCount - 1)}
              y2={plotBottom}
              stroke="var(--chart-grid)"
              strokeDasharray="3 5"
            />
            <text
              x={(i * plotWidth) / (tickCount - 1)}
              y={height - 12}
              textAnchor={i === 0 ? 'start' : i === tickCount - 1 ? 'end' : 'middle'}
              fill="var(--muted)"
            >
              {timeLabel(bars[Math.round((i * (bars.length - 1)) / (tickCount - 1))].time)}
            </text>
          </g>
        ))}
        {overlays.includes('Volume') &&
          bars.map((c, i) => (
            <rect
              key={`v${i}`}
              x={x(i) - candleWidth / 2}
              y={plotBottom - (c.volume / maxVolume) * 43}
              width={candleWidth}
              height={(c.volume / maxVolume) * 43}
              fill={c.close >= c.open ? 'var(--volume-up)' : 'var(--volume-down)'}
            />
          ))}
        {adaptive && (
          <g>
            <path
              d={path(technical.adaptive.upper, y)}
              fill="none"
              stroke="var(--chart-line)"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            <path
              d={path(technical.adaptive.lower, y)}
              fill="none"
              stroke="var(--chart-line)"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
            <path
              d={path(technical.adaptive.ema, y)}
              fill="none"
              stroke="var(--chart-line)"
              strokeWidth="1.8"
            />
          </g>
        )}
        {bars.map((c, i) => (
          <g
            key={c.time}
            fill={c.close >= c.open ? 'var(--accent)' : 'var(--negative)'}
            stroke={c.close >= c.open ? 'var(--accent)' : 'var(--negative)'}
          >
            <line x1={x(i)} y1={y(c.high)} x2={x(i)} y2={y(c.low)} strokeWidth="1" />
            <rect
              x={x(i) - candleWidth / 2}
              y={Math.min(y(c.open), y(c.close))}
              width={candleWidth}
              height={Math.max(1, Math.abs(y(c.open) - y(c.close)))}
              stroke="none"
            />
          </g>
        ))}
        {overlays.includes('VWAP') && (
          <path d={path(technical.vwap, y)} fill="none" stroke="var(--chart-vwap)" strokeWidth="1.6" />
        )}
        <line
          x1="0"
          x2={plotWidth}
          y1={y(bars.at(-1)!.close)}
          y2={y(bars.at(-1)!.close)}
          stroke="var(--accent)"
          strokeWidth=".8"
          strokeDasharray="4 4"
        />
        <rect
          x={plotWidth + 1}
          y={y(bars.at(-1)!.close) - 10}
          width="73"
          height="20"
          rx="3"
          fill="var(--accent)"
        />
        <text x={plotWidth + 37} y={y(bars.at(-1)!.close) + 4} textAnchor="middle" fill="var(--on-accent)">
          {bars.at(-1)!.close.toLocaleString('en-US', { maximumFractionDigits: asset === 'BTC' ? 0 : 2 })}
        </text>
        {inspect !== null && (
          <line
            x1={x(selected)}
            x2={x(selected)}
            y1={plotTop}
            y2={plotBottom}
            stroke="var(--text)"
            strokeDasharray="3 3"
          />
        )}
      </svg>
      {overlays.includes('RSI') && (
        <div className="indicator-panel">
          <div className="indicator-label">
            {adaptive ? `Adaptive RSI (${technical.adaptive.rsiPeriods[selected]})` : 'RSI (14)'}{' '}
            <b>{selectedRsi[selected]?.toFixed(2) ?? 'Warming up'}</b>
            <span>30 / 70 levels</span>
          </div>
          <svg
            viewBox={`0 0 ${chartWidth} 85`}
            role="img"
            aria-label={`${adaptive ? 'Adaptive RSI' : 'RSI 14'}: ${selectedRsi[selected]?.toFixed(2) ?? 'warming up'}`}
          >
            <rect x="0" width={plotWidth} y="22" height="32" fill="var(--indicator-band)" />
            {[30, 70].map((v) => (
              <line
                key={v}
                x1="0"
                x2={plotWidth}
                y1={78 - v * 0.8}
                y2={78 - v * 0.8}
                stroke="var(--muted)"
                strokeDasharray="4 6"
              />
            ))}
            <path
              d={path(selectedRsi, (v) => 78 - v * 0.8)}
              stroke="var(--chart-line)"
              strokeWidth="1.7"
              fill="none"
            />
          </svg>
        </div>
      )}
      {overlays.includes('MACD') && (
        <div className="indicator-panel">
          <div className="indicator-label">
            MACD (12, 26, 9) <b>{technical.macd[selected]?.toFixed(2)}</b>
            <span>Line / signal / histogram</span>
          </div>
          <svg
            viewBox={`0 0 ${chartWidth} 85`}
            role="img"
            aria-label={`MACD ${technical.macd[selected]?.toFixed(2)}, signal ${technical.signal[selected]?.toFixed(2)}`}
          >
            {(() => {
              const maxAbs = Math.max(...technical.macd.map(Math.abs), ...technical.signal.map(Math.abs), 1),
                sy = (v: number) => 43 - (v / maxAbs) * 35;
              return (
                <>
                  <line x1="0" x2={plotWidth} y1="43" y2="43" stroke="var(--chart-grid)" />
                  {technical.histogram.map((v, i) => (
                    <rect
                      key={i}
                      x={x(i) - 2}
                      y={Math.min(43, sy(v))}
                      width="4"
                      height={Math.max(1, Math.abs(sy(v) - 43))}
                      fill={v >= 0 ? 'var(--accent)' : 'var(--negative)'}
                    />
                  ))}
                  <path d={path(technical.macd, sy)} stroke="var(--chart-line)" fill="none" />
                  <path d={path(technical.signal, sy)} stroke="var(--warning)" fill="none" />
                </>
              );
            })()}
          </svg>
        </div>
      )}
      <div className="chart-bottom">
        <div className="indicator-buttons" aria-label="Chart indicators">
          {['Adaptive', 'VWAP', 'RSI', 'MACD', 'Volume'].map((name) => (
            <button
              key={name}
              onClick={() => toggle(name)}
              aria-pressed={overlays.includes(name)}
              className={overlays.includes(name) ? 'enabled' : ''}
            >
              <span className={`indicator-dot ${name.toLowerCase()}`} />
              {name}
            </button>
          ))}
        </div>
        <div className="candle-inspector">
          <button
            className="icon-button"
            aria-label="Inspect previous candle"
            onClick={() => setInspect(Math.max(0, selected - 1))}
          >
            <ChevronLeft size={15} />
          </button>
          <span>{timeLabel(candle.time)} UTC</span>
          <button
            className="icon-button"
            aria-label="Inspect next candle"
            disabled={selected === bars.length - 1}
            onClick={() => setInspect(Math.min(bars.length - 1, selected + 1))}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="sr-only" aria-live="polite">
        Selected candle {timeLabel(candle.time)} UTC. Open {money(candle.open)}, high {money(candle.high)},
        low {money(candle.low)}, close {money(candle.close)}. Volume {compact(candle.volume)}. VWAP{' '}
        {money(technical.vwap[selected])}. Adaptive EMA {money(technical.adaptive.ema[selected])}.
        {technical.adaptive.upper[selected] !== null &&
          technical.adaptive.lower[selected] !== null &&
          ` Volatility band ${money(technical.adaptive.lower[selected]!)} to ${money(technical.adaptive.upper[selected]!)}.`}
        {selectedRsi[selected] !== null &&
          ` ${adaptive ? 'Adaptive ' : ''}RSI ${selectedRsi[selected]!.toFixed(1)}.`}
      </div>
    </div>
  );
}
