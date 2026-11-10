// Sprint 2 (rev) - Endpoints administrativos.
//
//   POST /admin/tickets/:id/assign   -> Admin asigna manualmente un ticket a un técnico.
//   GET  /admin/stats/tickets        -> Estadísticas agregadas para el dashboard admin.
//   GET  /admin/technicians          -> Listado de técnicos (con área que cubren).
//   GET  /admin/tickets/history      -> Historial general con filtros + paginación.
//
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
// Sprint B: enums migrados a src/domain/enums.ts.
import { ResponsibleArea, TicketStatus, Priority } from "../domain/enums";
import { prisma } from "../db/client";
import { verifyJwt } from "../middleware/verifyJwt";
import { recordTicketEvent } from "../services/historyService";
import { fetchUsersByIds, fetchTechnicians } from "../services/authClient";
import { areasForRole, canHandleArea, isTechRole, normalizeRole } from "../services/areaService";
// HU-15: notificaciones + administración del outbox.
import {
  notifyTicketAssigned,
  dispatchInBackground,
  processPendingEmails,
} from "../services/emailOutboxService";
import { dispatchPushInBackground } from "../services/fcmService";
// HU-16: reporte individual del técnico.
import { buildTechnicianReport } from "../services/technicianReportService";
import { buildBlockReport } from "../services/blockReportService";

const router = Router();

function requireAdmin(req: Request, res: Response, next: () => void) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Solo el administrador puede acceder a este recurso" });
  }
  next();
}

// ---------------------------------------------------------------------------
// POST /admin/tickets/:id/assign  body: { technicianId, note? }
// ---------------------------------------------------------------------------
const assignSchema = z.object({
  technicianId: z.string().uuid({ message: "technicianId debe ser un UUID válido" }),
  note: z.string().trim().max(500).optional(),
});

router.post("/tickets/:id/assign", verifyJwt, requireAdmin, async (req: Request, res: Response) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { technicianId, note } = parsed.data;

  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
  if (ticket.status === "cerrado") {
    return res.status(409).json({ error: "No se puede asignar un ticket cerrado" });
  }

  // Validar técnico contra auth_db (rol technician o dtic, del área del ticket).
  const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
  let users;
  try {
    users = await fetchUsersByIds([technicianId], userToken);
  } catch (err) {
    console.error("[admin/assign] lookup técnico falló:", err);
    return res.status(502).json({ error: "No se pudo verificar el técnico en auth-service" });
  }
  const tech = users.find((u) => u.id === technicianId);
  if (!tech) {
    return res.status(400).json({ error: "Técnico no encontrado" });
  }
  if (!isTechRole(tech.role)) {
    return res
      .status(400)
      .json({ error: `El usuario ${tech.name} no es técnico` });
  }
  if (!canHandleArea(tech.role, ticket.responsibleArea)) {
    return res.status(400).json({
      error: `El técnico ${tech.name} no atiende tickets del área ${ticket.responsibleArea}`,
    });
  }

  try {
    const { updated, outboxId } = await prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({
        where: { id: req.params.id },
        data: {
          assignedTechnicianId: technicianId,
          assignedTechnicianName: tech.name,
          assignmentStatus: "assigned_by_admin",
          acceptedAt: new Date(),
          ...(ticket.status === "abierto" ? { status: "en_proceso" } : {}),
        },
      });
      await recordTicketEvent(tx, {
        ticketId: req.params.id,
        action: "ASSIGNED",
        title: `Asignado manualmente a ${tech.name}`,
        previousTechnicianId: ticket.assignedTechnicianId,
        newTechnicianId: technicianId,
        previousStatus: ticket.status,
        newStatus: u.status,
        description: note ?? null,
        reason: "Asignación manual por administrador",
        performedBy: req.user!.userId,
        performedByName: req.user!.name,
      });
      // HU-15: notificar al solicitante. Solo enviamos la nota si es texto seguro
      // (el admin la escribió en `note` libremente; no contiene secretos del sistema).
      const outboxId = await notifyTicketAssigned({
        client: tx,
        ticketId: u.id,
        to: ticket.userEmail,
        ctx: {
          number: u.number,
          userName: ticket.userName,
          serviceName: ticket.serviceName,
          status: u.status,
          technicianName: u.assignedTechnicianName,
          eventDate: u.acceptedAt,
          note: note ?? null,
        },
      });
      return { updated: u, outboxId };
    });
    dispatchInBackground(outboxId);

    // Sprint 4+ · Push al técnico asignado (solo si tiene dispositivo activo).
    dispatchPushInBackground([technicianId], {
      title: `Ticket ${updated.number} asignado`,
      body: `${updated.serviceName ?? "Servicio"} · asignado por administrador`,
      data: {
        ticketId: updated.id,
        eventType: "TICKET_ASSIGNED",
      },
      deepLink: `/tickets/${updated.id}`,
    });

    return res.json({
      message: "Ticket asignado correctamente",
      ticket: updated,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "Ticket no encontrado" });
    }
    console.error("[admin/assign] error:", err);
    return res.status(500).json({ error: "Error interno al asignar el ticket" });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/stats/tickets -> Agregados para el dashboard de estadísticas.
//
// HU-12: filtro por rango de fechas (inclusivo) sobre `createdAt`.
//   Query: dateFrom=YYYY-MM-DD, dateTo=YYYY-MM-DD (ambos opcionales).
//   - dateFrom -> inicio del día (00:00:00.000Z).
//   - dateTo   -> fin del día (23:59:59.999Z).
//   - Sin fechas: comportamiento general (todos los tickets).
//
// Cohorte: TODOS los agregados (KPIs, estados, prioridad, área, servicio,
// técnico, resueltos por técnico, createdByDay y ambos promedios) se calculan
// sobre los tickets cuyo `createdAt` cae dentro del rango. Es decir: "de los
// tickets creados en este período, cómo se distribuyen / cuánto tardaron".
// ---------------------------------------------------------------------------
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD");

const statsQuerySchema = z.object({
  dateFrom: dateOnly.optional(),
  dateTo: dateOnly.optional(),
});

function parseDayStart(s: string): Date | null {
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}
function parseDayEnd(s: string): Date | null {
  const d = new Date(`${s}T23:59:59.999Z`);
  return isNaN(d.getTime()) ? null : d;
}

router.get("/stats/tickets", verifyJwt, requireAdmin, async (req: Request, res: Response) => {
  const parsed = statsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Filtros de fecha inválidos", details: parsed.error.issues });
  }
  const { dateFrom, dateTo } = parsed.data;

  const from = dateFrom ? parseDayStart(dateFrom) : null;
  const to = dateTo ? parseDayEnd(dateTo) : null;
  if (dateFrom && !from) {
    return res.status(400).json({ error: "dateFrom no es una fecha válida" });
  }
  if (dateTo && !to) {
    return res.status(400).json({ error: "dateTo no es una fecha válida" });
  }
  if (from && to && from.getTime() > to.getTime()) {
    return res
      .status(400)
      .json({ error: "dateFrom no puede ser posterior a dateTo" });
  }

  // Filtro Prisma sobre createdAt (inclusivo en ambos extremos).
  const createdAtFilter: Prisma.DateTimeFilter | undefined =
    from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
  const rangeWhere: Prisma.TicketWhereInput = createdAtFilter
    ? { createdAt: createdAtFilter }
    : {};

  // Sprint B (rewrite T-SQL): las consultas de estadísticas se reescriben en
  // dialecto SQL Server 2022. Rango sobre `created_at`: usamos parámetros
  // posicionales de `$queryRawUnsafe` — `@P1`, `@P2` — para eliminar
  // interpolación y prevenir inyección. En PG dev las mismas funciones
  // (DATEDIFF, GETUTCDATE, DATEADD, COUNT_BIG) no existen: el try/catch
  // externo captura y mantiene los agregados en null (comportamiento previo
  // ya presente en el try/catch original).
  const rangeParams: Date[] = [];
  const clauses: string[] = [];
  const nextParam = () => `@P${rangeParams.length + 1}`;
  if (from) {
    clauses.push(`created_at >= ${nextParam()}`);
    rangeParams.push(from);
  }
  if (to) {
    clauses.push(`created_at <= ${nextParam()}`);
    rangeParams.push(to);
  }
  const rangeSql = clauses.length ? clauses.join(" AND ") : "";
  const andRange = (base: string) =>
    rangeSql ? `${base} AND ${rangeSql}` : base;

  const [
    totalAll,
    pending,
    inProgress,
    escalated,
    resolved,
    closed,
    accepted,
    available,
    byService,
    byArea,
    byPriority,
    byTechnicianGroups,
  ] = await Promise.all([
    prisma.ticket.count({ where: rangeWhere }),
    prisma.ticket.count({ where: { ...rangeWhere, status: "abierto" } }),
    prisma.ticket.count({ where: { ...rangeWhere, status: "en_proceso" } }),
    prisma.ticket.count({ where: { ...rangeWhere, status: "escalado" } }),
    prisma.ticket.count({ where: { ...rangeWhere, status: "resuelto" } }),
    prisma.ticket.count({ where: { ...rangeWhere, status: "cerrado" } }),
    prisma.ticket.count({ where: { ...rangeWhere, assignmentStatus: "accepted" } }),
    prisma.ticket.count({
      where: { ...rangeWhere, assignedTechnicianId: null, status: { notIn: ["resuelto", "cerrado"] } },
    }),
    prisma.ticket.groupBy({
      by: ["serviceName"],
      _count: { _all: true },
      where: rangeWhere,
      orderBy: { _count: { serviceName: "desc" } },
    }),
    prisma.ticket.groupBy({
      by: ["responsibleArea"],
      _count: { _all: true },
      where: rangeWhere,
    }),
    prisma.ticket.groupBy({
      by: ["priority"],
      _count: { _all: true },
      where: rangeWhere,
    }),
    prisma.ticket.groupBy({
      by: ["assignedTechnicianId", "assignedTechnicianName"],
      _count: { _all: true },
      where: { ...rangeWhere, assignedTechnicianId: { not: null } },
      orderBy: { _count: { assignedTechnicianId: "desc" } },
    }),
  ]);

  // Tiempo promedio de aceptación (segundos entre createdAt y acceptedAt) y
  // de resolución (createdAt -> resolvedAt). Prisma no soporta AVG sobre fechas
  // con el cliente tipado; usamos SQL crudo. En tests con mock no hay
  // $queryRawUnsafe real, por eso el try/catch.
  let avgAcceptSeconds: number | null = null;
  let avgResolveSeconds: number | null = null;
  let resolvedByTechnician: Array<{ technicianId: string | null; technicianName: string; count: number }> = [];
  let createdByDay: Array<{ date: string; count: number }> = [];
  try {
    // Sprint B (T-SQL): reemplazos idiomáticos.
    //  · EXTRACT(EPOCH FROM AVG(a - b))   →  AVG(CAST(DATEDIFF_BIG(SECOND, b, a) AS FLOAT))
    //  · COUNT(*)::bigint                  →  CAST(COUNT_BIG(*) AS bigint)
    //  · date_trunc('day', c)::date        →  CAST(c AS DATE)
    //  · NOW() - INTERVAL '30 days'        →  DATEADD(DAY, -30, SYSUTCDATETIME())
    //  · LIMIT N                           →  TOP N  (después de SELECT)
    // Los rangos de fecha vienen por parámetros posicionales (@P1, @P2).
    const accRaw = await prisma.$queryRawUnsafe<Array<{ avg_secs: number | null }>>(
      `SELECT AVG(CAST(DATEDIFF_BIG(SECOND, created_at, accepted_at) AS FLOAT)) AS avg_secs
       FROM tickets WHERE ${andRange("accepted_at IS NOT NULL")}`,
      ...rangeParams
    );
    avgAcceptSeconds = accRaw?.[0]?.avg_secs ?? null;
    if (avgAcceptSeconds != null) avgAcceptSeconds = Math.round(avgAcceptSeconds);

    const resRaw = await prisma.$queryRawUnsafe<Array<{ avg_secs: number | null }>>(
      `SELECT AVG(CAST(DATEDIFF_BIG(SECOND, created_at, resolved_at) AS FLOAT)) AS avg_secs
       FROM tickets WHERE ${andRange("resolved_at IS NOT NULL")}`,
      ...rangeParams
    );
    avgResolveSeconds = resRaw?.[0]?.avg_secs ?? null;
    if (avgResolveSeconds != null) avgResolveSeconds = Math.round(avgResolveSeconds);

    const resolvedByTechRaw = await prisma.$queryRawUnsafe<
      Array<{ technician_id: string | null; technician_name: string | null; count: bigint }>
    >(
      `SELECT TOP 20 resolved_by_id AS technician_id, resolved_by_name AS technician_name,
              CAST(COUNT_BIG(*) AS bigint) AS count
       FROM tickets
       WHERE ${andRange("resolved_by_id IS NOT NULL")}
       GROUP BY resolved_by_id, resolved_by_name
       ORDER BY count DESC`,
      ...rangeParams
    );
    resolvedByTechnician = resolvedByTechRaw.map((r) => ({
      technicianId: r.technician_id,
      technicianName: r.technician_name ?? "Desconocido",
      count: Number(r.count),
    }));

    // Serie temporal: tickets creados por día. Con rango usa el rango; sin
    // rango mantiene el comportamiento histórico (últimos 30 días).
    const seriesParams: Date[] = [];
    const seriesWhere = rangeSql
      ? (() => {
          seriesParams.push(...rangeParams);
          return rangeSql;
        })()
      : "created_at >= DATEADD(DAY, -30, SYSUTCDATETIME())";
    const seriesRaw = await prisma.$queryRawUnsafe<Array<{ day: Date; count: bigint }>>(
      `SELECT CAST(created_at AS DATE) AS day, CAST(COUNT_BIG(*) AS bigint) AS count
       FROM tickets
       WHERE ${seriesWhere}
       GROUP BY CAST(created_at AS DATE)
       ORDER BY day ASC`,
      ...seriesParams
    );
    createdByDay = seriesRaw.map((r) => ({
      date: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
      count: Number(r.count),
    }));
  } catch {
    /* En tests con mock (o en PG dev, ya que las funciones son T-SQL) los
       agregados quedan en null — mismo fallback silencioso que ya existía. */
  }

  return res.json({
    filters: {
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
    },
    totals: {
      tickets: totalAll,
      pending,
      inProgress,
      escalated,
      resolved,
      closed,
      accepted,
      available,
    },
    byService: byService.map((g) => ({
      service: g.serviceName ?? "Sin servicio",
      count: g._count._all,
    })),
    byResponsibleArea: byArea.map((g) => ({
      area: g.responsibleArea,
      count: g._count._all,
    })),
    byPriority: byPriority.map((g) => ({
      priority: g.priority,
      count: g._count._all,
    })),
    byTechnician: byTechnicianGroups.map((g) => ({
      technicianId: g.assignedTechnicianId,
      technicianName: g.assignedTechnicianName ?? "Desconocido",
      count: g._count._all,
    })),
    resolvedByTechnician,
    createdByDay,
    avgAcceptSeconds,
    avgResolveSeconds,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/technicians -> Lista de técnicos vigentes. Se sirve aquí (no en
// auth-service directo) para enriquecer cada técnico con las áreas que cubre
// según el mapping de areaService.
// ---------------------------------------------------------------------------
router.get("/technicians", verifyJwt, requireAdmin, async (req: Request, res: Response) => {
  const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
  let technicians;
  try {
    technicians = await fetchTechnicians(userToken);
  } catch (err) {
    console.error("[admin/technicians] error:", err);
    return res.status(502).json({ error: "No se pudo obtener la lista de técnicos" });
  }
  return res.json({
    technicians: technicians.map((t) => ({
      id: t.id,
      name: t.name,
      email: t.email,
      role: normalizeRole(t.role),
      isActive: t.isActive,
      areas: areasForRole(t.role),
      block: t.block ?? null,
    })),
  });
});

// ---------------------------------------------------------------------------
// Fase R — Resumen de personal técnico POR ÁREA (sustituye al antiguo
// "bloque" nivel·área; el esquema no tiene bloques físicos y los niveles
// N1–N4 ya no existen como clasificación).
//
// GET /admin/technicians/summary
//   → { total, active, inactive, byArea: [{ area, role, label, count }] }
// Siempre incluye las dos áreas (TECHNICIANS y DTIC), aunque tengan 0.
// ---------------------------------------------------------------------------
const AREA_SUMMARY = [
  { area: "TECHNICIANS", role: "technician", label: "Técnicos" },
  { area: "DTIC", role: "dtic", label: "DTIC" },
] as const;
router.get(
  "/technicians/summary",
  verifyJwt,
  requireAdmin,
  async (req: Request, res: Response) => {
    const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
    let technicians;
    try {
      technicians = await fetchTechnicians(userToken);
    } catch (err) {
      console.error("[admin/technicians/summary] error:", err);
      return res.status(502).json({ error: "No se pudo obtener la lista de técnicos" });
    }
    const active = technicians.filter((t) => t.isActive && isTechRole(t.role));
    const byArea = AREA_SUMMARY.map((a) => ({
      ...a,
      count: active.filter((t) => normalizeRole(t.role) === a.role).length,
    }));
    return res.json({
      total: technicians.length,
      active: active.length,
      inactive: technicians.length - active.length,
      byArea,
    });
  }
);

// ---------------------------------------------------------------------------
// GET /admin/tickets/history -> Historial general filtrable. Devuelve TODOS
// los tickets (incluye resueltos/cerrados) para auditoría. Solo admin.
//
// Query: status, technicianId, serviceId, responsibleArea, priority, from, to,
//        page (>=1, default 1), limit (1..100, default 20).
// ---------------------------------------------------------------------------
const historyQuerySchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  technicianId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  responsibleArea: z.nativeEnum(ResponsibleArea).optional(),
  priority: z.nativeEnum(Priority).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get("/tickets/history", verifyJwt, requireAdmin, async (req: Request, res: Response) => {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Filtros inválidos", details: parsed.error.issues });
  }
  const { status, technicianId, serviceId, responsibleArea, priority, from, to, page, limit } =
    parsed.data;

  const where: Prisma.TicketWhereInput = {};
  if (status) where.status = status;
  if (technicianId) where.assignedTechnicianId = technicianId;
  if (serviceId) where.serviceId = serviceId;
  if (responsibleArea) where.responsibleArea = responsibleArea;
  if (priority) where.priority = priority;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const effectivePage = page ?? 1;
  const effectiveLimit = limit ?? 20;

  const [tickets, total] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (effectivePage - 1) * effectiveLimit,
      take: effectiveLimit,
    }),
    prisma.ticket.count({ where }),
  ]);

  return res.json({
    tickets: tickets.map((t) => ({
      id: t.id,
      number: t.number,
      requesterName: t.userName,
      requesterEmail: t.userEmail,
      serviceName: t.serviceName,
      serviceId: t.serviceId,
      responsibleArea: t.responsibleArea,
      priority: t.priority,
      status: t.status,
      assignmentStatus: t.assignmentStatus,
      assignedTechnicianId: t.assignedTechnicianId,
      assignedTechnicianName: t.assignedTechnicianName,
      acceptedAt: t.acceptedAt,
      resolvedAt: t.resolvedAt,
      resolvedById: t.resolvedById,
      resolvedByName: t.resolvedByName,
      resolutionSummary: t.resolutionSummary,
      knowledgeArticleId: t.knowledgeArticleId,
      createdAt: t.createdAt,
    })),
    total,
    page: effectivePage,
    limit: effectiveLimit,
    filters: {
      status: status ?? null,
      technicianId: technicianId ?? null,
      serviceId: serviceId ?? null,
      responsibleArea: responsibleArea ?? null,
      priority: priority ?? null,
      from: from ?? null,
      to: to ?? null,
    },
  });
});

// ---------------------------------------------------------------------------
// HU-15 - Email Outbox admin
//
// GET  /admin/email-outbox          -> lista resumida (sin htmlBody) con filtros.
// POST /admin/email-outbox/process  -> dispara reintentos de pending/failed.
// ---------------------------------------------------------------------------
const outboxQuerySchema = z.object({
  status: z.enum(["pending", "sent", "failed"]).optional(),
  eventType: z.string().trim().min(1).max(64).optional(),
  ticketId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get("/email-outbox", verifyJwt, requireAdmin, async (req: Request, res: Response) => {
  const parsed = outboxQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Filtros inválidos", details: parsed.error.issues });
  }
  const { status, eventType, ticketId, limit } = parsed.data;
  const where: Prisma.EmailOutboxWhereInput = {};
  if (status) where.status = status;
  if (eventType) where.eventType = eventType;
  if (ticketId) where.ticketId = ticketId;

  const rows = await prisma.emailOutbox.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit ?? 50,
    // NO devolvemos htmlBody ni textBody por defecto (pesa y puede tener detalles del ticket).
    select: {
      id: true,
      ticketId: true,
      to: true,
      subject: true,
      eventType: true,
      status: true,
      attempts: true,
      lastError: true,
      sentAt: true,
      createdAt: true,
    },
  });
  return res.json({ outbox: rows, total: rows.length });
});

const processSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.post("/email-outbox/process", verifyJwt, requireAdmin, async (req: Request, res: Response) => {
  const parsed = processSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Parámetros inválidos", details: parsed.error.issues });
  }
  const summary = await processPendingEmails(parsed.data.limit ?? 50);
  return res.json({ message: "Procesamiento de outbox completado", ...summary });
});

// ---------------------------------------------------------------------------
// HU-16 - Reporte individual del técnico.
//
// GET /admin/reports/technicians/:technicianId?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Reglas:
//   - Solo admin (verifyJwt + requireAdmin).
//   - technicianId debe ser UUID y debe existir como técnico en auth-service.
//   - Reporte se calcula sobre datos REALES de ticket_db (nunca ficticios).
//   - Rango de fechas aplica al createdAt del ticket / evento (misma cohorte
//     que HU-12 stats). Sin rango = todo el historial.
// ---------------------------------------------------------------------------
const reportQuerySchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

router.get(
  "/reports/technicians/:technicianId",
  verifyJwt,
  requireAdmin,
  async (req: Request, res: Response) => {
    // 1) Validar technicianId como UUID.
    const idOk = z.string().uuid().safeParse(req.params.technicianId);
    if (!idOk.success) {
      return res.status(400).json({ error: "technicianId debe ser un UUID válido" });
    }
    const technicianId = idOk.data;

    // 2) Validar fechas.
    const parsed = reportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Filtros inválidos", details: parsed.error.issues });
    }
    const { from: fromStr, to: toStr } = parsed.data;
    const from = fromStr ? parseDayStart(fromStr) : null;
    const to = toStr ? parseDayEnd(toStr) : null;
    if (fromStr && !from) return res.status(400).json({ error: "from no es una fecha válida" });
    if (toStr && !to) return res.status(400).json({ error: "to no es una fecha válida" });
    if (from && to && from.getTime() > to.getTime()) {
      return res.status(400).json({ error: "from no puede ser posterior a to" });
    }

    // 3) Validar que el técnico exista en auth-service (fuente de verdad).
    const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
    let technicians;
    try {
      technicians = await fetchTechnicians(userToken);
    } catch (err) {
      console.error("[admin/reports/technicians] error obteniendo lista:", err);
      return res.status(502).json({ error: "No se pudo obtener la lista de técnicos" });
    }
    const tech = technicians.find((t) => t.id === technicianId);
    if (!tech) {
      return res.status(404).json({ error: "Técnico no encontrado" });
    }

    // 4) Construir reporte real.
    try {
      const report = await buildTechnicianReport(
        {
          id: tech.id,
          name: tech.name,
          email: tech.email,
          role: normalizeRole(tech.role),
          areas: areasForRole(tech.role),
        },
        { from, to }
      );
      return res.json(report);
    } catch (err) {
      console.error("[admin/reports/technicians] error construyendo reporte:", err);
      return res.status(500).json({ error: "Error interno al generar el reporte" });
    }
  }
);

// ---------------------------------------------------------------------------
// Fase T — GET /admin/reports/block?block=BLOQUE_1|BLOQUE_2&from&to
//                                  [&technicianId][&status][&serviceId]
// Solo admin. Técnicos del bloque desde auth-service; tickets del área
// TECHNICIANS (DTIC excluido) desde ticket_db; validación digital real.
// ---------------------------------------------------------------------------
const blockReportSchema = z.object({
  block: z.enum(["BLOQUE_1", "BLOQUE_2"], { errorMap: () => ({ message: "block debe ser BLOQUE_1 o BLOQUE_2" }) }),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  technicianId: z.string().uuid().optional(),
  status: z.enum(Object.values(TicketStatus) as [string, ...string[]]).optional(),
  serviceId: z.string().uuid().optional(),
});

router.get("/reports/block", verifyJwt, requireAdmin, async (req: Request, res: Response) => {
  const parsed = blockReportSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Filtros inválidos", details: parsed.error.issues });
  }
  const q = parsed.data;
  const from = q.from ? parseDayStart(q.from) : null;
  const to = q.to ? parseDayEnd(q.to) : null;
  if ((q.from && !from) || (q.to && !to)) return res.status(400).json({ error: "Fecha inválida" });
  if (from && to && from.getTime() > to.getTime()) {
    return res.status(400).json({ error: "from no puede ser posterior a to" });
  }
  const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
  let technicians;
  try {
    technicians = await fetchTechnicians(userToken, { block: q.block });
  } catch (err) {
    console.error("[admin/reports/block] error obteniendo técnicos:", err);
    return res.status(502).json({ error: "No se pudo obtener la lista de técnicos" });
  }
  // Defensa adicional: solo rol technician con ese bloque (nunca DTIC).
  technicians = technicians.filter((t) => normalizeRole(t.role) === "technician" && t.block === q.block);
  if (q.technicianId && !technicians.some((t) => t.id.toLowerCase() === q.technicianId!.toLowerCase())) {
    return res.status(404).json({ error: "El técnico no pertenece a ese bloque" });
  }
  try {
    const report = await buildBlockReport(
      { block: q.block, from, to, technicianId: q.technicianId ?? null, status: q.status ?? null, serviceId: q.serviceId ?? null },
      technicians
    );
    return res.json(report);
  } catch (err) {
    console.error("[admin/reports/block] error construyendo reporte:", err);
    return res.status(500).json({ error: "Error interno al generar el reporte" });
  }
});

export default router;
