import { useRef, useState } from 'react';
import { fmtCp } from '../format';

export interface ChartSeries {
  name: string;
  /** Une valeur par demi-coup (centipawns, point de vue blancs), null si inconnue. */
  values: (number | null)[];
  color: string;
}

const CLAMP = 600;

/** Évolution de l'évaluation au cours de la partie (axe unique, ±6 pions). */
export function EvalChart({
  series,
  current,
  onSelect,
  height = 150,
}: {
  series: ChartSeries[];
  current?: number;
  onSelect?: (ply: number) => void;
  height?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const W = 600;
  const H = height;
  const padL = 34;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => {
    const c = Math.max(-CLAMP, Math.min(CLAMP, v));
    return padT + ((CLAMP - c) / (2 * CLAMP)) * (H - padT - padB);
  };
  const plyFromEvent = (clientX: number) => {
    const svg = ref.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const rx = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((rx - padL) / (W - padL - padR)) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  };
  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });
  const empty = series.every((s) => s.values.every((v) => v === null));
  return (
    <div className="chart">
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} /> {s.name}
          </span>
        ))}
        <span className="muted">axe : ±{CLAMP / 100} pions (blancs en haut)</span>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="chart-svg"
        onMouseMove={(e) => setHover(plyFromEvent(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const p = plyFromEvent(e.clientX);
          if (p !== null) onSelect?.(p);
        }}
      >
        {[-CLAMP, -300, 0, 300, CLAMP].map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className={v === 0 ? 'grid zero' : 'grid'} />
            <text x={padL - 4} y={y(v) + 3} className="axis" textAnchor="end">
              {v / 100}
            </text>
          </g>
        ))}
        {current !== undefined && <line x1={x(current)} x2={x(current)} y1={padT} y2={H - padB} className="cursor" />}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} className="crosshair" />}
        {paths.map((d, k) => (
          <path key={k} d={d} fill="none" stroke={series[k].color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
        {empty && (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="axis">
            Pas encore d’évaluations
          </text>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip">
          Demi-coup {hover}
          {series.map((s) => (
            <span key={s.name}>
              {' '}
              · {s.name} : <b>{fmtCp(s.values[hover] ?? null)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
