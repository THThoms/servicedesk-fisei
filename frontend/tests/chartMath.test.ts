// Gráficos de reportes/estadísticas: eje Y sin valores repetidos y anillo al 100 %.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ringSlicePath, yTicks } from "../src/components/charts/chartMath.ts";

test("eje Y con máximo 2: 0,1,2 (antes mostraba 0,1,1,2,2)", () => {
  assert.deepEqual(yTicks(2).map((t) => t.value), [0, 1, 2]);
  assert.deepEqual(yTicks(2).map((t) => t.fraction), [0, 0.5, 1]);
});
test("eje Y: cada valor aparece una sola vez y su posición es exacta", () => {
  for (const max of [1, 3, 5, 7, 8, 9, 13, 40, 101]) {
    const t = yTicks(max);
    assert.equal(new Set(t.map((x) => x.value)).size, t.length, `max=${max}`);
    for (const x of t) assert.ok(Math.abs(x.fraction - x.value / max) < 1e-9);
  }
});
test("anillo: un sector del 100 % produce un trazado dibujable (antes vacío)", () => {
  const full = ringSlicePath(80, 80, 74, 46, 0, Math.PI * 2);
  assert.match(full, /^M 80 6 A 74 74 0 1 1 80 154/);
  assert.equal((full.match(/A /g) ?? []).length, 4);
  const half = ringSlicePath(80, 80, 74, 46, 0, Math.PI);
  assert.equal((half.match(/A /g) ?? []).length, 2);
});
