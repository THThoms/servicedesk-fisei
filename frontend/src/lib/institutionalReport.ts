// =============================================================================
// Documentos imprimibles de los reportes (técnico individual y bloque).
//
// Conservan el formato original del reporte de técnicos: bloques de información,
// resumen general, estadísticas y tablas. La Fase T añade la validación digital del
// usuario, los bloques, la solución utilizada y la ubicación. Solo presenta lo que
// entrega el backend (SQL Server); no calcula ni inventa datos.
//
// Logotipos: NO se inventan ni se redibujan. Si la institución coloca los oficiales en
//   frontend/public/branding/uta-logo.png  y  frontend/public/branding/fisei-logo.png
// se muestran; si no existen, el <img> se elimina y el encabezado queda solo con texto.
// =============================================================================

export function esc(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Texto de un evento apto para un documento impreso: quita los identificadores
 * internos (GUID) que el historial guarda para trazabilidad. El dato no cambia.
 */
export function printableReason(reason: string | null | undefined): string {
  return (reason ?? "").replace(/\s*\(?\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b\)?/gi, "").trim();
}

export const UTA_BLUE = "#1E3A8A";

// -----------------------------------------------------------------------------
// Fechas y etiquetas
// -----------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha de un instante, en la hora local: DD/MM/AAAA. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Instante en la hora local: DD/MM/AAAA HH:MM (con segundos si se pide). */
export function fmtDateTime(iso: string | null | undefined, seconds = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}${seconds ? `:${pad(d.getSeconds())}` : ""}`;
  return `${fmtDate(iso)} ${time}`;
}

/**
 * Día de calendario de un filtro de período. El backend lo devuelve en UTC a
 * medianoche: convertirlo a hora local mostraría el día anterior en Ecuador.
 */
export function fmtCalendarDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("T")[0].split("-");
  return d ? `${d}/${m}/${y}` : "—";
}

export function periodText(from: string | null | undefined, to: string | null | undefined): string {
  if (!from && !to) return "Todo el historial";
  if (from && to) return `${fmtCalendarDay(from)} al ${fmtCalendarDay(to)}`;
  return from ? `Desde el ${fmtCalendarDay(from)}` : `Hasta el ${fmtCalendarDay(to)}`;
}

export const STATUS_LABELS: Record<string, string> = {
  abierto: "Pendiente",
  en_proceso: "En Proceso",
  escalado: "Escalado",
  pendiente_validacion: "Pendiente de aceptación",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
};
export const PRIORITY_LABELS: Record<string, string> = { baja: "Baja", media: "Media", alta: "Alta", critica: "Crítica" };

export const ACTION_LABELS: Record<string, string> = {
  CREATED: "Ticket creado",
  CATEGORIZED: "Categorizado",
  AVAILABLE: "Disponible para atención",
  ACCEPTED: "Aceptado por el técnico",
  ASSIGNED: "Asignado",
  CONTRIBUTED: "Aportación",
  STATUS_CHANGED: "Cambio de estado",
  ESCALATED: "Reescalado",
  REASSIGNED: "Reasignado",
  COMMENTED: "Comentario",
  RESOLVED: "Solución registrada",
  USER_ACCEPTED: "Aceptado por el usuario",
  USER_REJECTED_RESOLUTION: "Rechazado por el usuario",
  CLOSED: "Cerrado",
};

export const statusLabel = (s: string): string => STATUS_LABELS[s] ?? s;
export const priorityLabel = (p: string): string => PRIORITY_LABELS[p] ?? p;
/** Nunca muestra el código interno: una acción desconocida se presenta legible. */
export const actionLabel = (a: string): string => {
  if (ACTION_LABELS[a]) return ACTION_LABELS[a];
  const text = a.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// -----------------------------------------------------------------------------
// Datos que entrega el backend
// -----------------------------------------------------------------------------
export interface AcceptanceRecord {
  code: string;
  decision: string;
  userName: string;
  userEmail: string;
  userRole: string;
  decidedAt: string;
  termsVersion: string;
  technicianName: string | null;
  reason: string | null;
}
export interface DigitalValidationView {
  status: "ACEPTADO_DIGITALMENTE" | "SOLUCION_RECHAZADA" | "PENDIENTE_VALIDACION" | "SIN_SOLUCION" | "CERRADO_SIN_CONSTANCIA";
  label: string;
  record: AcceptanceRecord | null;
  history: AcceptanceRecord[];
}

// -----------------------------------------------------------------------------
// Estilos del documento (formato original del reporte + validación digital)
// -----------------------------------------------------------------------------
export const INSTITUTIONAL_CSS = `
  * { box-sizing:border-box; }
  body { font-family:Arial, Helvetica, sans-serif; color:#000; background:#fff; margin:24px; font-size:12px; }
  h2 { font-size:14px; margin:18px 0 8px; border-bottom:1px solid #ccc; padding-bottom:4px; break-after:avoid; }
  h2 small { font-size:11px; font-weight:400; color:#555; margin-left:6px; }
  h3 { font-size:12px; margin:12px 0 6px; color:#1e3a8a; break-after:avoid; }

  .ih { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:0 0 10px; }
  .ih-brand { display:flex; align-items:center; gap:12px; }
  .ih-logo { height:58px; width:auto; object-fit:contain; }
  .ih-uni { font-size:12px; font-weight:700; letter-spacing:1.5px; color:${UTA_BLUE}; text-transform:uppercase; }
  .ih-fac { font-size:13px; font-weight:700; color:#0f172a; margin-top:2px; }
  .ih-dep { font-size:10.5px; color:#475569; margin-top:2px; }
  .ih-title { flex:none; max-width:42%; text-align:right; color:${UTA_BLUE}; }
  .ih-title .t { font-size:16px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; line-height:1.15; }
  .ih-title .s { font-size:10.5px; color:#475569; margin-top:4px; }
  .ih-band { height:5px; background:${UTA_BLUE}; margin-bottom:14px; }

  header.doc { border:1px solid #1e3a8a; border-radius:4px; overflow:hidden; margin-bottom:18px; break-inside:avoid; }
  header.doc .section { padding:10px 16px; border-bottom:1px solid #e5e7eb; }
  header.doc .section:last-child { border-bottom:none; }
  header.doc .sec-title { font-size:10px; font-weight:bold; letter-spacing:2px; color:#666; text-transform:uppercase; margin:0 0 6px; }
  header.doc .row { display:flex; flex-wrap:wrap; gap:20px; }
  header.doc .field { flex:1 1 140px; }
  header.doc .label { font-size:10px; color:#666; margin:0; }
  header.doc .value { font-size:12px; color:#111; font-weight:600; margin:1px 0 0; }
  header.doc .value.big { font-size:16px; font-weight:bold; color:#1e3a8a; }

  table.meta { width:100%; border-collapse:collapse; margin:12px 0 16px; }
  table.meta th, table.meta td { text-align:left; padding:4px 8px; border:1px solid #ddd; vertical-align:top; }
  table.meta th { width:280px; background:#f5f5f5; font-weight:600; }
  table.tbl { width:100%; border-collapse:collapse; font-size:11px; table-layout:fixed; break-inside:avoid; }
  table.tbl.dense { font-size:10px; }
  table.tbl.dense th, table.tbl.dense td { padding:4px; }
  table.tbl th, table.tbl td { border:1px solid #ddd; padding:4px 6px; text-align:left; vertical-align:top; overflow-wrap:break-word; }
  table.tbl thead { background:#f5f5f5; display:table-header-group; }
  table.tbl tr { break-inside:avoid; }
  table.tbl .note { display:block; margin-top:2px; color:#555; font-size:10px; }
  .tt { color:#333; margin:0 0 8px; }
  .keep { break-inside:avoid; }
  .idle { margin:14px 0 0; }
  .empty { padding:8px; text-align:center; color:#555; font-style:italic; }
  footer.doc { margin-top:24px; border-top:1px solid #ccc; padding-top:8px; font-size:10px; color:#666; text-align:center; }

  .vd-item { margin-top:8px; break-inside:avoid; }
  .vd { border:1px solid #1e3a8a; border-radius:4px; margin:4px 0 10px; break-inside:avoid; font-size:11px; overflow:hidden; }
  .vd-h { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:4px 8px; background:#eff6ff; border-bottom:1px solid #dbeafe; }
  .vd-t { font-size:10px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:#1e3a8a; }
  .vd-state { font-weight:bold; text-align:right; color:#475569; }
  .vd-b { padding:6px 8px; display:grid; grid-template-columns:1fr 1fr; gap:3px 16px; }
  .vd-b .k { color:#555; } .vd-b .v { font-weight:600; }
  .vd-wide { grid-column:1 / -1; }
  .vd-ok .vd-state { color:#15803d; } .vd-rej .vd-state { color:#b91c1c; } .vd-pend .vd-state { color:#a16207; }

  @media print { body { margin:0; padding:0 1px; } @page { margin:16mm; size:A4; } }
`;

// -----------------------------------------------------------------------------
// Piezas del documento
// -----------------------------------------------------------------------------
export interface HeaderOptions {
  title: string;
  subtitle?: string;
  /** Origen absoluto del sitio (necesario para cargar los logotipos oficiales). */
  origin: string;
}

export function institutionalHeaderHtml({ title, subtitle, origin }: HeaderOptions): string {
  const logo = (file: string, alt: string) =>
    `<img class="ih-logo" src="${esc(origin)}/branding/${file}" alt="${esc(alt)}" onerror="this.remove()" />`;
  return `
  <header class="ih">
    <div class="ih-brand">
      ${logo("uta-logo.png", "Universidad Técnica de Ambato")}
      <div>
        <div class="ih-uni">Universidad Técnica de Ambato</div>
        <div class="ih-fac">Facultad de Ingeniería en Sistemas, Electrónica e Industrial</div>
        <div class="ih-dep">Sistema ServiceDesk UTA</div>
      </div>
      ${logo("fisei-logo.png", "FISEI")}
    </div>
    <div class="ih-title"><div class="t">${esc(title)}</div>${subtitle ? `<div class="s">${esc(subtitle)}</div>` : ""}</div>
  </header>
  <div class="ih-band"></div>`;
}

const ROLE_LABEL: Record<string, string> = { user: "Usuario solicitante", technician: "Técnico", dtic: "DTIC", admin: "Administrador" };

/**
 * Bloque "VALIDACIÓN DIGITAL DEL USUARIO". Solo muestra datos de un registro
 * real; sin registro muestra el estado (p. ej. PENDIENTE DE VALIDACIÓN DEL
 * USUARIO) sin inventar nombre, código ni fecha.
 */
export function validationBlockHtml(v: DigitalValidationView | null | undefined, technicianFallback?: string | null): string {
  const head = (state: string) => `<div class="vd-h"><span class="vd-t">Validación digital del usuario</span><span class="vd-state">${esc(state)}</span></div>`;
  if (!v) return `<div class="vd vd-pend">${head("PENDIENTE DE VALIDACIÓN DEL USUARIO")}</div>`;
  const r = v.record;
  const cls = v.status === "ACEPTADO_DIGITALMENTE" ? "vd-ok" : v.status === "SOLUCION_RECHAZADA" ? "vd-rej" : v.status === "PENDIENTE_VALIDACION" ? "vd-pend" : "vd-na";
  const row = (k: string, val: string | null | undefined) => `<div><span class="k">${esc(k)}:</span> <span class="v">${esc(val || "—")}</span></div>`;
  let body = "";
  if (r && v.status === "ACEPTADO_DIGITALMENTE") {
    body +=
      row("Nombre del usuario", r.userName) +
      row("Rol del usuario", ROLE_LABEL[r.userRole] ?? r.userRole) +
      row("Correo institucional", r.userEmail) +
      row("Código único de aceptación", r.code) +
      row("Fecha y hora de aceptación", fmtDateTime(r.decidedAt, true)) +
      row("Técnico responsable", r.technicianName ?? technicianFallback) +
      row("Versión de los términos aceptados", r.termsVersion);
  } else if (r && v.status === "SOLUCION_RECHAZADA") {
    body +=
      row("Nombre del usuario", r.userName) +
      row("Fecha y hora", fmtDateTime(r.decidedAt, true)) +
      row("Código de la constancia", r.code) +
      row("Técnico responsable", r.technicianName ?? technicianFallback) +
      `<div class="vd-wide"><span class="k">Motivo del rechazo:</span> <span class="v">${esc(r.reason)}</span></div>`;
  }
  const prev = v.history.filter((h) => !r || h.code !== r.code);
  if (prev.length) {
    body += `<div class="vd-wide"><span class="k">Decisiones anteriores:</span> ${prev
      .map((h) => `${esc(h.decision === "ACCEPTED" ? "Aceptada" : "Rechazada")} ${esc(fmtDateTime(h.decidedAt, true))} (${esc(h.code)})${h.reason ? ` — ${esc(h.reason)}` : ""}`)
      .join(" · ")}</div>`;
  }
  return `<div class="vd ${cls}">${head(v.label)}${body ? `<div class="vd-b">${body}</div>` : ""}</div>`;
}

const DISCLAIMER =
  "La validación digital es una constancia de aceptación registrada en el sistema; no es una firma electrónica certificada.";

function field(label: string, value: string, big = false): string {
  return `<div class="field"><p class="label">${esc(label)}:</p><p class="value${big ? " big" : ""}">${esc(value)}</p></div>`;
}
function headerSection(title: string, fields: string[]): string {
  return `<div class="section"><p class="sec-title">${esc(title)}</p><div class="row">${fields.join("")}</div></div>`;
}
function metaTable(rows: Array<[string, string | number]>): string {
  return `<table class="meta">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
}
/** `widths`: porcentaje de cada columna; con ellos ninguna palabra normal se parte. */
function tableHtml(heads: string[], rows: string[], emptyMessage: string, widths: number[], dense = false): string {
  if (!rows.length) return `<p class="empty">${esc(emptyMessage)}</p>`;
  const cols = `<colgroup>${widths.map((w) => `<col style="width:${w}%">`).join("")}</colgroup>`;
  return `<table class="tbl${dense ? " dense" : ""}">${cols}<thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}
function documentHtml(o: { title: string; subtitle?: string; origin: string; body: string; footer: string }): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(o.title)}</title><style>${INSTITUTIONAL_CSS}</style></head><body>
${institutionalHeaderHtml({ title: o.title, subtitle: o.subtitle, origin: o.origin })}
${o.body}
<footer class="doc">${esc(o.footer)}</footer>
</body></html>`;
}
/** Nombre de la solución en negrita y, debajo, la nota del técnico. */
function solutionCell(name: string | null | undefined, note: string | null | undefined, noteLabel = "Nota del técnico"): string {
  if (!name) return note ? esc(note) : "—";
  return `<strong>${esc(name)}</strong>${note ? `<span class="note">${esc(noteLabel)}: ${esc(note)}</span>` : ""}`;
}

// -----------------------------------------------------------------------------
// Reporte por bloque
// -----------------------------------------------------------------------------
export interface BlockHistoryItem { createdAt: string; action: string; title: string | null; performedByName: string; reason: string | null }
export interface BlockActivity {
  ticketId: string; number: string; status: string; serviceName: string | null; createdAt: string;
  attendedAt: string | null; resolvedAt: string | null; requesterName: string | null; requesterEmail: string | null;
  description: string; location: string | null; solutionName: string | null; solutionNote: string | null;
  solution: string | null; history: BlockHistoryItem[]; validation: DigitalValidationView;
}
export interface BlockTechnicianSection {
  id: string; name: string; email: string;
  totals: { tickets: number; closed: number; pendingAcceptance: number; rejected: number; inProgress: number };
  activities: BlockActivity[];
}
export interface BlockReportData {
  block: string; blockLabel: string; range: { from: string | null; to: string | null }; generatedAt: string;
  filters: { technicianId: string | null; status: string | null; serviceId: string | null };
  totals: { technicians: number; tickets: number; closed: number; pendingAcceptance: number; rejectedByUser: number; inProgress: number };
  technicians: BlockTechnicianSection[];
}

function blockTechnicianHtml(t: BlockTechnicianSection): string {
  const c = t.totals;
  const tickets = t.activities.map(
    (a) => `<tr>
      <td>${esc(a.number)}</td>
      <td>${esc(fmtDateTime(a.attendedAt))}</td>
      <td>${esc(a.serviceName ?? "—")}</td>
      <td>${esc(a.location ?? "—")}</td>
      <td>${esc(a.requesterName ?? "—")}</td>
      <td>${esc(a.description)}</td>
      <td>${a.solutionName ? solutionCell(a.solutionName, a.solutionNote) : esc(a.solution ?? "Sin solución registrada")}</td>
      <td>${esc(statusLabel(a.status))}</td>
    </tr>`
  );
  const validations = t.activities
    .map((a) => `<div class="vd-item"><strong>${esc(a.number)}</strong> · ${esc(a.serviceName ?? "—")} · solicitante ${esc(a.requesterName ?? "—")}
      ${validationBlockHtml(a.validation, t.name)}</div>`)
    .join("");
  const history = t.activities.flatMap((a) =>
    a.history.map(
      (h) => `<tr>
        <td>${esc(fmtDateTime(h.createdAt))}</td>
        <td>${esc(a.number)}</td>
        <td>${esc(actionLabel(h.action))}</td>
        <td>${esc(printableReason(h.reason) || "—")}</td>
        <td>${esc(h.performedByName)}</td>
      </tr>`
    )
  );
  return `<section class="tech">
    <div class="keep">
    <h2>${esc(t.name)}<small>${esc(t.email)}</small></h2>
    <p class="tt">Tickets: ${c.tickets} · Cerrados: ${c.closed} · Pendientes de aceptación: ${c.pendingAcceptance} · Con rechazo del usuario: ${c.rejected} · En proceso: ${c.inProgress}</p>
    ${tableHtml(["Número", "Fecha de atención", "Servicio", "Ubicación / laboratorio", "Usuario solicitante", "Descripción del trabajo / problema", "Solución utilizada", "Estado"], tickets, "Sin actividades en el período.", [16, 10.5, 11.5, 12, 10.5, 13.5, 16, 10])}
    </div>
    ${validations ? `<h3>Validación digital del usuario</h3>${validations}` : ""}
    ${history.length ? `<div class="keep"><h3>Historial relevante</h3>${tableHtml(["Fecha", "Ticket", "Acción", "Detalle", "Realizado por"], history, "", [15, 16, 21, 29, 19])}</div>` : ""}
  </section>`;
}

export function blockReportHtml(r: BlockReportData, ctx: { origin: string; generatedBy?: string | null; filterNote?: string | null }): string {
  const individual = r.filters.technicianId ? (r.technicians[0] ?? null) : null;
  // Los técnicos sin actividad no gastan una sección: se resumen en una línea.
  const active = r.technicians.filter((t) => t.activities.length > 0);
  const idle = r.technicians.filter((t) => t.activities.length === 0);
  const body = `<header class="doc">
    ${headerSection("Información del bloque", [
      field("Bloque", r.blockLabel, true),
      ...(individual ? [field("Técnico", individual.name)] : []),
      ...(ctx.filterNote ? [field("Filtros aplicados", ctx.filterNote)] : []),
    ])}
    ${headerSection("Período del reporte", [field("Período consultado", periodText(r.range.from, r.range.to))])}
    ${headerSection("Información de generación", [field("Generado por", ctx.generatedBy || "Administración"), field("Fecha de generación", fmtDateTime(r.generatedAt))])}
  </header>
  <h2>Resumen general</h2>
  ${metaTable([
    ["Total de técnicos del bloque", r.totals.technicians],
    ["Total de tickets atendidos", r.totals.tickets],
    ["Tickets cerrados", r.totals.closed],
    ["Tickets pendientes de aceptación", r.totals.pendingAcceptance],
    ["Tickets rechazados por el usuario (al menos una vez)", r.totals.rejectedByUser],
    ["Tickets que continúan en proceso", r.totals.inProgress],
  ])}
  ${active.map(blockTechnicianHtml).join("")}
  ${idle.length ? `<p class="tt idle"><strong>${individual ? "Sin actividades en el período" : "Técnicos del bloque sin actividades en el período"}:</strong> ${esc(idle.map((t) => t.name).join(", "))}.</p>` : ""}
  ${r.technicians.length ? "" : `<p class="empty">Este bloque no tiene técnicos asignados.</p>`}`;
  return documentHtml({
    title: individual ? `Reporte individual · ${r.blockLabel}` : `Reporte general · ${r.blockLabel}`,
    subtitle: `Generado el ${fmtDateTime(r.generatedAt)}`,
    origin: ctx.origin,
    body,
    footer: `Documento generado desde ServiceDesk UTA. Los reportes por bloque no incluyen a DTIC. ${DISCLAIMER}`,
  });
}

// -----------------------------------------------------------------------------
// Reporte individual del técnico
// -----------------------------------------------------------------------------
export interface ReportTechnician { id: string; name: string; email: string; role: string; areas: ("TECHNICIANS" | "DTIC")[]; isActive: boolean; block?: string | null }
export interface ReportTicket {
  id: string; number: string; createdAt: string; title: string; detail: string | null; serviceName: string | null;
  location: string | null; solutionName: string | null;
  responsibleArea: "TECHNICIANS" | "DTIC"; priority: string; status: string;
  requesterName: string | null; requesterEmail: string | null; assignedTechnicianName: string | null;
  acceptedAt: string | null; resolvedAt: string | null; resolvedByName: string | null;
  resolutionSummary: string | null; knowledgeArticleId: string | null;
  /** Validación digital del usuario (registros reales del backend). */
  validation?: DigitalValidationView;
}
export interface ReportActivity {
  id: string; ticketId: string; ticketNumber: string | null; createdAt: string; actionType: string; performedByName: string;
  description: string | null; reason: string | null; workDone: string | null; previousArea: string | null; newArea: string | null;
  previousStatus: string | null; newStatus: string | null; visibility: string;
}
export interface ReportEscalation { ticketNumber: string | null; createdAt: string; previousArea: string | null; newArea: string | null; reason: string | null; workDone: string | null; performedByName: string }
export interface ReportResolution { ticketNumber: string; serviceName: string | null; location: string | null; solutionName: string | null; problemDescription: string | null; resolvedAt: string | null; resolutionSummary: string | null; knowledgeArticleId: string | null; resolvedByName: string | null }
export interface ReportContribution { ticketNumber: string | null; createdAt: string; performedByName: string; description: string | null }
export interface CountByLabel { label: string; count: number }
export interface TechnicianReportData {
  technician: ReportTechnician;
  range: { from: string | null; to: string | null };
  generatedAt: string;
  summary: {
    ticketsAssigned: number; ticketsAccepted: number; ticketsInProgress: number; ticketsEscalated: number;
    ticketsResolved: number; ticketsClosed: number; contributions: number; reescalations: number; distinctServices: number;
  };
  tickets: ReportTicket[];
  activity: ReportActivity[];
  escalations: ReportEscalation[];
  resolutions: ReportResolution[];
  contributions: ReportContribution[];
  byService: CountByLabel[];
  byStatus: CountByLabel[];
  byPriority: CountByLabel[];
  byMonth: Array<{ month: string; count: number }>;
}

function statsTable(firstHead: string, rows: CountByLabel[], label: (s: string) => string): string {
  return tableHtml(
    [firstHead, "Tickets"],
    rows.map((b) => `<tr><td>${esc(label(b.label))}</td><td>${esc(b.count)}</td></tr>`),
    "Sin datos.",
    [75, 25]
  );
}

export function technicianReportHtml(
  r: TechnicianReportData,
  ctx: { origin: string; generatedBy?: string | null; periodName: string; areaLabel: string; areaOf: (area: string) => string }
): string {
  const s = r.summary;
  const tickets = r.tickets.map(
    (t) => `<tr>
      <td>${esc(t.number)}</td>
      <td>${esc(fmtDate(t.createdAt))}</td>
      <td>${esc(t.serviceName ?? "—")}</td>
      <td>${esc(t.location ?? "—")}</td>
      <td>${esc(ctx.areaOf(t.responsibleArea))}</td>
      <td>${esc(priorityLabel(t.priority))}</td>
      <td>${esc(statusLabel(t.status))}</td>
      <td>${esc(t.requesterName ?? "—")}</td>
      <td>${solutionCell(t.solutionName, null)}</td>
      <td>${esc(t.resolvedAt ? fmtDate(t.resolvedAt) : "—")}</td>
    </tr>`
  );
  const validations = r.tickets
    .map((t) => `<div class="vd-item"><strong>${esc(t.number)}</strong> · ${esc(t.serviceName ?? "—")} · solicitante ${esc(t.requesterName ?? "—")}
      ${validationBlockHtml(t.validation, t.resolvedByName ?? t.assignedTechnicianName)}</div>`)
    .join("");
  const activity = r.activity.map(
    (a) => `<tr>
      <td>${esc(fmtDate(a.createdAt))}</td>
      <td>${esc(a.ticketNumber ?? "—")}</td>
      <td>${esc(actionLabel(a.actionType))}</td>
      <td>${esc(printableReason(a.description ?? a.reason ?? a.workDone) || "—")}</td>
    </tr>`
  );
  const escalations = r.escalations.map(
    (e) => `<tr>
      <td>${esc(e.ticketNumber ?? "—")}</td>
      <td>${esc(fmtDate(e.createdAt))}</td>
      <td>${esc(e.previousArea ? ctx.areaOf(e.previousArea) : "—")}</td>
      <td>${esc(e.newArea ? ctx.areaOf(e.newArea) : "—")}</td>
      <td>${esc(printableReason(e.reason) || "—")}</td>
      <td>${esc(e.workDone ?? "—")}</td>
    </tr>`
  );
  const resolutions = r.resolutions.map(
    (x) => `<tr>
      <td>${esc(x.ticketNumber)}</td>
      <td>${esc(x.serviceName ?? "—")}</td>
      <td>${esc(x.location ?? "—")}</td>
      <td>${esc(x.problemDescription ?? "—")}</td>
      <td>${esc(x.resolvedAt ? fmtDate(x.resolvedAt) : "—")}</td>
      <td>${solutionCell(x.solutionName, x.resolutionSummary, "Resumen")}</td>
    </tr>`
  );
  const contributions = r.contributions.map(
    (c) => `<tr>
      <td>${esc(c.ticketNumber ?? "—")}</td>
      <td>${esc(fmtDate(c.createdAt))}</td>
      <td>${esc(c.description ?? "—")}</td>
    </tr>`
  );

  const body = `<header class="doc">
    ${headerSection("Información del técnico", [field("Técnico", r.technician.name, true), field("Área", ctx.areaLabel)])}
    ${headerSection("Período del reporte", [
      field("Período", ctx.periodName),
      field("Desde", r.range.from ? fmtCalendarDay(r.range.from) : "—"),
      field("Hasta", r.range.to ? fmtCalendarDay(r.range.to) : "—"),
    ])}
    ${headerSection("Información de generación", [field("Generado por", ctx.generatedBy || "Admin"), field("Fecha de generación", fmtDateTime(r.generatedAt))])}
  </header>

  <h2>Resumen general</h2>
  ${metaTable([
    ["Tickets asignados", s.ticketsAssigned],
    ["Aceptaciones (incluye tickets luego reescalados)", s.ticketsAccepted],
    ["Tickets en proceso", s.ticketsInProgress],
    ["Tickets resueltos", s.ticketsResolved],
    ["Tickets cerrados", s.ticketsClosed],
    ["Reescalamientos", s.reescalations],
    ["Aportaciones", s.contributions],
    ["Servicios distintos atendidos", s.distinctServices],
  ])}

  <h2>Estadísticas por servicio</h2>
  ${statsTable("Servicio", r.byService, (x) => x)}
  <h2>Estadísticas por estado</h2>
  ${statsTable("Estado", r.byStatus, statusLabel)}
  <h2>Estadísticas por prioridad</h2>
  ${statsTable("Prioridad", r.byPriority, priorityLabel)}

  <h2>Historial completo de tickets</h2>
  ${tableHtml(["Número", "Fecha", "Servicio", "Ubicación", "Área", "Prioridad", "Estado", "Solicitante", "Solución utilizada", "Resuelto"], tickets, "Sin tickets en el período.", [15, 9.5, 10, 10, 7.5, 8, 9, 9.5, 12, 9.5], true)}

  <h2>Validación digital del usuario por ticket</h2>
  ${validations || `<p class="empty">Sin tickets en el período.</p>`}

  <h2>Actividad del técnico</h2>
  ${tableHtml(["Fecha", "Ticket", "Acción", "Descripción"], activity, "Sin actividad en el período.", [12, 17, 24, 47])}

  <h2>Reescalamientos</h2>
  ${tableHtml(["Ticket", "Fecha", "Área anterior", "Área nueva", "Motivo", "Trabajo previo"], escalations, "Sin reescalamientos en el período.", [16, 11, 10, 10, 28, 25])}

  <h2>Resoluciones</h2>
  ${tableHtml(["Ticket", "Servicio", "Ubicación", "Problema", "Resuelto el", "Solución utilizada"], resolutions, "Sin resoluciones en el período.", [16, 11, 11, 25, 11, 26])}

  <h2>Aportaciones</h2>
  ${tableHtml(["Ticket", "Fecha", "Descripción"], contributions, "Sin aportaciones en el período.", [17, 12, 71])}`;

  return documentHtml({
    title: "Reporte individual del técnico",
    subtitle: `Generado el ${fmtDateTime(r.generatedAt)}`,
    origin: ctx.origin,
    body,
    footer: `Documento generado desde ServiceDesk UTA. ${DISCLAIMER}`,
  });
}

// -----------------------------------------------------------------------------
// Impresión
// -----------------------------------------------------------------------------
const PRINT_FRAME_ID = "sd-print-frame";

/**
 * Imprime el documento desde un marco oculto de la propia página: no se abre
 * ninguna ventana, solo el cuadro de impresión del navegador sobre la pantalla
 * actual (y no depende del bloqueador de ventanas emergentes). El diálogo se lanza
 * UNA sola vez: al terminar de cargar o, si `load` ya ocurrió, por el temporizador.
 * Devuelve false si no se pudo preparar el marco.
 */
export function printDocument(html: string, doc: Document = document, delayMs = 600): boolean {
  doc.getElementById(PRINT_FRAME_ID)?.remove();
  const frame = doc.createElement("iframe");
  frame.id = PRINT_FRAME_ID;
  frame.title = "Documento para imprimir";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  doc.body.appendChild(frame);
  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    return false;
  }
  let printed = false;
  const printOnce = () => {
    if (printed) return;
    printed = true;
    win.focus();
    win.print();
  };
  win.onafterprint = () => frame.remove();
  win.onload = printOnce;
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(printOnce, delayMs);
  return true;
}
