// Fase T — validación del dominio del servidor para el build Android.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error módulo .mjs sin tipos
import { validateAndroidApiUrl } from "../scripts/android-config.mjs";

test("acepta el origen https del servidor", () => {
  assert.deepEqual(validateAndroidApiUrl("https://servicedesk.nuevo.edu.ec"), { ok: true, origin: "https://servicedesk.nuevo.edu.ec" });
  assert.equal(validateAndroidApiUrl("https://servicedesk.nuevo.edu.ec/").ok, true);
});

test("rechaza ausencia, http, localhost, IP privada y rutas", () => {
  for (const bad of [undefined, "", "no-es-url", "http://servicedesk.nuevo.edu.ec", "https://localhost:8080",
    "https://127.0.0.1", "https://192.168.1.10", "https://10.0.0.5", "https://172.20.0.2", "https://sd.edu.ec/api"]) {
    assert.equal(validateAndroidApiUrl(bad).ok, false, String(bad));
  }
});
