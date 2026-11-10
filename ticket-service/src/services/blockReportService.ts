// =============================================================================
// Fase T — Reporte de trabajo por BLOQUE físico de la FISEI.
//
// Fuente de verdad:
//   · técnicos del bloque → auth-service (/auth/technicians?block=…)
//   · tickets, eventos y constancias de aceptación → ticket_db (SQL Server)
// DTIC queda fuera: solo cuentan tickets del área TECHNICIANS atendidos
// (asignados o resueltos) por técnicos del bloque. Todo el filtrado ocurre aquí,
// en el backend; el frontend solo presenta.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { ResponsibleArea, TicketStatus } from "../domain/enums";
import { AcceptanceDecision, digitalValidation, type DigitalValidation } from "./acceptanceService";
import type { TechnicianLite } from "./authClient";

export const BLOCK_LABELS: Record<string, string> = { BLOQUE_1: "Bloque 1", BLOQUE_2: "Bloque 2" };

export interface BlockReportFilters {
  block: string;
  from: Date | null;
  to: Date | null;
  technicianId?: string | null;
  status?: string | null;
  serviceId?: string | null;
}

export interface BlockReportHistoryItem {
  createdAt: Date;
  action: string;
  title: string | null;
  performedByName: string;
  reason: string | null;
}

export interface BlockReportActivity {
  ticketId: string;
  number: string;
  status: string;
  serviceName: string | null;
  createdAt: Date;
  attendedAt: Date | null;
  resolvedAt: Date | null;
  requesterName: string | null;
  requesterEmail: string | null;
  description: string;
  /** Ubicación del ticket (p. ej. el laboratorio); null si no se indicó. */
  location: string | null;
  /** Nombre de la solución utilizada: título del artículo de conocimiento aplicado. */
  solutionName: string | null;
  /** Nota final del técnico sobre esa solución. */
  solutionNote: string | null;
  solution: string | null;
  history: BlockReportHistoryItem[];
  validation: DigitalValidation;
}

export interface BlockReportTechnician {
  id: string;
  name: string;
  email: string;
  totals: { tickets: number; closed: number; pendingAcceptance: number; rejected: number; inProgress: number };
  activities: BlockReportActivity[];
}

export interface BlockReport {
  block: string;
  blockLabel: string;
  range: { from: string | null; to: string | null };
  filters: { technicianId: string | null; status: string | null; serviceId: string | null };
  generatedAt: string;
  totals: {
    technicians: number;
    tickets: number;
    closed: number;
    pendingAcceptance: number;
    rejectedByUser: number;
    inProgress: number;
  };
  technicians: BlockReportTechnician[];
}

const CLOSED = new Set<string>([TicketStatus.cerrado, TicketStatus.resuelto]);
const HISTORY_ACTIONS = new Set([
  "CREATED", "ACCEPTED", "CONTRIBUTED", "ESCALATED", "RESOLVED", "USER_ACCEPTED", "USER_REJECTED_RESOLUTION", "ASSIGNED",
]);
const MAX_TICKETS = 2000;

function lc(x: string | null | undefined): string {
  return (x ?? "").toLowerCase();
}

/** Clasificación de un ticket para los totales (excluyentes entre sí salvo "rechazados"). */
function bucket(status: string): "closed" | "pendingAcceptance" | "inProgress" {
  if (CLOSED.has(status)) return "closed";
  if (status === TicketStatus.pendiente_validacion) return "pendingAcceptance";
  return "inProgress";
}

/**
 * Construye el reporte. `technicians` son los del bloque (ya filtrados por
 * auth-service); si se pide un técnico concreto, debe pertenecer al bloque.
 */
export async function buildBlockReport(filters: BlockReportFilters, technicians: TechnicianLite[]): Promise<BlockReport> {
  const techs = filters.technicianId
    ? technicians.filter((t) => lc(t.id) === lc(filters.technicianId))
    : technicians;
  const ids = techs.map((t) => t.id);

  const where: Prisma.TicketWhereInput = {
    responsibleArea: ResponsibleArea.TECHNICIANS, // DTIC no se mezcla
    OR: [{ assignedTechnicianId: { in: ids } }, { resolvedById: { in: ids } }],
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
  };

  const tickets = ids.length
    ? await prisma.ticket.findMany({ where, orderBy: { createdAt: "asc" }, take: MAX_TICKETS })
    : [];
  const ticketIds = tickets.map((t) => t.id);
  const [events, acceptances] = ticketIds.length
    ? await Promise.all([
        prisma.ticketEvent.findMany({
          where: { ticketId: { in: ticketIds }, visibility: "public" },
          orderBy: { createdAt: "asc" },
        }),
        prisma.solutionAcceptance.findMany({ where: { ticketId: { in: ticketIds } } }),
      ])
    : [[], []];

  const eventsBy = new Map<string, typeof events>();
  for (const e of events) eventsBy.set(lc(e.ticketId), [...(eventsBy.get(lc(e.ticketId)) ?? []), e]);
  const accBy = new Map<string, typeof acceptances>();
  for (const a of acceptances) accBy.set(lc(a.ticketId), [...(accBy.get(lc(a.ticketId)) ?? []), a]);

  const totals = { technicians: techs.length, tickets: tickets.length, closed: 0, pendingAcceptance: 0, rejectedByUser: 0, inProgress: 0 };
  const perTech = new Map<string, BlockReportTechnician>(
    techs.map((t) => [
      lc(t.id),
      { id: t.id, name: t.name, email: t.email, totals: { tickets: 0, closed: 0, pendingAcceptance: 0, rejected: 0, inProgress: 0 }, activities: [] },
    ])
  );

  for (const t of tickets) {
    const evs = eventsBy.get(lc(t.id)) ?? [];
    const accs = accBy.get(lc(t.id)) ?? [];
    const validation = digitalValidation(t, accs);
    const hadRejection = accs.some((a) => a.decision === AcceptanceDecision.REJECTED);
    const b = bucket(t.status);
    totals[b] += 1;
    if (hadRejection) totals.rejectedByUser += 1;

    const lastResolved = [...evs].reverse().find((e) => e.action === "RESOLVED");
    const solution = [lastResolved?.workDone, t.resolutionSummary].filter((x): x is string => !!x && x.trim() !== "");
    const activity: BlockReportActivity = {
      ticketId: t.id,
      number: t.number,
      status: t.status,
      serviceName: t.serviceName,
      createdAt: t.createdAt,
      attendedAt: t.acceptedAt,
      resolvedAt: t.resolvedAt,
      requesterName: t.userName,
      requesterEmail: t.userEmail,
      description: t.detail,
      location: t.location ?? null,
      solutionName: lastResolved?.workDone?.trim() || null,
      solutionNote: lastResolved?.description?.trim() || t.resolutionSummary?.trim() || null,
      solution: solution.length ? Array.from(new Set(solution)).join(" — ") : null,
      history: evs
        .filter((e) => HISTORY_ACTIONS.has(e.action))
        .map((e) => ({ createdAt: e.createdAt, action: e.action, title: e.title, performedByName: e.performedByName, reason: e.reason })),
      validation,
    };
    // Responsable del ticket dentro del bloque: quien lo resolvió o, si no, el asignado.
    const owner = perTech.get(lc(t.resolvedById)) ?? perTech.get(lc(t.assignedTechnicianId));
    if (owner) {
      owner.activities.push(activity);
      owner.totals.tickets += 1;
      owner.totals[b] += 1;
      if (hadRejection) owner.totals.rejected += 1;
    }
  }

  return {
    block: filters.block,
    blockLabel: BLOCK_LABELS[filters.block] ?? filters.block,
    range: { from: filters.from?.toISOString() ?? null, to: filters.to?.toISOString() ?? null },
    filters: { technicianId: filters.technicianId ?? null, status: filters.status ?? null, serviceId: filters.serviceId ?? null },
    generatedAt: new Date().toISOString(),
    totals,
    technicians: Array.from(perTech.values()).sort((a, b) => a.name.localeCompare(b.name, "es")),
  };
}
