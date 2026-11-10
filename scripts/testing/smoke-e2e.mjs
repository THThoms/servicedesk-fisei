// =============================================================================
// scripts/testing/smoke-e2e.mjs — prueba E2E funcional de ServiceDesk UTA
//
// Recorre el flujo completo contra un gateway en ejecución, con cuentas de
// LOGIN LOCAL (contraseña) — funciona igual con NODE_ENV=production, porque
// no usa dev-login ni el login simulado.
//
//   E2E_GATEWAY=http://127.0.0.1:28080 E2E_FRONTEND=http://127.0.0.1:23000 \
//   E2E_PASSWORD=<pw> E2E_ADMIN_EMAIL=<admin> E2E_ADMIN_PASSWORD=<pw> \
//   node scripts/testing/smoke-e2e.mjs
//
// Cuentas esperadas (las crea scripts/testing/new-server-simulation.sh con
// manage-user.sh): e2e.user / e2e.user2 (user), e2e.tech1 (technician · TECHNICIANS),
// e2e.tech3 (dtic · DTIC), todas @uta.edu.ec con E2E_PASSWORD.
// Administrador: si E2E_ADMIN_TEMP_PASSWORD está definido (bootstrap), el E2E
// comprueba el cambio obligatorio y fija E2E_ADMIN_PASSWORD como nueva.
//
// Cubre: health, SPA, bypass bloqueados, login, catálogo, ubicaciones, ticket
// con 2 imágenes, enrutamiento por área, aceptar, contribuir, reescalar a otra
// área, aceptar en destino, resolver con KB nuevo, validación del usuario
// (403/400/rechazo/aceptación/409), resolver con KB existente, historial
// completo, autorización de imágenes (401/200/403), knowledge, estadísticas,
// resumen de técnicos, EmailOutbox y registro FCM (DeviceToken).
// No imprime tokens ni contraseñas. Salida 0 = todo verde.
// =============================================================================
const GW = process.env.E2E_GATEWAY ?? "http://127.0.0.1:8080";
const FE = process.env.E2E_FRONTEND ?? GW;
const PW = process.env.E2E_PASSWORD;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD;
const ADMIN_TEMP_PW = process.env.E2E_ADMIN_TEMP_PASSWORD;
if (!PW || !ADMIN_EMAIL || !ADMIN_PW) {
  console.error("Faltan E2E_PASSWORD / E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD");
  process.exit(2);
}

let ok = 0, fail = 0;
const results = [];
function check(name, cond, extra = "") {
  cond ? ok++ : fail++;
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✔" : "✘"} ${name}${extra ? "  — " + extra : ""}`);
  return !!cond;
}
const json = async (r) => { try { return await r.json(); } catch { return null; } };
const arr = (x, ...keys) => Array.isArray(x) ? x : keys.map((k) => x?.[k]).find(Array.isArray) ?? [];
const H = (t, extra = {}) => ({ Authorization: `Bearer ${t}`, ...extra });
const JH = (t) => H(t, { "Content-Type": "application/json" });
async function call(method, path, token, body) {
  const r = await fetch(`${GW}${path}`, {
    method, headers: token ? JH(token) : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await json(r) };
}
async function login(email, password) {
  const r = await call("POST", "/api/auth/login", null, { correo: email, password });
  return r.body?.token ?? null;
}
const png = (seed) => {
  // PNG 1x1 válido; el byte de color varía para que cada archivo sea distinto.
  const b = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  return Buffer.concat([b, Buffer.from([seed])]);
};

// ---------------------------------------------------------------- infraestructura
check("gateway /health", (await fetch(`${GW}/health`)).status === 200);
const spa = await fetch(`${FE}/`); const html = await spa.text();
check("frontend sirve la SPA", spa.status === 200 && html.includes('id="root"'));
const cfg = (await call("GET", "/api/auth/config")).body;
check("config: dev-login deshabilitado", cfg?.devLoginEnabled === false);
check("config: login simulado deshabilitado", cfg?.microsoftSimulateEnabled === false);
check("bypass microsoft-simulate → 404", (await call("POST", "/api/auth/microsoft-simulate", null, { email: ADMIN_EMAIL })).status === 404);
check("bypass dev-login → 404", (await call("POST", "/api/auth/dev-login", null, { email: ADMIN_EMAIL })).status === 404);
check("contraseña incorrecta → 401", (await call("POST", "/api/auth/login", null, { correo: ADMIN_EMAIL, password: "Incorrecta-123!" })).status === 401);

// ---------------------------------------------------------------- admin: contraseña temporal
if (ADMIN_TEMP_PW) {
  const r1 = await call("POST", "/api/auth/login", null, { correo: ADMIN_EMAIL, password: ADMIN_TEMP_PW });
  check("admin con contraseña temporal: login exige cambio", r1.status === 200 && r1.body?.mustChangePassword === true);
  const tmp = r1.body?.token;
  check("token temporal no sirve en ticket-service (403 password_change_required)",
    (await call("GET", "/api/tickets/my", tmp)).body?.error === "password_change_required");
  check("token temporal no sirve en catalog-service (403)", (await call("GET", "/api/knowledge/search?q=", tmp)).status === 403);
  check("cambio con contraseña débil → 400", (await call("POST", "/api/auth/change-password", tmp, { currentPassword: ADMIN_TEMP_PW, newPassword: "corta" })).status === 400);
  const r2 = await call("POST", "/api/auth/change-password", tmp, { currentPassword: ADMIN_TEMP_PW, newPassword: ADMIN_PW });
  check("cambio de contraseña obligatorio → 200", r2.status === 200 && r2.body?.mustChangePassword === false);
  check("la contraseña temporal deja de funcionar", (await call("POST", "/api/auth/login", null, { correo: ADMIN_EMAIL, password: ADMIN_TEMP_PW })).status === 401);
}

// ---------------------------------------------------------------- logins
const T = {
  admin: await login(ADMIN_EMAIL, ADMIN_PW),
  user: await login("e2e.user@uta.edu.ec", PW),
  user2: await login("e2e.user2@uta.edu.ec", PW),
  TECHNICIANS: await login("e2e.tech1@uta.edu.ec", PW),
  DTIC: await login("e2e.tech3@uta.edu.ec", PW),
};
for (const [k, v] of Object.entries(T)) check(`login local ${k}`, !!v);
if (Object.values(T).some((v) => !v)) { console.log(`\nRESULTADO: ${ok} ok / ${fail} fallos`); process.exit(1); }

// ---------------------------------------------------------------- catálogo
const services = arr((await call("GET", "/api/catalog/services", T.user)).body, "services", "data");
check("catálogo de servicios", services.length > 0, `${services.length} servicios`);
const locations = arr((await call("GET", "/api/catalog/locations", T.user)).body, "locations", "data");
check("ubicaciones", locations.length > 0, `${locations.length} ubicaciones`);
const kbList = await call("GET", "/api/knowledge/search?q=", T.DTIC);
check("knowledge: búsqueda (staff)", kbList.status === 200);
check("knowledge: usuario sin rol staff → 403", (await call("GET", "/api/knowledge/search?q=", T.user)).status === 403);

// ---------------------------------------------------------------- crear ticket con 2 imágenes
const service = services[0];
const fd = new FormData();
fd.append("serviceId", service.id);
fd.append("detail", "E2E: el proyector del aula no enciende y muestra error de señal");
fd.append("location", locations[0]?.name ?? "Aula E2E");
fd.append("attachments", new Blob([png(1)], { type: "image/png" }), "e2e-1.png");
fd.append("attachments", new Blob([png(2)], { type: "image/png" }), "e2e-2.png");
let r = await fetch(`${GW}/api/tickets`, { method: "POST", headers: H(T.user), body: fd });
const created = (await json(r))?.ticket;
check("crear ticket con 2 imágenes → 201", r.status === 201 && !!created?.id, `${created?.number} área=${created?.responsibleArea}`);
const tid = created.id;
const areaA = created.responsibleArea;
const areaB = areaA === "DTIC" ? "TECHNICIANS" : "DTIC";
check("área responsable asignada por enrutamiento", ["TECHNICIANS", "DTIC"].includes(areaA), areaA);

const inList = async (token, path) => arr((await call("GET", path, token)).body, "tickets", "data").some((t) => t.id === tid);
check(`Disponibles del área ${areaA} contiene el ticket`, await inList(T[areaA], "/api/tickets/available"));
check(`Disponibles del área ${areaB} NO lo contiene`, !(await inList(T[areaB], "/api/tickets/available")));

// ---------------------------------------------------------------- aceptar / contribuir / reescalar
check("técnico A acepta", (await call("POST", `/api/tickets/${tid}/accept`, T[areaA])).status === 200);
check("ticket en Mis Aceptados de A", await inList(T[areaA], "/api/tickets/accepted"));
check("contribución registrada", (await call("POST", `/api/tickets/${tid}/contributions`, T[areaA], { description: "Se revisó cableado HDMI y fuente." })).status === 201);
r = await call("PUT", `/api/tickets/${tid}/escalate`, T[areaA], { reason: "Requiere revisión especializada", workDone: "Se probó con otro cable y otro equipo", targetArea: areaB });
check(`reescalar a ${areaB}`, r.status === 200, `HTTP ${r.status}`);
check("tras reescalar sale de Mis Aceptados de A", !(await inList(T[areaA], "/api/tickets/accepted")));
check(`aparece en Disponibles de ${areaB}`, await inList(T[areaB], "/api/tickets/available"));
check("técnico B acepta", (await call("POST", `/api/tickets/${tid}/accept`, T[areaB])).status === 200);

// ---------------------------------------------------------------- resolver + validación del usuario
r = await call("POST", `/api/tickets/${tid}/resolve`, T[areaB], {
  mode: "newKnowledge", title: "Proyector sin señal E2E",
  problemDescription: "El proyector no detecta señal del equipo del aula.",
  solution: "Reemplazar el adaptador HDMI y reiniciar la fuente del proyector.",
  keywords: ["proyector", "hdmi", "e2e"], serviceId: service.id,
});
check("resolver con artículo KB nuevo", r.status === 200, `HTTP ${r.status}`);
const hist1 = (await call("GET", `/api/tickets/history/${tid}`, T.user)).body;
check("estado pendiente_validacion", hist1?.ticket?.status === "pendiente_validacion", hist1?.ticket?.status);
// Fase T — aceptación digital: términos versionados + casilla obligatoria.
const termsRes = await call("GET", "/api/tickets/acceptance-terms", T.user);
const TERMS = { termsAccepted: true, termsVersion: termsRes.body?.version };
check("términos de aceptación publicados (versión + texto)", termsRes.status === 200 && termsRes.body?.available === true && /constancia/i.test(termsRes.body?.text ?? ""), `v${termsRes.body?.version}`);
check("otro usuario no puede aceptar → 403", (await call("POST", `/api/tickets/${tid}/user-accept`, T.user2, TERMS)).status === 403);
check("técnico no puede aceptar en nombre del usuario → 403", (await call("POST", `/api/tickets/${tid}/user-accept`, T[areaB], TERMS)).status === 403);
check("admin no puede aceptar en nombre del usuario → 403", (await call("POST", `/api/tickets/${tid}/user-accept`, T.admin, TERMS)).status === 403);
check("aceptar sin marcar la casilla → 400", (await call("POST", `/api/tickets/${tid}/user-accept`, T.user, { termsVersion: TERMS.termsVersion })).status === 400);
check("rechazo sin motivo (aunque marque la casilla) → 400", (await call("POST", `/api/tickets/${tid}/user-reject`, T.user, { ...TERMS })).status === 400);
r = await call("POST", `/api/tickets/${tid}/user-reject`, T.user, { ...TERMS, reason: "Sigue sin mostrar imagen", description: "Probé dos veces" });
check("rechazo con motivo → constancia REJECTED", r.status === 200 && r.body?.acceptance?.decision === "REJECTED" && /^VD-/.test(r.body?.acceptance?.code ?? ""), r.body?.acceptance?.code);
const rejectCode = r.body?.acceptance?.code;
const hist2 = (await call("GET", `/api/tickets/history/${tid}`, T.user)).body;
check("vuelve a en_proceso con el mismo técnico", hist2?.ticket?.status === "en_proceso" && !!hist2?.ticket?.assignedTechnicianName);

const kb = arr((await call("GET", `/api/knowledge/search?q=${encodeURIComponent("Proyector sin señal E2E")}`, T[areaB])).body, "articles", "results", "data");
const kbId = kb.find((a) => (a.title ?? "").includes("Proyector sin señal E2E"))?.id;
check("artículo KB creado al resolver es buscable", !!kbId);
r = await call("POST", `/api/tickets/${tid}/resolve`, T[areaB], { mode: "existingKnowledge", knowledgeArticleId: kbId, finalNote: "Se cambió el adaptador." });
check("re-resolver con artículo KB existente", r.status === 200, `HTTP ${r.status}`);
r = await call("POST", `/api/tickets/${tid}/user-accept`, T.user, TERMS);
check("propietario acepta con la casilla → constancia ACCEPTED", r.status === 200 && r.body?.acceptance?.decision === "ACCEPTED", r.body?.acceptance?.code);
const acceptCode = r.body?.acceptance?.code;
check("doble aceptación → 409", (await call("POST", `/api/tickets/${tid}/user-accept`, T.user, TERMS)).status === 409);
const accs = (await call("GET", `/api/tickets/${tid}/acceptances`, T[areaB])).body?.validation;
check("constancias: el ciclo conserva rechazo y aceptación (sin sobrescribir)",
  accs?.status === "ACEPTADO_DIGITALMENTE" && accs?.record?.code === acceptCode && accs?.history?.length === 2 && accs.history.some((h) => h.code === rejectCode),
  `${accs?.history?.length} decisiones`);
check("constancia con datos reales del usuario y términos", accs?.record?.userEmail === "e2e.user@uta.edu.ec" && accs?.record?.termsVersion === TERMS.termsVersion && !!accs?.record?.decidedAt);
check("usuario ajeno no ve las constancias → 403", (await call("GET", `/api/tickets/${tid}/acceptances`, T.user2)).status === 403);
check("legacy PATCH /status ya no puede reabrir/cerrar (410)", (await call("PATCH", `/api/tickets/${tid}/status`, T.admin, { status: "abierto" })).status === 410);

// ---------------------------------------------------------------- historial
const hist = (await call("GET", `/api/tickets/history/${tid}`, T.user)).body;
check("estado final CERRADO tras aceptar la solución", hist?.ticket?.status === "cerrado", hist?.ticket?.status);
const actions = (hist?.history ?? []).map((e) => e.actionType);
const need = ["CREATED", "ACCEPTED", "CONTRIBUTED", "ESCALATED", "RESOLVED", "USER_REJECTED_RESOLUTION", "USER_ACCEPTED"];
const staffHist = (await call("GET", `/api/tickets/history/${tid}`, T.admin)).body;
const staffActions = (staffHist?.history ?? []).map((e) => e.actionType);
check("historial (staff) contiene el ciclo completo", need.every((a) => staffActions.includes(a)), staffActions.join(" → "));
check("historial conserva 2 eventos RESOLVED", staffActions.filter((a) => a === "RESOLVED").length === 2);
check("historial del propietario accesible", actions.length > 0);

// ---------------------------------------------------------------- imágenes
const atts = hist?.attachments ?? hist?.ticket?.attachments ?? [];
check("2 adjuntos en el historial", atts.length === 2);
check("URLs autenticadas (sin /uploads/, sin Base64)", atts.every((a) => a.imageUrl?.startsWith(`/api/tickets/${tid}/attachments/`) && !a.imageUrl.includes("/uploads/")));
const img = (t) => fetch(`${GW}${atts[0].imageUrl}`, { headers: t ? H(t) : {} });
check("imagen sin JWT → 401", (await img(null)).status === 401);
r = await img(T.user); const bytes = Buffer.from(await r.arrayBuffer());
check("imagen propietario → 200 image/png, bytes íntegros", r.status === 200 && r.headers.get("content-type")?.startsWith("image/png") && (bytes.equals(png(1)) || bytes.equals(png(2))));
check("imagen técnico → 200", (await img(T[areaB])).status === 200);
check("imagen admin → 200", (await img(T.admin)).status === 200);
check("imagen otro usuario → 403", (await img(T.user2)).status === 403);
check("historial de otro usuario → 403", (await call("GET", `/api/tickets/history/${tid}`, T.user2)).status === 403);

// ---------------------------------------------------------------- aislamiento entre áreas (ticket nuevo, sin reasignar)
const fd2 = new FormData();
fd2.append("serviceId", service.id);
fd2.append("detail", "E2E: ticket para comprobar aislamiento entre áreas");
fd2.append("attachments", new Blob([png(9)], { type: "image/png" }), "iso.png");
r = await fetch(`${GW}/api/tickets`, { method: "POST", headers: H(T.user), body: fd2 });
const iso = (await json(r))?.ticket;
const isoArea = iso?.responsibleArea;
const otherArea = isoArea === "DTIC" ? "TECHNICIANS" : "DTIC";
const isoHist = (await call("GET", `/api/tickets/history/${iso.id}`, T[isoArea])).body;
const isoImg = (isoHist?.attachments ?? isoHist?.ticket?.attachments ?? [])[0]?.imageUrl;
check(`técnico del área ${isoArea} ve el ticket de su área`, !!isoImg);
check(`técnico de ${otherArea} → historial de ticket ${isoArea}: 403`, (await call("GET", `/api/tickets/history/${iso.id}`, T[otherArea])).status === 403);
check(`técnico de ${otherArea} → detalle de ticket ${isoArea}: 403`, (await call("GET", `/api/tickets/${iso.id}`, T[otherArea])).status === 403);
check(`técnico de ${otherArea} → imagen de ticket ${isoArea}: 403`, (await fetch(`${GW}${isoImg}`, { headers: H(T[otherArea]) })).status === 403);
check(`técnico de ${otherArea} no puede aceptarlo (403)`, (await call("POST", `/api/tickets/${iso.id}/accept`, T[otherArea])).status === 403);

// ---------------------------------------------------------------- imagen falsa (bytes reales)
const fd3 = new FormData();
fd3.append("serviceId", service.id);
fd3.append("detail", "E2E: archivo que no es imagen");
fd3.append("attachments", new Blob([Buffer.from("no soy una imagen")], { type: "image/png" }), "falsa.png");
check("archivo que no es imagen (aunque diga image/png) → 415", (await fetch(`${GW}/api/tickets`, { method: "POST", headers: H(T.user), body: fd3 })).status === 415);

// ---------------------------------------------------------------- endpoints heredados
for (const [m, u] of [["GET", "/api/tickets/level"], ["PUT", "/api/tickets/escalate"], ["POST", "/api/routing/assign"]]) {
  check(`legacy ${m} ${u} → 410`, (await call(m, u, T.admin, m === "GET" ? undefined : {})).status === 410);
}

// ---------------------------------------------------------------- Fase T: bloques y reporte por bloque
const techs = (await call("GET", "/api/auth/technicians", T.admin)).body?.technicians ?? [];
const tech1 = techs.find((t) => t.email === "e2e.tech1@uta.edu.ec");
const dtic1 = techs.find((t) => t.email === "e2e.tech3@uta.edu.ec");
check("admin asigna Bloque 1 a un técnico", (await call("PATCH", `/api/auth/technicians/${tech1?.id}/block`, T.admin, { block: "BLOQUE_1" })).body?.technician?.block === "BLOQUE_1");
check("admin modifica el bloque (→ Bloque 2 → Bloque 1)",
  (await call("PATCH", `/api/auth/technicians/${tech1?.id}/block`, T.admin, { block: "BLOQUE_2" })).body?.technician?.block === "BLOQUE_2" &&
  (await call("PATCH", `/api/auth/technicians/${tech1?.id}/block`, T.admin, { block: "BLOQUE_1" })).body?.technician?.block === "BLOQUE_1");
check("DTIC no se clasifica por bloque → 409", (await call("PATCH", `/api/auth/technicians/${dtic1?.id}/block`, T.admin, { block: "BLOQUE_1" })).status === 409);
check("técnico no puede asignar bloques → 403", (await call("PATCH", `/api/auth/technicians/${tech1?.id}/block`, T.TECHNICIANS, { block: "BLOQUE_2" })).status === 403);
const b1 = (await call("GET", "/api/auth/technicians?block=BLOQUE_1", T.admin)).body?.technicians ?? [];
check("filtro por bloque: Bloque 1 incluye al técnico y excluye DTIC", b1.some((t) => t.id === tech1?.id) && !b1.some((t) => t.role === "dtic"));
// Ticket del área de Técnicos atendido por el técnico del Bloque 1, con aceptación digital.
const techService = services.find((s) => s.responsibleArea === "TECHNICIANS") ?? service;
const fdB = new FormData();
fdB.append("serviceId", techService.id);
fdB.append("detail", "E2E bloque: la impresora del laboratorio no imprime");
fdB.append("attachments", new Blob([png(7)], { type: "image/png" }), "bloque.png");
r = await fetch(`${GW}/api/tickets`, { method: "POST", headers: H(T.user), body: fdB });
const tB = (await json(r))?.ticket;
let blockFlowOk = r.status === 201 && tB?.responsibleArea === "TECHNICIANS";
if (blockFlowOk) {
  blockFlowOk = (await call("POST", `/api/tickets/${tB.id}/accept`, T.TECHNICIANS)).status === 200 &&
    (await call("POST", `/api/tickets/${tB.id}/resolve`, T.TECHNICIANS, { mode: "existingKnowledge", knowledgeArticleId: kbId, finalNote: "Se reinstaló el controlador." })).status === 200 &&
    (await call("POST", `/api/tickets/${tB.id}/user-accept`, T.user, TERMS)).status === 200;
}
check("ticket del área Técnicos: aceptar → resolver → aceptación digital", blockFlowOk, tB?.number);
r = await call("GET", "/api/admin/reports/block?block=BLOQUE_1", T.admin);
const rowB = r.body?.technicians?.find((t) => t.id === tech1?.id)?.activities?.find((a) => a.ticketId === tB?.id);
check("reporte Bloque 1: incluye la actividad del técnico con su validación digital real",
  r.status === 200 && rowB?.validation?.status === "ACEPTADO_DIGITALMENTE" && /^VD-/.test(rowB?.validation?.record?.code ?? "") && rowB?.validation?.record?.userEmail === "e2e.user@uta.edu.ec",
  rowB?.validation?.record?.code);
check("reporte Bloque 1: totales coherentes", r.body?.totals?.tickets >= 1 && r.body?.totals?.closed >= 1 && r.body?.totals?.technicians >= 1);
check("reporte Bloque 1: DTIC excluido (ningún ticket del área DTIC)", !(r.body?.technicians ?? []).some((t) => t.id === dtic1?.id));
const r2 = await call("GET", "/api/admin/reports/block?block=BLOQUE_2", T.admin);
check("reporte Bloque 2: no contiene al técnico del Bloque 1", r2.status === 200 && !(r2.body?.technicians ?? []).some((t) => t.id === tech1?.id));
check("reporte individual del técnico del bloque", (await call("GET", `/api/admin/reports/block?block=BLOQUE_1&technicianId=${tech1?.id}`, T.admin)).body?.technicians?.length === 1);
check("reporte por bloque: técnico y DTIC → 403", (await call("GET", "/api/admin/reports/block?block=BLOQUE_1", T.TECHNICIANS)).status === 403 && (await call("GET", "/api/admin/reports/block?block=BLOQUE_1", T.DTIC)).status === 403);
const future = (await call("GET", "/api/admin/reports/block?block=BLOQUE_1&from=2099-01-01", T.admin)).body;
check("filtro por fecha (periodo futuro → 0 tickets)", future?.totals?.tickets === 0);
const techRep = (await call("GET", `/api/admin/reports/technicians/${tech1?.id}`, T.admin)).body;
check("reporte individual de técnico incluye la validación digital", (techRep?.tickets ?? []).some((t) => t.id === tB?.id && t.validation?.status === "ACEPTADO_DIGITALMENTE"));
console.log(`E2E_BLOCK_TICKET=${tB?.id ?? ""}`);

// ---------------------------------------------------------------- administración
check("estadísticas admin", (await call("GET", "/api/admin/stats/tickets", T.admin)).status === 200);
check("DTIC no es administrador: estadísticas → 403", (await call("GET", "/api/admin/stats/tickets", T.DTIC)).status === 403);
check("DTIC no es administrador: historial general → 403", (await call("GET", "/api/admin/tickets/history", T.DTIC)).status === 403);
check("Técnicos: estadísticas → 403", (await call("GET", "/api/admin/stats/tickets", T.TECHNICIANS)).status === 403);
check("DTIC no puede asignar tickets (admin) → 403", (await call("GET", "/api/admin/technicians", T.DTIC)).status === 403);
const sum = await call("GET", "/api/admin/technicians/summary", T.admin);
check("resumen de técnicos", sum.status === 200);
check("historial general admin", (await call("GET", "/api/admin/tickets/history", T.admin)).status === 200);
const outbox = await call("GET", "/api/admin/email-outbox", T.admin);
const mails = arr(outbox.body, "outbox", "items", "data");
check("EmailOutbox registra notificaciones", outbox.status === 200 && mails.length > 0, `${mails.length} registros`);

// ---------------------------------------------------------------- FCM DeviceToken
const fakeToken = "e2e-fcm-token-" + "x".repeat(40);
r = await call("POST", "/api/notifications/register", T.DTIC, { token: fakeToken, platform: "android", deviceId: "e2e-device", appVersion: "1.0" });
check("registro de DeviceToken", r.status === 200 || r.status === 201, `HTTP ${r.status}`);
const devs = arr((await call("GET", "/api/notifications/devices", T.DTIC)).body, "devices", "data");
check("DeviceToken listado", devs.length >= 1);
check("baja de DeviceToken", (await call("POST", "/api/notifications/unregister", T.DTIC, { token: fakeToken })).status === 200);

// ---------------------------------------------------------------- SSO: código inválido
check("canje SSO con código inválido → 400", (await call("POST", "/api/auth/sso/exchange", null, { code: "x".repeat(43) })).status === 400);

// ---------------------------------------------------------------- logout revoca en TODOS los servicios
// Sesión nueva de un técnico DTIC: válida en ticket y catalog (endpoint protegido de staff).
const extra = await login("e2e.tech3@uta.edu.ec", PW);
check("sesión nueva válida en ticket-service", (await call("GET", "/api/tickets/my-assigned", extra)).status === 200);
check("sesión nueva válida en catalog-service (KB staff)", (await call("GET", "/api/knowledge/search?q=", extra)).status === 200);
check("logout", (await call("POST", "/api/auth/logout", extra)).status === 200);
// Las cachés de introspección duran 30 s: se espera a que caduquen.
await new Promise((res) => setTimeout(res, Number(process.env.E2E_CACHE_WAIT_MS ?? 31000)));
check("tras logout, ticket-service rechaza el token (401)", (await call("GET", "/api/tickets/my-assigned", extra)).status === 401);
check("tras logout, catalog-service rechaza el token (401)", (await call("GET", "/api/knowledge/search?q=", extra)).status === 401);

// ---------------------------------------------------------------- limitación de intentos (al final: bloquea la cuenta)
const codes = [];
for (let i = 0; i < 6; i++) codes.push((await call("POST", "/api/auth/login", null, { correo: "e2e.user2@uta.edu.ec", password: "Mala-Clave-" + i })).status);
check("5 fallos seguidos → 429 (enfriamiento, no bloqueo permanente)", codes.includes(429), codes.join(","));
check("mensaje de cuenta inexistente = cuenta existente", (await call("POST", "/api/auth/login", null, { correo: "noexiste.e2e@uta.edu.ec", password: "Mala-1!" })).body?.error === "Credenciales inválidas");

console.log(`\nRESULTADO: ${ok} ok / ${fail} fallos · ticket ${created.number}`);
process.exit(fail ? 1 : 0);
