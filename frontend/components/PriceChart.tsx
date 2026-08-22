"use client";

import { PricePoint } from "@/hooks/usePriceHistory";

interface PriceChartProps {
  points: PricePoint[];
  strike: number | null;
  loading: boolean;
  height?: number;
}

const VB_W = 900;
const VB_H = 300;
const PAD = 8;

/** Hand-rolled SVG area chart of real Reflector spot-price history, with
 * the selected series' strike drawn as a labeled dashed line — the one
 * thing a third-party chart widget can't do from the outside. Self-contained
 * on purpose: full control over the strike overlay beats another library. */
export function PriceChart({ points, strike, loading, height = 300 }: PriceChartProps) {
  if (loading && points.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-umbra-faint" style={{ height }}>
        Loading price history…
      </div>
    );
  }
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center text-xs text-umbra-faint" style={{ height }}>
        No price history yet
      </div>
    );
  }

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (strike !== null) {
    min = Math.min(min, strike);
    max = Math.max(max, strike);
  }
  const span = max - min || max * 0.01 || 1;
  min -= span * 0.08;
  max += span * 0.08;

  const x = (i: number) => PAD + (i / (points.length - 1)) * (VB_W - PAD * 2);
  const y = (v: number) => VB_H - PAD - ((v - min) / (max - min)) * (VB_H - PAD * 2);

  const linePoints = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const areaPoints = `${x(0)},${VB_H} ${linePoints} ${x(points.length - 1)},${VB_H}`;
  const last = points[points.length - 1];
  const strikeY = strike !== null ? y(strike) : null;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="umbra-price-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#18d26e" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#18d26e" stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0.2, 0.4, 0.6, 0.8].map((f) => (
        <line key={f} x1={0} y1={VB_H * f} x2={VB_W} y2={VB_H * f} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      ))}

      {strikeY !== null && (
        <>
          <line x1={0} y1={strikeY} x2={VB_W} y2={strikeY} stroke="#f2b84b" strokeWidth={1.2} strokeDasharray="5 5" />
          <text x={VB_W - 4} y={strikeY - 6} fill="#f2b84b" fontSize={12} textAnchor="end" fontFamily="var(--font-mono), monospace">
            strike ${strike!.toFixed(4)}
          </text>
        </>
      )}

      <polygon points={areaPoints} fill="url(#umbra-price-fill)" />
      <polyline points={linePoints} fill="none" stroke="#18d26e" strokeWidth={2} />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={3.5} fill="#18d26e" />
    </svg>
  );
}
