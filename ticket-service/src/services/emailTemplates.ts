// HU-15 - Plantillas de correo para notificaciones de tickets.
// Cada template genera { subject, textBody, htmlBody } para el solicitante.
// Reglas:
//   - HTML simple, sin CSS externo (compatibilidad con clientes de correo).
//   - Nunca incluye roles internos (tech_n*), niveles N1-N4 ni IDs sensibles.
//   - Nombres de área se imprimen en formato público ("Técnicos", "DTIC").
//   - Si el técnico tiene nombre con "Nivel", se reduce a "Técnico" para mantener
//     la línea editorial del Sprint 2 (rev).
//   - No incluye tokens, contraseñas ni el `userEmail` del solicitante.

import { env } from "../config/env";

export type EmailEventType =
  | "TICKET_ACCEPTED"
  | "TICKET_ASSIGNED"
  | "TICKET_ESCALATED"
  | "TICKET_RESOLVED"
  | "TICKET_CONTRIBUTION";

export interface EmailTemplate {
  subject: string;
  textBody: string;
  htmlBody: string;
}

export interface TicketEmailContext {
  number: string;
  userName?: string | null;
  serviceName?: string | null;
  responsibleArea?: string | null;
  status?: string | null;
  technicianName?: string | null;
  /** Fecha relevante al evento (aceptación, derivación, resolución) */
  eventDate?: Date | string | null;
  /** Notas/motivo/resumen seguros (ya filtrados de contenido interno). */
  note?: string | null;
  /** Para resolved: título del artículo de KB usado (si la solución es pública). */
  knowledgeTitle?: string | null;
  /** Para escalated: área nueva (legible). */
  newArea?: string | null;
  /** Para contribution: descripción pública. */
  contributionDescription?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  abierto: "Pendiente",
  en_proceso: "En Proceso",
  escalado: "Escalado",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
};
const AREA_LABEL: Record<string, string> = {
  TECHNICIANS: "Técnicos",
  DTIC: "DTIC",
};

function publicStatus(s?: string | null): string {
  if (!s) return "—";
  return STATUS_LABEL[s] ?? s;
}
function publicArea(a?: string | null): string {
  if (!a) return "—";
  return AREA_LABEL[a] ?? a;
}
function publicTechnicianName(n?: string | null): string {
  if (!n) return "Técnico";
  return /^T[eé]cnico\b/i.test(n) ? "Técnico" : n;
}
function fmtDate(d?: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-EC", {
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function esc(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// -----------------------------------------------------------------------------
// Layout común: encabezado, fila de datos, pie.
// -----------------------------------------------------------------------------
function wrapHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, Helvetica, sans-serif; background:#f6f7f9; color:#222; margin:0; padding:24px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"
         style="background:#ffffff; border-collapse:collapse; max-width:560px; width:100%; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">
    <tr>
      <td style="background:#1e3a8a; color:#fff; padding:14px 20px; font-weight:bold; font-size:16px;">
        Universidad Técnica de Ambato — ServiceDesk
      </td>
    </tr>
    <tr>
      <td style="padding:20px;">
        <h2 style="margin:0 0 12px; font-size:18px; color:#111;">${esc(title)}</h2>
        ${bodyHtml}
        <p style="margin:18px 0 0; font-size:12px; color:#666;">
          Puedes revisar el seguimiento ingresando a ServiceDesk:
          <a href="${esc(env.frontendUrl)}" style="color:#1e3a8a;">${esc(env.frontendUrl)}</a>
        </p>
      </td>
    </tr>
    <tr>
      <td style="background:#f0f0f0; color:#777; font-size:11px; padding:10px 20px; text-align:center;">
        Este correo es informativo. No respondas a este mensaje.
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function rowsHtml(rows: Array<[string, string]>): string {
  return (
    `<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; font-size:13px;">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="border:1px solid #e5e7eb; background:#f9fafb; width:160px; vertical-align:top;"><strong>${esc(k)}</strong></td><td style="border:1px solid #e5e7eb;">${esc(v)}</td></tr>`
      )
      .join("") +
    `</table>`
  );
}

function rowsText(rows: Array<[string, string]>): string {
  return rows.map(([k, v]) => `- ${k}: ${v}`).join("\n");
}

function greet(name?: string | null): string {
  const display = name && name.trim() !== "" ? name.split(" ")[0] : "Usuario";
  return `Hola ${display},`;
}

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------
function ticketAccepted(ctx: TicketEmailContext): EmailTemplate {
  const subject = `Tu ticket ${ctx.number} fue aceptado`;
  const rows: Array<[string, string]> = [
    ["Número de ticket", ctx.number],
    ["Servicio", ctx.serviceName ?? "—"],
    ["Estado actual", publicStatus(ctx.status)],
    ["Técnico asignado", publicTechnicianName(ctx.technicianName)],
    ["Fecha de aceptación", fmtDate(ctx.eventDate)],
  ];
  const text = `${greet(ctx.userName)}

Tu ticket ${ctx.number} fue aceptado por un técnico y comenzará su atención.

${rowsText(rows)}

Puedes revisar el seguimiento en ServiceDesk: ${env.frontendUrl}
`;
  const html = wrapHtml(
    subject,
    `<p>${esc(greet(ctx.userName))}</p>
     <p>Tu ticket <strong>${esc(ctx.number)}</strong> fue aceptado por un técnico y comenzará su atención.</p>
     ${rowsHtml(rows)}`
  );
  return { subject, textBody: text, htmlBody: html };
}

function ticketAssigned(ctx: TicketEmailContext): EmailTemplate {
  const subject = `Tu ticket ${ctx.number} fue asignado`;
  const rows: Array<[string, string]> = [
    ["Número de ticket", ctx.number],
    ["Servicio", ctx.serviceName ?? "—"],
    ["Estado actual", publicStatus(ctx.status)],
    ["Técnico asignado", publicTechnicianName(ctx.technicianName)],
    ["Fecha de asignación", fmtDate(ctx.eventDate)],
  ];
  if (ctx.note) rows.push(["Nota", ctx.note]);
  const text = `${greet(ctx.userName)}

Tu ticket ${ctx.number} fue asignado a un técnico por el administrador.

${rowsText(rows)}

Puedes revisar el seguimiento en ServiceDesk: ${env.frontendUrl}
`;
  const html = wrapHtml(
    subject,
    `<p>${esc(greet(ctx.userName))}</p>
     <p>Tu ticket <strong>${esc(ctx.number)}</strong> fue asignado a un técnico por el administrador.</p>
     ${rowsHtml(rows)}`
  );
  return { subject, textBody: text, htmlBody: html };
}

function ticketEscalated(ctx: TicketEmailContext): EmailTemplate {
  const subject = `Tu ticket ${ctx.number} fue derivado`;
  const rows: Array<[string, string]> = [
    ["Número de ticket", ctx.number],
    ["Servicio", ctx.serviceName ?? "—"],
    ["Estado actual", publicStatus(ctx.status)],
    ["Área responsable nueva", publicArea(ctx.newArea ?? ctx.responsibleArea)],
    ["Fecha", fmtDate(ctx.eventDate)],
  ];
  if (ctx.note) rows.push(["Motivo", ctx.note]);
  const text = `${greet(ctx.userName)}

Tu ticket ${ctx.number} fue derivado para continuar su atención por otra área.

${rowsText(rows)}

Puedes revisar el seguimiento en ServiceDesk: ${env.frontendUrl}
`;
  const html = wrapHtml(
    subject,
    `<p>${esc(greet(ctx.userName))}</p>
     <p>Tu ticket <strong>${esc(ctx.number)}</strong> fue derivado para continuar su atención por otra área.</p>
     ${rowsHtml(rows)}`
  );
  return { subject, textBody: text, htmlBody: html };
}

function ticketResolved(ctx: TicketEmailContext): EmailTemplate {
  const subject = `Tu ticket ${ctx.number} fue resuelto`;
  const rows: Array<[string, string]> = [
    ["Número de ticket", ctx.number],
    ["Servicio", ctx.serviceName ?? "—"],
    ["Estado actual", publicStatus(ctx.status ?? "resuelto")],
    ["Fecha de resolución", fmtDate(ctx.eventDate)],
  ];
  if (ctx.knowledgeTitle) rows.push(["Solución aplicada", ctx.knowledgeTitle]);
  if (ctx.note) rows.push(["Nota final", ctx.note]);
  const text = `${greet(ctx.userName)}

Tu ticket ${ctx.number} fue resuelto. Puedes revisar e imprimir el historial completo en ServiceDesk.

${rowsText(rows)}

Puedes revisar el seguimiento en ServiceDesk: ${env.frontendUrl}
`;
  const html = wrapHtml(
    subject,
    `<p>${esc(greet(ctx.userName))}</p>
     <p>Tu ticket <strong>${esc(ctx.number)}</strong> fue resuelto. Puedes revisar e imprimir el historial completo en ServiceDesk.</p>
     ${rowsHtml(rows)}`
  );
  return { subject, textBody: text, htmlBody: html };
}

function ticketContribution(ctx: TicketEmailContext): EmailTemplate {
  const subject = `Tu ticket ${ctx.number} tiene una nueva actualización`;
  const rows: Array<[string, string]> = [
    ["Número de ticket", ctx.number],
    ["Servicio", ctx.serviceName ?? "—"],
    ["Fecha", fmtDate(ctx.eventDate)],
  ];
  if (ctx.contributionDescription) rows.push(["Actualización", ctx.contributionDescription]);
  const text = `${greet(ctx.userName)}

Tu ticket ${ctx.number} tiene una nueva actualización pública del técnico.

${rowsText(rows)}

Puedes revisar el seguimiento en ServiceDesk: ${env.frontendUrl}
`;
  const html = wrapHtml(
    subject,
    `<p>${esc(greet(ctx.userName))}</p>
     <p>Tu ticket <strong>${esc(ctx.number)}</strong> tiene una nueva actualización pública del técnico.</p>
     ${rowsHtml(rows)}`
  );
  return { subject, textBody: text, htmlBody: html };
}

export function buildEmailTemplate(
  eventType: EmailEventType,
  ctx: TicketEmailContext
): EmailTemplate {
  switch (eventType) {
    case "TICKET_ACCEPTED":
      return ticketAccepted(ctx);
    case "TICKET_ASSIGNED":
      return ticketAssigned(ctx);
    case "TICKET_ESCALATED":
      return ticketEscalated(ctx);
    case "TICKET_RESOLVED":
      return ticketResolved(ctx);
    case "TICKET_CONTRIBUTION":
      return ticketContribution(ctx);
  }
}
