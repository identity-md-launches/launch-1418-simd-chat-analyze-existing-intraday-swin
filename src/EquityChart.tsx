import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { money } from './lib/engine';
import type { BacktestResult } from './types';

export default function EquityChart({ result, capital }: { result: BacktestResult; capital: number }) {
  const ref = useRef<SVGSVGElement>(null),
    [width, setWidth] = useState(720);
  const [labelWidth, setLabelWidth] = useState(62);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => setWidth(Math.max(220, entries[0].contentRect.width)));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const values = [capital, ...result.equity.map((e) => e.value)],
    min = Math.min(...values) * 0.999,
    max = Math.max(...values) * 1.001;
  const labels = [0, 1, 2, 3].map(i => money(max - ((max - min) * i) / 3, 0));
  const labelKey = labels.join('|');
  useLayoutEffect(() => {
    let active = true;
    const measure = () => {
      if (active && ref.current)
        setLabelWidth(Math.ceil(Math.max(...Array.from(ref.current.querySelectorAll('text'), text => text.getBBox().width))));
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => { active = false; };
  }, [labelKey, width]);
  const plotWidth = width - labelWidth - 14;
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
          <text x={width - 4} y={29 + i * 53} textAnchor="end" fill="var(--muted)">
            {labels[i]}
          </text>
        </g>
      ))}
      <path d={`${path} L${plotWidth},190 L0,190Z`} fill="var(--positive-soft)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}
