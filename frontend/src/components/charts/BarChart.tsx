// Gráfico de barras horizontal / vertical en SVG puro.
// Variants:
//   - "horizontal": etiquetas a la izquierda, barras horizontales (ideal para
//     listas largas como tickets por técnico o por servicio).
//   - "vertical":   barras verticales con etiquetas debajo.

import { useMemo, useState } from "react";
import { UTA_CHART_BLUE } from "./chartMath";

export interface BarItem {
  label: string;
  value: number;
  color?: string;
}

interface Props {
  title: string;
  data: BarItem[];
  variant?: "horizontal" | "vertical";
  defaultColor?: string;
  /** alto en px para el modo vertical */
  height?: number;
  /** valor máximo opcional (default = max(data)) */
  maxValue?: number;
}

export default function BarChart({
  title,
  data,
  variant = "horizontal",
  defaultColor = UTA_CHART_BLUE,
  height = 220,
  maxValue,
}: Props) {
  const computedMax = useMemo(
    () => Math.max(1, maxValue ?? Math.max(...data.map((d) => d.value), 1)),
    [data, maxValue]
  );
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div className="card">
      <h3 className="mb-3 text-sm font-semibold text-uta-900">{title}</h3>
      {data.length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-500">Sin datos.</p>
      ) : variant === "horizontal" ? (
        <ul className="space-y-2">
          {data.map((d, i) => {
            const pct = (d.value / computedMax) * 100;
            const isHover = hover === i;
            return (
              <li
                key={d.label}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className="group"
              >
                <div className="mb-0.5 flex justify-between text-xs text-gray-700">
                  <span className="truncate pr-2" title={d.label}>
                    {d.label}
                  </span>
                  <span className="font-semibold tabular-nums">{d.value}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-2.5 rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      background: d.color ?? defaultColor,
                      opacity: isHover ? 0.85 : 1,
                    }}
                    title={`${d.label}: ${d.value}`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <VerticalBars data={data} max={computedMax} height={height} defaultColor={defaultColor} />
      )}
    </div>
  );
}

function VerticalBars({
  data,
  max,
  height,
  defaultColor,
}: {
  data: BarItem[];
  max: number;
  height: number;
  defaultColor: string;
}) {
  const W = Math.max(360, data.length * 56);
  const padX = 24;
  const padY = 24;
  const innerH = height - padY * 2;
  const barW = (W - padX * 2) / data.length - 14;
  return (
    <div className="overflow-x-auto">
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`}>
        {/* Líneas de guía */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <line
            key={p}
            x1={padX}
            x2={W - padX}
            y1={padY + innerH * (1 - p)}
            y2={padY + innerH * (1 - p)}
            stroke="#f1f5f9"
            strokeWidth={1}
          />
        ))}
        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const x = padX + i * ((W - padX * 2) / data.length) + 7;
          const y = padY + (innerH - h);
          return (
            <g key={d.label}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={4}
                fill={d.color ?? defaultColor}
              >
                <title>
                  {d.label}: {d.value}
                </title>
              </rect>
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                style={{ fontSize: 10, fontWeight: 600 }}
                fill="#374151"
              >
                {d.value}
              </text>
              <text
                x={x + barW / 2}
                y={height - 6}
                textAnchor="middle"
                style={{ fontSize: 10 }}
                fill="#6b7280"
              >
                {d.label.length > 10 ? d.label.slice(0, 10) + "…" : d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
