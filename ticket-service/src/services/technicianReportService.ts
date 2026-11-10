// HU-16 - Servicio de Reporte Individual de Técnico.
//
// Consulta REAL a la BD (nunca datos ficticios): agrega tickets, eventos y
// aportaciones donde el técnico participó. Filtro opcional por rango de
// createdAt (cohorte igual a HU-12 stats).
//
// Reglas:
//   - Todo se calcula sobre datos reales de ticket_db.
//   - Un ticket "del técnico" es aquel donde assignedTechnicianId=X O resolvedById=X.
//   - Los eventos "del técnico" son los que tienen performedBy=X.
//   - Sin datos, todo retorna 0 / arrays vacíos (no rompe gráficos ni resumen).

import { Prisma } from "@prisma/client";
import { digitalValidation, type DigitalValidation } from "./acceptanceService";
import { prisma } from "../db/client";

export interface TechnicianRef {
  id: string;
  name: string;
  email: string;
  role: string;
  areas: string[];
}

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

export interface TechnicianReportSummary {
  ticketsAssigned: number;
  ticketsAccepted: number;
  ticketsInProgress: number;
  ticketsEscalated: number;
  ticketsResolved: number;
  ticketsClosed: number;
  contributions: number;
  reescalations: number;
  distinctServices: number;
}

export interface ReportTicketRow {
  id: string;
  number: string;
  createdAt: Date;
  title: string;
  detail: string | null;
  serviceName: string | null;
  /** Ubicación del ticket (p. ej. el laboratorio); null si no se indicó. */
  location: string | null;
  /** Nombre de la solución utilizada: título del artículo de conocimiento aplicado. */
  solutionName: string | null;
  responsibleArea: string;
  priority: string;
  status: string;
  requesterName: string | null;
  requesterEmail: string | null;
  assignedTechnicianName: string | null;
  acceptedAt: Date | null;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  resolutionSummary: string | null;
  knowledgeArticleId: string | null;
  /** Fase T: validación digital del usuario (solo registros reales de ticket_db). */
  validation: DigitalValidation;
}

export interface ReportActivityRow {
  id: string;
  ticketId: string;
  ticketNumber: string | null;
  createdAt: Date;
  actionType: string;
  performedByName: string;
  description: string | null;
  reason: string | null;
  workDone: string | null;
  previousArea: string | null;
  newArea: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  visibility: string;
}

export interface ReportEscalation {
  ticketNumber: string | null;
  createdAt: Date;
  previousArea: string | null;
  newArea: string | null;
  reason: string | null;
  workDone: string | null;
  performedByName: string;
}

export interface ReportResolution {
  ticketNumber: string;
  serviceName: string | null;
  location: string | null;
  solutionName: string | null;
  problemDescription: string | null;
  resolvedAt: Date | null;
  resolutionSummary: string | null;
  knowledgeArticleId: string | null;
  resolvedByName: string | null;
}

export interface ReportContribution {
  ticketNumber: string | null;
  createdAt: Date;
  performedByName: string;
  description: string | null;
}

export interface CountByLabel {
  label: string;
  count: number;
}

export interface MonthlySeriesPoint {
  month: string; // YYYY-MM
  count: number;
}

export interface TechnicianReport {
  technician: TechnicianRef;
  range: { from: string | null; to: string | null };
  generatedAt: string;
  summary: TechnicianReportSummary;
  tickets: ReportTicketRow[];
  activity: ReportActivityRow[];
  escalations: ReportEscalation[];
  resolutions: ReportResolution[];
  contributions: ReportContribution[];
  byService: CountByLabel[];
  byStatus: CountByLabel[];
  byPriority: CountByLabel[];
  byMonth: MonthlySeriesPoint[];
}

// ---------------------------------------------------------------------------
// Filtros base reutilizables
// ---------------------------------------------------------------------------
function createdAtFilter(range: DateRange): Prisma.DateTimeFilter | undefined {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}

/**
 * Where para "tickets del técnico X": asignados a X o resueltos por X.
 * Aplica el rango de fechas al createdAt del ticket cuando se provee.
 */
function ticketsWhereForTech(
  technicianId: string,
  range: DateRange
): Prisma.TicketWhereInput {
  const dateF = createdAtFilter(range);
  const base: Prisma.TicketWhereInput = {
    OR: [
      { assignedTechnicianId: technicianId },
      { resolvedById: technicianId },
    ],
  };
  return dateF ? { ...base, createdAt: dateF } : base;
}

/**
 * Where para eventos del técnico X (performedBy=X).
 * El rango se aplica sobre event.createdAt.
 */
function eventsWhereForTech(
  technicianId: string,
  range: DateRange
): Prisma.TicketEventWhereInput {
  const dateF = createdAtFilter(range);
  const base: Prisma.TicketEventWhereInput = { performedBy: technicianId };
  return dateF ? { ...base, createdAt: dateF } : base;
}

// ---------------------------------------------------------------------------
// Cálculo del reporte completo. Reutiliza patrones de HU-12 (stats admin) y
// HU-09 (historial). No inventa nada — sale todo de ticket_db.
// ---------------------------------------------------------------------------
export async function buildTechnicianReport(
  technician: TechnicianRef,
  range: DateRange
): Promise<TechnicianReport> {
  const techId = technician.id;
  const ticketsWhere = ticketsWhereForTech(techId, range);
  const eventsWhere = eventsWhereForTech(techId, range);

  // Tickets completos del técnico en el rango (para tabla y estadísticas).
  const tickets = await prisma.ticket.findMany({
    where: ticketsWhere,
    orderBy: { createdAt: "desc" },
    take: 500, // corte defensivo: reportes con >500 tickets deben paginarse
  });

  // Eventos del técnico dentro del rango (para tabla de actividad).
  const events = await prisma.ticketEvent.findMany({
    where: eventsWhere,
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  // Índice ticketId -> number para enriquecer eventos.
  const ticketNumberById = new Map<string, string>();
  for (const t of tickets) ticketNumberById.set(t.id, t.number);
  // Puede haber eventos en tickets fuera del set (por rangos angostos): los
  // resolvemos con un segundo lookup mínimo.
  const missingTicketIds = Array.from(
    new Set(events.filter((e) => !ticketNumberById.has(e.ticketId)).map((e) => e.ticketId))
  );
  if (missingTicketIds.length > 0) {
    const extra = await prisma.ticket.findMany({
      where: { id: { in: missingTicketIds } },
      select: { id: true, number: true },
    });
    for (const t of extra) ticketNumberById.set(t.id, t.number);
  }

  // Conteos que NO dependen del rango de fechas del ticket sino del evento:
  // aportaciones y reescalamientos hechos por el técnico dentro del rango.
  const [contribCount, escalationCount, acceptedCount] = await Promise.all([
    prisma.ticketEvent.count({ where: { ...eventsWhere, action: "CONTRIBUTED" } }),
    prisma.ticketEvent.count({ where: { ...eventsWhere, action: "ESCALATED" } }),
    prisma.ticketEvent.count({ where: { ...eventsWhere, action: "ACCEPTED" } }),
  ]);

  // Estadísticas por estado / prioridad / servicio (sobre tickets del técnico).
  const [byStatusRaw, byPriorityRaw, byServiceRaw] = await Promise.all([
    prisma.ticket.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: ticketsWhere,
    }),
    prisma.ticket.groupBy({
      by: ["priority"],
      _count: { _all: true },
      where: ticketsWhere,
    }),
    prisma.ticket.groupBy({
      by: ["serviceName"],
      _count: { _all: true },
      where: ticketsWhere,
      orderBy: { _count: { serviceName: "desc" } },
    }),
  ]);

  const byStatus: CountByLabel[] = byStatusRaw.map((g) => ({
    label: g.status,
    count: g._count._all,
  }));
  const byPriority: CountByLabel[] = byPriorityRaw.map((g) => ({
    label: g.priority,
    count: g._count._all,
  }));
  const byService: CountByLabel[] = byServiceRaw.map((g) => ({
    label: g.serviceName ?? "Sin servicio",
    count: g._count._all,
  }));

  // Serie mensual: cuenta de tickets creados por mes en el rango.
  // Se calcula en memoria a partir del arreglo `tickets` (ya limitado a 500).
  const monthMap = new Map<string, number>();
  for (const t of tickets) {
    const d = t.createdAt;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, (monthMap.get(key) ?? 0) + 1);
  }
  const byMonth: MonthlySeriesPoint[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  // Filas de resumen
  const summary: TechnicianReportSummary = {
    ticketsAssigned: tickets.filter((t) => t.assignedTechnicianId === techId).length,
    ticketsAccepted: acceptedCount,
    ticketsInProgress: tickets.filter(
      (t) => t.assignedTechnicianId === techId && t.status === "en_proceso"
    ).length,
    ticketsEscalated: escalationCount,
    ticketsResolved: tickets.filter((t) => t.resolvedById === techId).length,
    ticketsClosed: tickets.filter((t) => t.status === "cerrado").length,
    contributions: contribCount,
    reescalations: escalationCount,
    distinctServices: new Set(
      tickets.map((t) => t.serviceName).filter((s): s is string => Boolean(s))
    ).size,
  };

  // Fase T: constancias de aceptación/rechazo de estos tickets (una consulta).
  const acceptanceRows = tickets.length
    ? await prisma.solutionAcceptance.findMany({ where: { ticketId: { in: tickets.map((t) => t.id) } } })
    : [];
  const acceptancesByTicket = new Map<string, typeof acceptanceRows>();
  for (const a of acceptanceRows) {
    const k = a.ticketId.toLowerCase();
    acceptancesByTicket.set(k, [...(acceptancesByTicket.get(k) ?? []), a]);
  }

  // Solución vigente de cada ticket: el último evento RESOLVED, aunque lo registrara
  // otro técnico o quede fuera del rango (`events` solo trae los del técnico).
  const resolvedRows = tickets.length
    ? await prisma.ticketEvent.findMany({
        where: { ticketId: { in: tickets.map((t) => t.id) }, action: "RESOLVED" },
        orderBy: { createdAt: "desc" },
        select: { ticketId: true, workDone: true, action: true },
      })
    : [];
  const solutionNameByTicket = new Map<string, string>();
  for (const e of resolvedRows ?? []) {
    const k = e.ticketId.toLowerCase();
    if (e.action === "RESOLVED" && !solutionNameByTicket.has(k) && e.workDone?.trim()) solutionNameByTicket.set(k, e.workDone.trim());
  }

  const ticketRows: ReportTicketRow[] = tickets.map((t) => ({
    validation: digitalValidation(t, acceptancesByTicket.get(t.id.toLowerCase()) ?? []),
    id: t.id,
    number: t.number,
    createdAt: t.createdAt,
    title: t.number, // el modelo no tiene "title" separado; el número humano hace de título
    detail: t.detail,
    serviceName: t.serviceName,
    location: t.location ?? null,
    solutionName: solutionNameByTicket.get(t.id.toLowerCase()) ?? null,
    responsibleArea: t.responsibleArea,
    priority: t.priority,
    status: t.status,
    requesterName: t.userName,
    requesterEmail: t.userEmail,
    assignedTechnicianName: t.assignedTechnicianName,
    acceptedAt: t.acceptedAt,
    resolvedAt: t.resolvedAt,
    resolvedByName: t.resolvedByName,
    resolutionSummary: t.resolutionSummary,
    knowledgeArticleId: t.knowledgeArticleId,
  }));

  const activity: ReportActivityRow[] = events.map((e) => ({
    id: e.id,
    ticketId: e.ticketId,
    ticketNumber: ticketNumberById.get(e.ticketId) ?? null,
    createdAt: e.createdAt,
    actionType: e.action,
    performedByName: e.performedByName,
    description: e.description,
    reason: e.reason,
    workDone: e.workDone,
    previousArea: e.previousArea,
    newArea: e.newArea,
    previousStatus: e.previousStatus,
    newStatus: e.newStatus,
    visibility: e.visibility,
  }));

  const escalations: ReportEscalation[] = events
    .filter((e) => e.action === "ESCALATED")
    .map((e) => ({
      ticketNumber: ticketNumberById.get(e.ticketId) ?? null,
      createdAt: e.createdAt,
      previousArea: e.previousArea,
      newArea: e.newArea,
      reason: e.reason,
      workDone: e.workDone,
      performedByName: e.performedByName,
    }));

  const contributions: ReportContribution[] = events
    .filter((e) => e.action === "CONTRIBUTED")
    .map((e) => ({
      ticketNumber: ticketNumberById.get(e.ticketId) ?? null,
      createdAt: e.createdAt,
      performedByName: e.performedByName,
      description: e.description,
    }));

  const resolutions: ReportResolution[] = tickets
    .filter((t) => t.resolvedById === techId)
    .map((t) => ({
      ticketNumber: t.number,
      serviceName: t.serviceName,
      location: t.location ?? null,
      solutionName: solutionNameByTicket.get(t.id.toLowerCase()) ?? null,
      problemDescription: t.detail,
      resolvedAt: t.resolvedAt,
      resolutionSummary: t.resolutionSummary,
      knowledgeArticleId: t.knowledgeArticleId,
      resolvedByName: t.resolvedByName,
    }));

  return {
    technician,
    range: {
      from: range.from ? range.from.toISOString().slice(0, 10) : null,
      to: range.to ? range.to.toISOString().slice(0, 10) : null,
    },
    generatedAt: new Date().toISOString(),
    summary,
    tickets: ticketRows,
    activity,
    escalations,
    resolutions,
    contributions,
    byService,
    byStatus,
    byPriority,
    byMonth,
  };
}
