import { useEffect, useRef, useState } from 'react';
import { money } from './lib/engine';
import type { BacktestResult } from './types';

export default function EquityChart({ result, capital }: { result: BacktestResult; capital: number }) {
  const ref = useRef<SVGSVGElement>(null),
    [width, setWidth] = useState(720);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => setWidth(Math.max(220, entries[0].contentRect.width)));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const plotWidth = width - 72;
  const values = [capital, ...result.equity.map((e) => e.value)],
    min = Math.min(...values) * 0.999,
    max = Math.max(...values) * 1.001;
  const y = (v: number) => 185 - ((v - min) / (max - min)) * 160;
  const path = values
    .map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1)) * plotWidth},${y(v)}`)
    .join(' ');
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${width} 210`}
      className="equity-chart"
      role="img"
      aria-label={`Equity started at ${money(capital)} and ended at ${money(result.finalEquity)}.`}
    >
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <line
            x1="0"
            x2={plotWidth}
            y1={25 + i * 53}
            y2={25 + i * 53}
            stroke="var(--chart-grid)"
            strokeDasharray="3 5"
          />
          <text x={plotWidth + 10} y={29 + i * 53} fill="var(--muted)">
            {money(max - ((max - min) * i) / 3, 0)}
          </text>
        </g>
      ))}
      <path d={`${path} L${plotWidth},190 L0,190Z`} fill="var(--positive-soft)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}
