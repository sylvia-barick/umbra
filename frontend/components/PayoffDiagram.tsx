"use client";

interface PayoffDiagramProps {
  side: "call" | "put";
  strike: number; // dollars
  premiumPerUnit: number | null; // dollars per unit
  spot: number | null; // dollars
  tokenSymbol: string;
  height?: number;
}

const VB_W = 900;
const VB_H = 170;
const PAD_X = 8;
const PAD_TOP = 14;
const PAD_BOTTOM = 20;

/** P&L-per-unit at expiry vs. underlying price — the diagram that actually
 * tells you what a position is worth, which a price candle chart doesn't.
 * Payoff is a real max(0, ...) - premium calc, not a stylized illustration. */
export function PayoffDiagram({ side, strike, premiumPerUnit, spot, tokenSymbol, height = 170 }: PayoffDiagramProps) {
  if (premiumPerUnit === null) {
    return (
      <div className="flex items-center justify-center text-xs text-umbra-faint" style={{ height }}>
        Payoff unavailable — no live quote for this series yet
      </div>
    );
  }

  const breakeven = side === "call" ? strike + premiumPerUnit : strike - premiumPerUnit;
  const center = spot ?? strike;
  const span = Math.max(strike, center) - Math.min(strike, center) || strike * 0.1 || 1;
  const xMin = Math.max(0, Math.min(strike, center) - span * 1.6);
  const xMax = Math.max(strike, center) + span * 1.6;

  const payoffAt = (price: number) =>
    side === "call" ? Math.max(0, price - strike) - premiumPerUnit : Math.max(0, strike - price) - premiumPerUnit;

  const N = 60;
  const samples = Array.from({ length: N + 1 }, (_, i) => xMin + ((xMax - xMin) * i) / N);
  const payoffs = samples.map(payoffAt);
  const maxAbs = Math.max(...payoffs.map(Math.abs), premiumPerUnit) || 1;
  const yMin = -maxAbs * 1.15;
  const yMax = maxAbs * 1.15;

  const x = (price: number) => PAD_X + ((price - xMin) / (xMax - xMin)) * (VB_W - PAD_X * 2);
  const y = (v: number) => VB_H - PAD_BOTTOM - ((v - yMin) / (yMax - yMin)) * (VB_H - PAD_TOP - PAD_BOTTOM);
  const zeroY = y(0);

  const linePoints = samples.map((p, i) => `${x(p)},${y(payoffs[i])}`).join(" ");
  const breakevenX = x(breakeven);
  const strikeX = x(strike);
  const currentPnl = spot !== null ? payoffAt(spot) : null;

  // Simplified region shading either side of breakeven, matching which side
  // is loss vs profit for this option side — not a per-pixel fill of the
  // actual curve, just a visual cue.
  const lossPoly =
    side === "call"
      ? `${x(xMin)},${zeroY} ${x(xMin)},${VB_H - PAD_BOTTOM} ${breakevenX},${VB_H - PAD_BOTTOM} ${breakevenX},${zeroY}`
      : `${breakevenX},${zeroY} ${breakevenX},${VB_H - PAD_BOTTOM} ${x(xMax)},${VB_H - PAD_BOTTOM} ${x(xMax)},${zeroY}`;
  const profitPoly =
    side === "call"
      ? `${breakevenX},${zeroY} ${breakevenX},${PAD_TOP} ${x(xMax)},${PAD_TOP} ${x(xMax)},${zeroY}`
      : `${x(xMin)},${zeroY} ${x(xMin)},${PAD_TOP} ${breakevenX},${PAD_TOP} ${breakevenX},${zeroY}`;

  return (
    <div>
      <svg width="100%" height={height} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none">
        <line x1={0} y1={zeroY} x2={VB_W} y2={zeroY} stroke="#22262f" strokeWidth={1} />
        <polygon points={lossPoly} fill="#ff5c7218" />
        <polygon points={profitPoly} fill="#18d26e18" />

        <line x1={strikeX} y1={PAD_TOP} x2={strikeX} y2={VB_H - PAD_BOTTOM} stroke="#f2b84b" strokeWidth={1} strokeDasharray="4 4" />
        <text x={strikeX + 6} y={PAD_TOP + 10} fill="#f2b84b" fontSize={10} fontFamily="var(--font-mono), monospace">
          Strike ${strike.toFixed(2)}
        </text>

        <line x1={breakevenX} y1={PAD_TOP} x2={breakevenX} y2={VB_H - PAD_BOTTOM} stroke="#8b8fa0" strokeWidth={1} strokeDasharray="3 5" />
        <text x={breakevenX + 6} y={PAD_TOP + 22} fill="#8b8fa0" fontSize={10} fontFamily="var(--font-mono), monospace">
          Breakeven ${breakeven.toFixed(2)}
        </text>

        <polyline points={linePoints} fill="none" stroke="#e9eaef" strokeWidth={2} />

        {spot !== null && (
          <>
            <circle cx={x(spot)} cy={y(currentPnl!)} r={4} fill="#ff5c72" />
            <text x={x(spot)} y={VB_H - 4} fill="#ff5c72" fontSize={10} textAnchor="middle" fontFamily="var(--font-mono), monospace">
              spot ${spot.toFixed(2)}
            </text>
          </>
        )}
      </svg>

      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-umbra-border-soft px-1 pt-3 text-xs">
        <Stat label="Max loss" value={`-${premiumPerUnit.toFixed(4)} ${tokenSymbol}`} tone="put" />
        <Stat label="Breakeven" value={`$${breakeven.toFixed(4)}`} />
        {currentPnl !== null && (
          <Stat label="Current P&L / unit" value={`${currentPnl >= 0 ? "+" : ""}${currentPnl.toFixed(4)} ${tokenSymbol}`} tone={currentPnl >= 0 ? "call" : "put"} />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "call" | "put" }) {
  const color = tone === "call" ? "text-umbra-call" : tone === "put" ? "text-umbra-put" : "text-umbra-ink";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-umbra-faint">{label}</span>
      <span className={`font-mono tabular ${color}`}>{value}</span>
    </div>
  );
}
