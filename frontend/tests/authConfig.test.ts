// Configuración de login con reintentos (el botón Microsoft no debe quedar
// inutilizado por un 502 transitorio tras reiniciar el servidor).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAuthConfigWithRetry, SAFE_AUTH_CONFIG } from "../src/lib/authConfig.ts";

const CFG = { ssoConfigured: true, devLoginEnabled: false, allowedDomain: "uta.edu.ec", microsoftSimulateEnabled: false };
const noSleep = async () => {};

test("un 502 transitorio no deja el login sin configuración: reintenta y la obtiene", async () => {
  let calls = 0;
  const cfg = await fetchAuthConfigWithRetry(async () => { calls++; if (calls < 3) throw new Error("502"); return CFG; }, [0, 2000, 5000], noSleep);
  assert.deepEqual(cfg, CFG);
  assert.equal(calls, 3);
});

test("si todos los intentos fallan devuelve null (el llamador usa la config segura)", async () => {
  const cfg = await fetchAuthConfigWithRetry(async () => { throw new Error("down"); }, [0, 1, 1], noSleep);
  assert.equal(cfg, null);
  assert.equal(SAFE_AUTH_CONFIG.microsoftSimulateEnabled, false);
  assert.equal(SAFE_AUTH_CONFIG.ssoConfigured, false);
});

test("respeta la cancelación (componente desmontado)", async () => {
  let calls = 0;
  const cfg = await fetchAuthConfigWithRetry(async () => { calls++; throw new Error("x"); }, [0, 1, 1], noSleep, () => calls >= 1);
  assert.equal(cfg, null);
  assert.equal(calls, 1);
});

test("espera entre reintentos según la lista de demoras", async () => {
  const waited: number[] = [];
  await fetchAuthConfigWithRetry(async () => { throw new Error("x"); }, [0, 2000, 5000], async (ms) => { waited.push(ms); });
  assert.deepEqual(waited, [2000, 5000]);
});
