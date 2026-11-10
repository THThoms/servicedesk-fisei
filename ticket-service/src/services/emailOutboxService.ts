// HU-15 - Servicio del Email Outbox.
//
// Responsabilidades:
//   - createEmailOutbox(): crea un registro pending DENTRO de la transacción
//     de la acción del ticket (DB local, confiable).
//   - dispatchEmail(): intenta enviar; marca sent o failed. NUNCA lanza al
//     caller — los errores son warnings controlados.
//   - processPendingEmails(limit): reintenta correos pending/failed con
//     attempts < MAX_ATTEMPTS. Usado por POST /admin/email-outbox/process.
//   - notifyTicket*: helpers de alto nivel por evento. Cada uno arma el
//     template, valida email, crea outbox y lanza dispatch en best-effort.
//
// Reglas:
//   - Si EMAIL_NOTIFICATIONS_ENABLED=false, no se crea outbox ni se envía.
//   - Si userEmail es inválido, no se crea outbox (sin ruido).
//   - Todo error de SMTP queda registrado como `lastError` truncado a 500 chars.
//   - El helper recibe el cliente Prisma (puede ser tx o el global) para
//     atomicidad cuando se invoca dentro de prisma.$transaction.

import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { env } from "../config/env";
import {
  buildEmailTemplate,
  EmailEventType,
  TicketEmailContext,
} from "./emailTemplates";
import { getEmailTransport, isValidEmail } from "./emailService";

export const MAX_EMAIL_ATTEMPTS = 3;

// Cliente Prisma reducido: permite tx o el global.
type EmailOutboxClient = {
  emailOutbox: {
    create: (args: Prisma.EmailOutboxCreateArgs) => Promise<{ id: string }>;
  };
};

interface CreateOutboxInput {
  ticketId: string | null;
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  eventType: EmailEventType;
}

/**
 * Crea un registro pending en email_outbox. Devuelve el id (o null si no se
 * creó por email inválido o feature deshabilitada). NUNCA lanza.
 */
export async function createEmailOutbox(
  client: EmailOutboxClient,
  input: CreateOutboxInput
): Promise<string | null> {
  if (!env.email.enabled) return null;
  if (!isValidEmail(input.to)) return null;
  try {
    const row = await client.emailOutbox.create({
      data: {
        ticketId: input.ticketId,
        to: input.to.trim(),
        subject: input.subject,
        htmlBody: input.htmlBody,
        textBody: input.textBody ?? null,
        eventType: input.eventType,
        // status default = pending
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.warn("[email/outbox] no se pudo crear outbox:", (err as Error).message);
    return null;
  }
}

/**
 * Intenta enviar un email del outbox. Marca sent o failed según resultado.
 * NUNCA lanza al caller.
 */
export async function dispatchEmail(outboxId: string): Promise<void> {
  if (!env.email.enabled) return;
  let row;
  try {
    row = await prisma.emailOutbox.findUnique({ where: { id: outboxId } });
  } catch (err) {
    console.warn("[email/dispatch] lookup falló:", (err as Error).message);
    return;
  }
  if (!row || row.status === "sent") return;

  const transport = getEmailTransport();
  const ticketRef = row.ticketId ?? "-";
  try {
    await transport.send({
      to: row.to,
      subject: row.subject,
      htmlBody: row.htmlBody,
      textBody: row.textBody ?? undefined,
      eventType: row.eventType,
      ticketNumber: ticketRef,
    });
    await prisma.emailOutbox.update({
      where: { id: outboxId },
      data: {
        status: "sent",
        sentAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
      },
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.warn(
      `[email/dispatch] FAIL event=${row.eventType} to=${row.to} reason=${msg.slice(0, 200)}`
    );
    try {
      await prisma.emailOutbox.update({
        where: { id: outboxId },
        data: {
          status: "failed",
          attempts: { increment: 1 },
          lastError: msg.slice(0, 500),
        },
      });
    } catch {
      /* swallow: el dispatch nunca debe propagar */
    }
  }
}

/**
 * Reintenta correos pending/failed con attempts < MAX_EMAIL_ATTEMPTS.
 * Devuelve resumen { processed, sent, failed }.
 */
export async function processPendingEmails(limit = 50): Promise<{
  processed: number;
  sent: number;
  failed: number;
}> {
  if (!env.email.enabled) return { processed: 0, sent: 0, failed: 0 };
  const pendings = await prisma.emailOutbox.findMany({
    where: {
      status: { in: ["pending", "failed"] },
      attempts: { lt: MAX_EMAIL_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: { id: true, status: true },
  });
  let sent = 0;
  let failed = 0;
  for (const p of pendings) {
    const before = p.status;
    await dispatchEmail(p.id);
    const after = await prisma.emailOutbox.findUnique({
      where: { id: p.id },
      select: { status: true },
    });
    if (after?.status === "sent") sent++;
    else if (after?.status === "failed" && before !== "sent") failed++;
  }
  return { processed: pendings.length, sent, failed };
}

// -----------------------------------------------------------------------------
// Helpers de alto nivel: 1 función por evento. Toda lógica de armado de
// template + outbox + dispatch vive aquí. Las rutas solo los llaman.
// Cada helper es best-effort: nunca lanza.
// -----------------------------------------------------------------------------

interface NotifyContext {
  client: EmailOutboxClient; // tx o prisma global
  ticketId: string;
  to: string | null | undefined;
  ctx: TicketEmailContext;
}

async function notify(
  eventType: EmailEventType,
  args: NotifyContext
): Promise<string | null> {
  if (!env.email.enabled) return null;
  if (!isValidEmail(args.to)) return null;
  const tpl = buildEmailTemplate(eventType, args.ctx);
  const id = await createEmailOutbox(args.client, {
    ticketId: args.ticketId,
    to: args.to!.trim(),
    subject: tpl.subject,
    htmlBody: tpl.htmlBody,
    textBody: tpl.textBody,
    eventType,
  });
  return id;
}

export async function notifyTicketAccepted(args: NotifyContext): Promise<string | null> {
  return notify("TICKET_ACCEPTED", args);
}
export async function notifyTicketAssigned(args: NotifyContext): Promise<string | null> {
  return notify("TICKET_ASSIGNED", args);
}
export async function notifyTicketEscalated(args: NotifyContext): Promise<string | null> {
  return notify("TICKET_ESCALATED", args);
}
export async function notifyTicketResolved(args: NotifyContext): Promise<string | null> {
  return notify("TICKET_RESOLVED", args);
}
export async function notifyTicketContribution(
  args: NotifyContext & { visibility?: "public" | "internal" }
): Promise<string | null> {
  // Regla HU-15: aportaciones internas NO disparan correo.
  if (args.visibility === "internal") return null;
  return notify("TICKET_CONTRIBUTION", args);
}

/**
 * Lanza dispatchEmail en best-effort, sin bloquear al caller. Pensado para
 * usarse después de un `prisma.$transaction` exitoso.
 */
export function dispatchInBackground(outboxId: string | null): void {
  if (!outboxId) return;
  // Importante: NO await. Atrapamos errores en el catch global del dispatcher.
  void dispatchEmail(outboxId);
}
