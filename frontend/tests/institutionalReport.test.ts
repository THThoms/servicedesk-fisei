// Fase T — encabezado institucional y bloque de validación digital de los reportes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionLabel,
  blockReportHtml,
  institutionalHeaderHtml,
  periodText,
  printableReason,
  printDocument,
  technicianReportHtml,
  validationBlockHtml,
  type BlockReportData,
  type DigitalValidationView,
  type TechnicianReportData,
} from "../src/lib/institutionalReport.ts";

const rec = (decision: string, o: Record<string, unknown> = {}) => ({
  code: decision === "ACCEPTED" ? "VD-20261105-ABCDEF12" : "VD-20261104-11112222",
  decision, userName: "María Pérez", userEmail: "mperez@uta.edu.ec", userRole: "user",
  decidedAt: "2026-11-05T15:30:00Z", termsVersion: "1.0", technicianName: "Técnico Bloque 1",
  reason: decision === "REJECTED" ? "El proyector sigue sin imagen" : null, ...o,
});

test("texto imprimible: quita el GUID interno y conserva el resto, sin tocar textos normales", () => {
  assert.equal(printableReason("Solución existente aplicada (5a738c66-c41a-48a4-83e7-aca4b2860822)"), "Solución existente aplicada");
  assert.equal(printableReason("La solución no aplicó a mi caso (aula 12)"), "La solución no aplicó a mi caso (aula 12)");
  assert.equal(printableReason(null), "");
});

test("encabezado: FISEI, título a la derecha, logos opcionales sin inventar y texto escapado", () => {
  const h = institutionalHeaderHtml({ title: "Reporte <Bloque 1>", subtitle: "Periodo", origin: "https://sd.uta.edu.ec" });
  assert.match(h, /Facultad de Ingeniería en Sistemas, Electrónica e Industrial/);
  assert.match(h, /class="ih-title"/);
  assert.match(h, /Reporte &lt;Bloque 1&gt;/);
  assert.match(h, /https:\/\/sd\.uta\.edu\.ec\/branding\/uta-logo\.png" [^>]*onerror="this\.remove\(\)"/);
  assert.doesNotMatch(h, /<svg/); // no se redibuja ningún logotipo
});

test("aceptado: muestra todos los datos del registro real", () => {
  const v: DigitalValidationView = { status: "ACEPTADO_DIGITALMENTE", label: "ACEPTADO DIGITALMENTE", record: rec("ACCEPTED"), history: [rec("ACCEPTED")] };
  const html = validationBlockHtml(v);
  for (const s of ["ACEPTADO DIGITALMENTE", "María Pérez", "Usuario solicitante", "mperez@uta.edu.ec", "VD-20261105-ABCDEF12", "Técnico Bloque 1", "1.0"]) {
    assert.ok(html.includes(s), s);
  }
});

test("rechazado: estado, motivo, fecha y usuario", () => {
  const v: DigitalValidationView = { status: "SOLUCION_RECHAZADA", label: "SOLUCIÓN RECHAZADA", record: rec("REJECTED"), history: [rec("REJECTED")] };
  const html = validationBlockHtml(v);
  assert.match(html, /SOLUCIÓN RECHAZADA/);
  assert.match(html, /El proyector sigue sin imagen/);
  assert.match(html, /María Pérez/);
});

test("sin registro: PENDIENTE DE VALIDACIÓN DEL USUARIO y ningún dato inventado", () => {
  const v: DigitalValidationView = { status: "PENDIENTE_VALIDACION", label: "PENDIENTE DE VALIDACIÓN DEL USUARIO", record: null, history: [] };
  const html = validationBlockHtml(v);
  assert.match(html, /PENDIENTE DE VALIDACIÓN DEL USUARIO/);
  assert.doesNotMatch(html, /VD-\d{8}/);
  assert.doesNotMatch(html, /Fecha y hora de aceptación/);
  assert.match(validationBlockHtml(null), /PENDIENTE DE VALIDACIÓN DEL USUARIO/);
});

const acceptedValidation: DigitalValidationView = { status: "ACEPTADO_DIGITALMENTE", label: "ACEPTADO DIGITALMENTE", record: rec("ACCEPTED"), history: [rec("ACCEPTED")] };
const activity = (over: Record<string, unknown> = {}) => ({
  ticketId: "x", number: "TK-1", status: "cerrado", serviceName: "Equipos", createdAt: "2026-02-01T15:00:00Z", attendedAt: "2026-02-01T15:00:00Z", resolvedAt: null,
  requesterName: "María", requesterEmail: "m@uta.edu.ec", description: "Sin imagen", location: "Laboratorio 3", solutionName: "Cambio de cable HDMI", solutionNote: "Se cambió el cable del aula",
  solution: "Cambio de cable HDMI — Se cambió el cable del aula",
  history: [{ createdAt: "2026-02-01T15:00:00Z", action: "RESOLVED", title: null, performedByName: "Carlos", reason: "Solución existente aplicada (5a738c66-c41a-48a4-83e7-aca4b2860822)" }],
  validation: acceptedValidation,
  ...over,
});
const blockReport = (over: Partial<BlockReportData> = {}, act: Record<string, unknown> = {}): BlockReportData => ({
  block: "BLOQUE_1", blockLabel: "Bloque 1", range: { from: "2026-01-01T00:00:00.000Z", to: "2026-07-31T23:59:59.999Z" }, generatedAt: "2026-11-05T15:00:00Z",
  filters: { technicianId: null, status: null, serviceId: null },
  totals: { technicians: 1, tickets: 1, closed: 1, pendingAcceptance: 0, rejectedByUser: 0, inProgress: 0 },
  technicians: [{
    id: "t1", name: "Carlos <Mena>", email: "cmena@uta.edu.ec",
    totals: { tickets: 1, closed: 1, pendingAcceptance: 0, rejected: 0, inProgress: 0 },
    activities: [activity(act) as unknown as BlockReportData["technicians"][number]["activities"][number]],
  }],
  ...over,
});

test("período: el día de calendario no se corre por la zona horaria y sin fechas dice 'Todo el historial'", () => {
  assert.equal(periodText("2026-01-01T00:00:00.000Z", "2026-07-31T23:59:59.999Z"), "01/01/2026 al 31/07/2026");
  assert.equal(periodText("2026-01-01", "2026-07-31"), "01/01/2026 al 31/07/2026");
  assert.equal(periodText(null, null), "Todo el historial");
  assert.equal(periodText("2026-01-01T00:00:00.000Z", null), "Desde el 01/01/2026");
});

test("acción: nunca imprime el código interno", () => {
  assert.equal(actionLabel("USER_REJECTED_RESOLUTION"), "Rechazado por el usuario");
  assert.equal(actionLabel("ALGO_NUEVO"), "Algo nuevo");
});

test("reporte por bloque: secciones obligatorias, datos escapados y sin identificadores internos", () => {
  const html = blockReportHtml(blockReport(), { origin: "https://sd.uta.edu.ec", generatedBy: "Admin" });
  for (const s of ["Reporte general · Bloque 1", "Período consultado", "Fecha de generación", "Resumen general", "Total de técnicos del bloque", "Total de tickets atendidos", "Tickets cerrados",
    "Tickets pendientes de aceptación", "Tickets rechazados por el usuario", "Tickets que continúan en proceso", "Fecha de atención", "Usuario solicitante", "Descripción del trabajo",
    "Historial relevante", "Validación digital del usuario", "ACEPTADO DIGITALMENTE", "VD-20261105-ABCDEF12",
    "no es una firma electrónica certificada", "01/01/2026 al 31/07/2026"]) {
    assert.ok(html.includes(s), s);
  }
  assert.ok(html.includes("Carlos &lt;Mena&gt;"));
  assert.ok(!html.includes("Carlos <Mena>"));
  assert.doesNotMatch(html, /5a738c66/);
  assert.doesNotMatch(html, /RESOLVED/);
});

test("ticket del reporte: nombre de la solución utilizada y laboratorio visibles", () => {
  const html = blockReportHtml(blockReport(), { origin: "" });
  assert.match(html, /<th>Solución utilizada<\/th>/);
  assert.match(html, /<strong>Cambio de cable HDMI<\/strong>/);
  assert.match(html, /Nota del técnico: Se cambió el cable del aula/);
  assert.match(html, /<th>Ubicación \/ laboratorio<\/th>/);
  assert.match(html, /<td>Laboratorio 3<\/td>/);
});

test("ticket del reporte: sin ubicación no inventa una; sin solución lo dice", () => {
  const html = blockReportHtml(blockReport({}, { location: null, solutionName: null, solutionNote: null, solution: null }), { origin: "" });
  assert.doesNotMatch(html, /Laboratorio/);
  assert.match(html, /Sin solución registrada/);
});

test("ticket antiguo sin nombre de solución: muestra el resumen que exista", () => {
  const html = blockReportHtml(blockReport({}, { solutionName: null, solutionNote: null, solution: "Resumen antiguo" }), { origin: "" });
  assert.match(html, /<td>Resumen antiguo<\/td>/);
});

test("reporte por bloque: anchos de columna fijos y técnicos sin actividad en una línea, sin sección propia", () => {
  const idle = { id: "t2", name: "Técnico Sin Tickets", email: "t2@uta.edu.ec", totals: { tickets: 0, closed: 0, pendingAcceptance: 0, rejected: 0, inProgress: 0 }, activities: [] };
  const base = blockReport();
  const html = blockReportHtml({ ...base, technicians: [...base.technicians, idle] }, { origin: "" });
  assert.match(html, /<colgroup>/);
  assert.equal(html.match(/<section class="tech">/g)?.length, 1);
  assert.match(html, /Técnicos del bloque sin actividades en el período:<\/strong> Técnico Sin Tickets\./);
  assert.doesNotMatch(html, /t2@uta\.edu\.ec/);
});

test("reporte por bloque: sin técnicos lo dice claramente; individual cambia el título", () => {
  const empty = blockReportHtml(blockReport({ technicians: [], totals: { technicians: 0, tickets: 0, closed: 0, pendingAcceptance: 0, rejectedByUser: 0, inProgress: 0 } }), { origin: "" });
  assert.match(empty, /no tiene técnicos asignados/);
  const one = blockReportHtml(blockReport({ filters: { technicianId: "t1", status: null, serviceId: null } }), { origin: "" });
  assert.match(one, /Reporte individual · Bloque 1/);
});

test("reporte de técnico: formato original con validación digital, solución y laboratorio", () => {
  const report: TechnicianReportData = {
    technician: { id: "t", name: "Ana", email: "a@uta.edu.ec", role: "technician", areas: ["TECHNICIANS"], isActive: true },
    range: { from: "2026-01-01", to: "2026-07-31" }, generatedAt: "2026-11-05T15:00:00Z",
    summary: { ticketsAssigned: 1, ticketsAccepted: 1, ticketsInProgress: 0, ticketsEscalated: 0, ticketsResolved: 0, ticketsClosed: 0, contributions: 0, reescalations: 0, distinctServices: 1 },
    tickets: [{ id: "x", number: "TK-9", createdAt: "2026-02-01T15:00:00Z", title: "", detail: null, serviceName: "Red", location: "Laboratorio 2", solutionName: "Reinicio del switch", responsibleArea: "TECHNICIANS", priority: "alta", status: "pendiente_validacion",
      requesterName: "Luis", requesterEmail: null, assignedTechnicianName: "Ana", acceptedAt: null, resolvedAt: null, resolvedByName: null, resolutionSummary: null, knowledgeArticleId: null,
      validation: { status: "PENDIENTE_VALIDACION", label: "PENDIENTE DE VALIDACIÓN DEL USUARIO", record: null, history: [] } }],
    activity: [{ id: "e", ticketId: "x", ticketNumber: "TK-9", createdAt: "2026-02-01T15:00:00Z", actionType: "RESOLVED", performedByName: "Ana", description: "Solución existente aplicada (5a738c66-c41a-48a4-83e7-aca4b2860822)", reason: null, workDone: null, previousArea: null, newArea: null, previousStatus: null, newStatus: null, visibility: "" }],
    escalations: [], resolutions: [], contributions: [],
    byService: [{ label: "Red", count: 1 }], byStatus: [{ label: "pendiente_validacion", count: 1 }], byPriority: [{ label: "alta", count: 1 }], byMonth: [],
  };
  const html = technicianReportHtml(report, { origin: "", periodName: "PERÍODO ACADÉMICO", areaLabel: "Técnicos", areaOf: (a) => a });
  assert.equal(html.match(/<header class="ih">/g)?.length, 1);
  for (const s of ["Información del técnico", "Período del reporte", "Información de generación", "Resumen general", "Estadísticas por servicio", "Estadísticas por estado",
    "Estadísticas por prioridad", "Historial completo de tickets", "Validación digital del usuario por ticket", "Actividad del técnico", "Reescalamientos", "Resoluciones", "Aportaciones",
    "Sin aportaciones en el período.", "01/01/2026", "31/07/2026"]) {
    assert.ok(html.includes(s), s);
  }
  assert.match(html, /<td>Laboratorio 2<\/td>/);
  assert.match(html, /<strong>Reinicio del switch<\/strong>/);
  assert.match(html, /Pendiente de aceptación/);
  assert.match(html, /PENDIENTE DE VALIDACIÓN DEL USUARIO/);
  assert.match(html, /Solución registrada/);
  assert.doesNotMatch(html, />pendiente_validacion</);
  assert.doesNotMatch(html, />RESOLVED</);
  assert.doesNotMatch(html, /5a738c66/);
});

test("impresión: en un marco oculto de la misma página, sin abrir ventanas y con un solo diálogo", async () => {
  let prints = 0;
  let removed = 0;
  const win = { focus() {}, print() { prints++; }, onload: null as null | (() => void), onafterprint: null as null | (() => void), document: { open() {}, write() {}, close() {} } };
  const appended: Array<{ id: string; style: { cssText: string } }> = [];
  const frame = { id: "", title: "", tabIndex: 0, style: { cssText: "" }, setAttribute() {}, contentWindow: win as unknown, remove() { removed++; } };
  const doc = { getElementById: () => null, createElement: () => frame, body: { appendChild: (f: typeof frame) => appended.push(f) } } as unknown as Document;
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { open() { throw new Error("no debe abrir ninguna ventana"); } };
  try {
    assert.equal(printDocument("<html></html>", doc, 5), true);
    assert.equal(appended.length, 1);
    assert.match(appended[0].style.cssText, /width:0;height:0/); // invisible en la pantalla
    win.onload?.();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(prints, 1);
    assert.equal(removed, 0);
    win.onafterprint?.(); // al cerrar el diálogo no queda rastro
    assert.equal(removed, 1);
    frame.contentWindow = null;
    assert.equal(printDocument("", doc), false);
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test("ciclo repetido: la aceptación final muestra también el rechazo anterior", () => {
  const acc = rec("ACCEPTED");
  const rej = rec("REJECTED");
  const html = validationBlockHtml({ status: "ACEPTADO_DIGITALMENTE", label: "ACEPTADO DIGITALMENTE", record: acc, history: [acc, rej] });
  assert.match(html, /Decisiones anteriores/);
  assert.match(html, /VD-20261104-11112222/);
});
