// Utilidades puras de los gráficos SVG (probadas en tests/chartMath.test.ts).

/** Azul institucional UTA (paleta de tailwind `uta-700`). */
export const UTA_CHART_BLUE = "#1D4ED8";

/**
 * Marcas del eje Y sin valores repetidos ni engañosos: con pocos valores
 * (máximo < 8) solo enteros reales (0,1,2…); con más, cuartiles redondeados.
 * Devuelve [{ value, fraction }] donde fraction = value / max (0 abajo, 1 arriba).
 */
export function yTicks(maxValue: number): { value: number; fraction: number }[] {
  const max = Math.max(1, maxValue);
  if (max < 8) {
    return Array.from({ length: Math.floor(max) + 1 }, (_, v) => ({ value: v, fraction: v / max }));
  }
  const seen = new Set<number>();
  return [0, 0.25, 0.5, 0.75, 1]
    .map((p) => ({ value: Math.round(max * p), fraction: Math.round(max * p) / max }))
    .filter((t) => (seen.has(t.value) ? false : (seen.add(t.value), true)));
}

/**
 * Trazado de un sector de anillo. Un sector del 100 % no se puede dibujar con
 * un único arco SVG (inicio = fin): se dibuja el anillo completo con dos
 * semicírculos y fill-rule evenodd.
 */
export function ringSlicePath(
  cx: number, cy: number, r: number, ir: number, start: number, end: number
): string {
  const TAU = Math.PI * 2;
  if (end - start >= TAU - 1e-6) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z ` +
      `M ${cx} ${cy - ir} A ${ir} ${ir} 0 1 0 ${cx} ${cy + ir} A ${ir} ${ir} 0 1 0 ${cx} ${cy - ir} Z`;
  }
  const polar = (a: number, rad: number) => ({ x: cx + Math.cos(a - Math.PI / 2) * rad, y: cy + Math.sin(a - Math.PI / 2) * rad });
  const large = end - start > Math.PI ? 1 : 0;
  const p1 = polar(start, r), p2 = polar(end, r), p3 = polar(end, ir), p4 = polar(start, ir);
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${ir} ${ir} 0 ${large} 0 ${p4.x} ${p4.y} Z`;
}
