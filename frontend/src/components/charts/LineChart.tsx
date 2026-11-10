// Gráfico de área/línea en SVG. Pensado para series temporales pequeñas (<=60
// puntos) como "tickets creados por día (últimos 30 días)".

import { useMemo } from "react";
import { UTA_CHART_BLUE, yTicks } from "./chartMath";

export interface LinePoint {
  date: string; // YYYY-MM-DD
  value: number;
}

interface Props {
  title: string;
  data: LinePoint[];
  color?: string;
  height?: number;
}

export default function LineChart({
  title,
  data,
  color = UTA_CHART_BLUE,
  height = 220,
}: Props) {
  const points = data;
  const total = useMemo(() => points.reduce((acc, p) => acc + p.value, 0), [points]);
  const maxValue = useMemo(() => Math.max(1, ...points.map((p) => p.value)), [points]);

  if (points.length === 0) {
    return (
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-uta-900">{title}</h3>
        <p className="py-6 text-center text-xs text-gray-500">Sin datos.</p>
      </div>
    );
  }

  const W = 560;
  const padX = 36;
  const padY = 22;
  const innerW = W - padX * 2;
  const innerH = height - padY * 2;

  const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW;
  const coords = points.map((p, i) => ({
    x: padX + i * stepX,
    y: padY + innerH * (1 - p.value / maxValue),
    raw: p,
  }));

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    linePath +
    ` L ${coords[coords.length - 1].x.toFixed(1)} ${(padY + innerH).toFixed(1)}` +
    ` L ${coords[0].x.toFixed(1)} ${(padY + innerH).toFixed(1)} Z`;

  // Mostrar solo un subset de etiquetas en X (5 puntos máximo) para no saturar.
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));

  return (
    <div className="card">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-uta-900">{title}</h3>
        <span className="text-xs text-gray-500">Total: {total}</span>
      </div>
      <div className="overflow-x-auto">
        <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`}>
          <defs>
            <linearGradient id="line-area-grad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {yTicks(maxValue).map(({ value, fraction }) => {
            const y = padY + innerH * (1 - fraction);
            return (
              <g key={value}>
                <line x1={padX} x2={W - padX} y1={y} y2={y} stroke="#f1f5f9" />
                <text x={padX - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
                  {value}
                </text>
              </g>
            );
          })}

          <path d={areaPath} fill="url(#line-area-grad)" />
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {coords.map((c, i) => (
            <g key={c.raw.date}>
              <circle cx={c.x} cy={c.y} r={3} fill="#fff" stroke={color} strokeWidth={2}>
                <title>
                  {c.raw.date}: {c.raw.value}
                </title>
              </circle>
              {i % labelEvery === 0 && (
                <text
                  x={c.x}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#6b7280"
                >
                  {c.raw.date.slice(5)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
