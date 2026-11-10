// Fase R — tests de las reglas de compresión (node --test, sin dependencias).
//   cd frontend && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  targetDimensions,
  chooseOutputType,
  isHeic,
  isAcceptedInput,
  renameFor,
  MAX_DIMENSION,
  KEEP_SMALL_PNG_BYTES,
} from "../src/lib/imageCompressionCore.ts";

test("lado mayor ≤ 1920 px, proporción conservada, nunca amplía", () => {
  assert.deepEqual(targetDimensions(4032, 3024), { width: 1920, height: 1440, resized: true });
  assert.deepEqual(targetDimensions(3024, 4032), { width: 1440, height: 1920, resized: true });
  assert.deepEqual(targetDimensions(1920, 1080), { width: 1920, height: 1080, resized: false });
  assert.deepEqual(targetDimensions(800, 600), { width: 800, height: 600, resized: false });
  assert.equal(Math.max(...Object.values(targetDimensions(10000, 37)).slice(0, 2) as number[]), MAX_DIMENSION);
  assert.equal(targetDimensions(10000, 1).height, 1);
});

test("fotografías → JPEG; transparencia → PNG; WebP con alfa → WebP si se puede codificar", () => {
  const base = { resized: true, inputBytes: 3_000_000, webpEncodeSupported: true };
  assert.equal(chooseOutputType({ ...base, inputType: "image/jpeg", hasAlpha: false }), "image/jpeg");
  assert.equal(chooseOutputType({ ...base, inputType: "image/png", hasAlpha: false }), "image/jpeg");
  assert.equal(chooseOutputType({ ...base, inputType: "image/png", hasAlpha: true }), "image/png");
  assert.equal(chooseOutputType({ ...base, inputType: "image/webp", hasAlpha: true }), "image/webp");
  assert.equal(chooseOutputType({ ...base, inputType: "image/webp", hasAlpha: true, webpEncodeSupported: false }), "image/png");
  assert.equal(chooseOutputType({ ...base, inputType: "image/webp", hasAlpha: false }), "image/jpeg");
});

test("PNG pequeño sin redimensionar ni transparencia se conserva (capturas nítidas)", () => {
  const p = { inputType: "image/png", hasAlpha: false, resized: false, webpEncodeSupported: true };
  assert.equal(chooseOutputType({ ...p, inputBytes: KEEP_SMALL_PNG_BYTES }), "image/png");
  assert.equal(chooseOutputType({ ...p, inputBytes: KEEP_SMALL_PNG_BYTES + 1 }), "image/jpeg");
});

test("HEIC se detecta por tipo o extensión (para rechazarlo con mensaje claro)", () => {
  assert.equal(isHeic({ type: "image/heic", name: "a.jpg" }), true);
  assert.equal(isHeic({ type: "image/heif", name: "a" }), true);
  assert.equal(isHeic({ type: "", name: "IMG_0001.HEIC" }), true);
  assert.equal(isHeic({ type: "image/jpeg", name: "foto.jpg" }), false);
});

test("entradas aceptadas: JPEG, PNG, WebP (también sin tipo pero con extensión válida)", () => {
  for (const type of ["image/jpeg", "image/jpg", "image/png", "image/webp"]) assert.equal(isAcceptedInput({ type, name: "x" }), true);
  assert.equal(isAcceptedInput({ type: "", name: "foto.webp" }), true);
  assert.equal(isAcceptedInput({ type: "image/gif", name: "x.gif" }), false);
  assert.equal(isAcceptedInput({ type: "application/pdf", name: "x.pdf" }), false);
});

test("el nombre final lleva la extensión del formato real", () => {
  assert.equal(renameFor("IMG_20261104.png", "image/jpeg"), "IMG_20261104.jpg");
  assert.equal(renameFor("captura", "image/png"), "captura.png");
  assert.equal(renameFor(".jpg", "image/webp"), "imagen.webp");
});
