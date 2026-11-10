// =============================================================================
// scripts/testing/dr-validate.mjs — validación funcional de un servidor RECUPERADO
//
// Usado por backup-dr-simulation.sh tras reconstruir ServiceDesk desde un
// snapshot cifrado. Comprueba, a través del API Gateway real:
//   login (contraseña temporal → cambio obligatorio → login con la nueva),
//   listado de tickets (total = manifest), historial de un ticket con eventos,
//   imágenes: cada adjunto se descarga por el endpoint autenticado y su SHA-256
//   coincide con uploads.sha256 del backup.
// Entrada por variables de entorno (las contraseñas se leen de archivos y
// NUNCA se imprimen): BASE, ADMIN_EMAIL_FILE, TEMP_PW_FILE, NEW_PW_FILE,
// TICKET_ID, EXPECT_TICKETS, SUMS_FILE.
// Salida: una línea JSON con los resultados; código 0 si todo pasa.
// =============================================================================
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const env = (k) => { const v = process.env[k]; if (!v) { console.error(`falta ${k}`); process.exit(2); } return v; };
const BASE = env("BASE");
const email = readFileSync(env("ADMIN_EMAIL_FILE"), "utf8").trim();
const tempPw = readFileSync(env("TEMP_PW_FILE"), "utf8").split(/\r?\n/)[0].trim();
const newPw = readFileSync(env("NEW_PW_FILE"), "utf8").trim();
const sums = new Set(readFileSync(env("SUMS_FILE"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split(/\s+/)[0]));
const results = {};
let ok = true;
const check = (name, cond) => { results[name] = !!cond; if (!cond) ok = false; };

async function call(method, path, token, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("json") ? await r.json().catch(() => null) : Buffer.from(await r.arrayBuffer()) };
}

const l1 = await call("POST", "/api/auth/login", null, { correo: email, password: tempPw });
check("login con contraseña temporal → exige cambio", l1.status === 200 && l1.body?.mustChangePassword === true);
const cp = await call("POST", "/api/auth/change-password", l1.body?.token, { currentPassword: tempPw, newPassword: newPw });
check("cambio de contraseña", cp.status === 200);
const l2 = await call("POST", "/api/auth/login", null, { correo: email, password: newPw });
const tok = l2.body?.token;
check("login del administrador restaurado", l2.status === 200 && !!tok && l2.body?.mustChangePassword !== true);

const hist = await call("GET", "/api/admin/tickets/history?limit=100", tok);
check("listado de tickets (total = backup)", hist.status === 200 && Number(hist.body?.total) === Number(env("EXPECT_TICKETS")));

const th = await call("GET", `/api/tickets/history/${env("TICKET_ID")}`, tok);
const events = th.body?.history ?? [];
const atts = th.body?.attachments ?? th.body?.ticket?.attachments ?? [];
check("historial del ticket con eventos", th.status === 200 && events.length > 0);
check("el ticket tiene adjuntos", atts.length > 0);
let imgOk = 0;
for (const a of atts) {
  const r = await call("GET", a.imageUrl, tok);
  if (r.status === 200 && Buffer.isBuffer(r.body) && sums.has(createHash("sha256").update(r.body).digest("hex"))) imgOk++;
}
check("imágenes servidas idénticas al origen (SHA-256)", atts.length > 0 && imgOk === atts.length);
const anon = atts[0] ? await call("GET", atts[0].imageUrl, null) : { status: 0 };
check("imagen sin token → 401", anon.status === 401);

console.log(JSON.stringify({ ok, results, totals: { tickets: hist.body?.total ?? null, events: events.length, attachments: atts.length, imagesVerified: imgOk } }));
process.exit(ok ? 0 : 1);
