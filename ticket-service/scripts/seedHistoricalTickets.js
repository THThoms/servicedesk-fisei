const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");
const {
  AssignmentStatus,
  EventAction,
  EventVisibility,
  Level,
  PrismaClient,
  Priority,
  ResponsibleArea,
  TicketStatus,
} = require("@prisma/client");
const { areasForRole } = require("../dist/services/areaService");

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const HIST_PREFIX = "TK-HIST-";
const GENERIC_KB_TITLE = "Solucion historica generica ServiceDesk";

const problemDetails = [
  "Problema de conexion a servicio institucional. El usuario reporta intermitencia durante sus actividades.",
  "Falla reportada en equipo institucional. Se solicita revision para restablecer el servicio.",
  "Error de acceso a plataforma institucional. El usuario no puede completar su actividad academica.",
  "Incidencia en servicio de impresion. Se requiere validacion de configuracion y permisos.",
  "Problema con correo institucional. El usuario solicita revision de acceso y funcionamiento.",
  "Solicitud de revision de equipo. Se reporta comportamiento irregular durante la jornada.",
  "Error al utilizar sistema academico. Se requiere soporte para recuperar la operatividad.",
  "Problema de acceso a recurso institucional. Se solicita verificacion del servicio relacionado.",
];

const contributions = [
  "Se verifico el estado del servicio reportado.",
  "Se revisaron credenciales y permisos del usuario.",
  "Se valido conectividad y configuracion del equipo.",
  "Se aplico solucion registrada en la base de conocimiento.",
  "Se confirmo funcionamiento con el usuario solicitante.",
  "Se reviso la configuracion del navegador y permisos asociados.",
  "Se valido el funcionamiento despues de aplicar la solucion.",
];

const escalationReasons = [
  "El caso requiere revision del area responsable.",
  "Se necesita validacion adicional del servicio relacionado.",
  "La incidencia corresponde a otra area de atencion.",
  "Se requiere revision de configuracion institucional.",
];

const resolutions = [
  "Se aplico la solucion correspondiente y se valido el funcionamiento.",
  "El servicio quedo operativo despues de la revision tecnica.",
  "Se corrigio la configuracion y el usuario confirmo la solucion.",
  "Se derivo el caso al area correspondiente y fue atendido correctamente.",
  "Se aplico una solucion de la base de conocimiento y se cerro el caso.",
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta variable de entorno requerida para el seed historico: ${name}`);
  }
  return value;
}

function buildDatabaseUrl(kind) {
  const explicit = process.env[`${kind}_DATABASE_URL`];
  if (explicit) return explicit;

  const host = requiredEnv("POSTGRES_HOST");
  const port = process.env.POSTGRES_PORT ?? "5432";
  const user = requiredEnv(`${kind}_DB_USER`);
  const password = requiredEnv(`${kind}_DB_PASSWORD`);
  const dbName = requiredEnv(`${kind}_DB_NAME`);
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}?schema=public`;
}

const ticketPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL ?? buildDatabaseUrl("TICKET"),
    },
  },
});

const authPrisma = new PrismaClient({
  datasources: { db: { url: buildDatabaseUrl("AUTH") } },
});

const catalogPrisma = new PrismaClient({
  datasources: { db: { url: buildDatabaseUrl("CATALOG") } },
});

function pick(items, index) {
  return items[index % items.length];
}

function priorityFor(index) {
  const bucket = index % 20;
  if (bucket < 5) return Priority.baja;
  if (bucket < 14) return Priority.media;
  if (bucket < 19) return Priority.alta;
  return Priority.critica;
}

function statusFor(index) {
  const bucket = index % 10;
  if (bucket < 7) return TicketStatus.resuelto;
  if (bucket < 9) return TicketStatus.cerrado;
  return TicketStatus.en_proceso;
}

function monthsAgo(months, dayOffset) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(Math.max(1, d.getDate() - dayOffset));
  d.setHours(8 + (dayOffset % 8), (dayOffset * 7) % 60, 0, 0);
  return d;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function publicName(value) {
  return value.trim() || "Sin nombre";
}

function maskEmail(email) {
  if (!email) return "-";
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

async function loadTechnicians() {
  const rows = await authPrisma.$queryRawUnsafe(
    "SELECT id::text, name, role::text FROM users WHERE role::text LIKE 'tech_%' ORDER BY name ASC"
  );

  return rows
    .map((r) => ({
      id: r.id,
      name: publicName(r.name),
      role: r.role,
      areas: areasForRole(r.role),
    }))
    .filter((t) => t.areas.length > 0);
}

async function loadRequesters() {
  return authPrisma.$queryRawUnsafe(
    "SELECT id::text, name, email FROM users WHERE role::text = 'user' ORDER BY name ASC"
  );
}

async function loadServices() {
  const rows = await catalogPrisma.$queryRawUnsafe(
    `SELECT id::text, name, responsible_area::text AS "responsiblearea", level_entry::text AS "levelentry"
     FROM services
     WHERE is_active = true
     ORDER BY name ASC`
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    responsibleArea: r.responsiblearea,
    levelEntry: r.levelentry,
  }));
}

async function loadKnowledgeArticles() {
  const rows = await catalogPrisma.$queryRawUnsafe(
    `SELECT id::text, title, service_id::text AS "serviceid"
     FROM knowledge_articles
     WHERE is_active = true
     ORDER BY updated_at DESC`
  );

  return rows.map((r) => ({ id: r.id, title: r.title, serviceId: r.serviceid }));
}

async function ensureKnowledgeArticle(services, creatorId) {
  let articles = await loadKnowledgeArticles();
  if (articles.length > 0) return articles;

  const existing = await catalogPrisma.$queryRawUnsafe(
    `SELECT id::text, title, service_id::text AS "serviceid"
     FROM knowledge_articles
     WHERE title = $1
     LIMIT 1`,
    GENERIC_KB_TITLE
  );
  if (existing.length > 0) {
    return existing.map((a) => ({ id: a.id, title: a.title, serviceId: a.serviceid }));
  }

  const service = services[0];
  const id = crypto.randomUUID();
  await catalogPrisma.$executeRawUnsafe(
    `INSERT INTO knowledge_articles
      (id, title, problem_description, solution, keywords, service_id, created_by_user_id, is_active, created_at, updated_at)
     VALUES
      ($1::uuid, $2, $3, $4, ARRAY[$5, $6], $7::uuid, $8::uuid, true, NOW(), NOW())`,
    id,
    GENERIC_KB_TITLE,
    "Articulo generado de forma idempotente para respaldar datos historicos de prueba.",
    "Validar el servicio, aplicar la solucion documentada y confirmar funcionamiento con el usuario.",
    "historico",
    "servicedesk",
    service.id,
    creatorId
  );

  return loadKnowledgeArticles();
}

function compatibleServices(technician, services) {
  return services.filter((s) => technician.areas.includes(s.responsibleArea));
}

function articleForService(service, articles, index) {
  const serviceArticle = articles.find((a) => a.serviceId === service.id);
  if (serviceArticle) return serviceArticle;
  return articles.length > 0 ? pick(articles, index) : null;
}

function ticketCountForTech(index) {
  return 8 + (index % 8);
}

function historicalNumber(techIndex, ticketIndex, createdAt) {
  const yyyy = createdAt.getFullYear();
  const mm = String(createdAt.getMonth() + 1).padStart(2, "0");
  const dd = String(createdAt.getDate()).padStart(2, "0");
  const base = `${HIST_PREFIX}${yyyy}${mm}${dd}-${String(techIndex + 1).padStart(2, "0")}-${String(ticketIndex + 1).padStart(3, "0")}`;
  if (process.env.FORCE_HISTORICAL_SEED === "true") {
    return `${base}-${Date.now().toString(36)}`;
  }
  return base;
}

async function main() {
  const force = process.env.FORCE_HISTORICAL_SEED === "true";
  const existingHistorical = await ticketPrisma.ticket.count({
    where: { number: { startsWith: HIST_PREFIX } },
  });

  if (existingHistorical > 0 && !force) {
    console.log("Ya existen datos historicos. No se generaron duplicados.");
    console.log(`Tickets historicos existentes: ${existingHistorical}`);
    return;
  }

  const [technicians, requesters, services] = await Promise.all([
    loadTechnicians(),
    loadRequesters(),
    loadServices(),
  ]);

  if (technicians.length === 0) {
    throw new Error("No se encontraron tecnicos existentes en auth_db.");
  }
  if (requesters.length === 0) {
    throw new Error("No se encontraron usuarios solicitantes existentes en auth_db.");
  }
  if (services.length === 0) {
    throw new Error("No se encontraron servicios activos existentes en catalog_db.");
  }

  const articles = await ensureKnowledgeArticle(services, technicians[0].id);
  const emailBefore = await ticketPrisma.emailOutbox.count();
  const summaries = technicians.map((technician) => ({
    technician,
    created: 0,
    resolved: 0,
    closed: 0,
    escalated: 0,
  }));

  let totalEvents = 0;
  const touchedMonths = new Set();

  for (let techIndex = 0; techIndex < technicians.length; techIndex++) {
    const technician = technicians[techIndex];
    const availableServices = compatibleServices(technician, services);
    if (availableServices.length === 0) {
      throw new Error(`No hay servicios compatibles para el tecnico ${technician.name}.`);
    }

    const perTech = ticketCountForTech(techIndex);
    for (let ticketIndex = 0; ticketIndex < perTech; ticketIndex++) {
      const serial = techIndex * 100 + ticketIndex;
      const service = pick(availableServices, serial);
      const requester = pick(requesters, serial);
      const status = statusFor(serial);
      const createdAt = monthsAgo(1 + (serial % 6), serial % 21);
      const acceptedAt = addHours(createdAt, 2 + (serial % 6));
      const contributionAt = addHours(acceptedAt, 2 + (serial % 12));
      const resolvedAt =
        status === TicketStatus.resuelto || status === TicketStatus.cerrado
          ? addHours(contributionAt, 4 + (serial % 36))
          : null;
      const closedAt =
        status === TicketStatus.cerrado && resolvedAt ? addHours(resolvedAt, 6) : null;
      const updatedAt = closedAt ?? resolvedAt ?? contributionAt;
      const article = resolvedAt ? articleForService(service, articles, serial) : null;
      const shouldEscalate = ticketIndex % 5 === 0;
      // Escalamiento simulado: si el servicio es TECHNICIANS lo hacemos venir de
      // DTIC, y viceversa. Ya no existe el área GENERAL en el modelo.
      const previousArea = shouldEscalate
        ? service.responsibleArea === ResponsibleArea.TECHNICIANS
          ? ResponsibleArea.DTIC
          : ResponsibleArea.TECHNICIANS
        : null;

      touchedMonths.add(`${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}`);

      await ticketPrisma.$transaction(async (tx) => {
        const ticket = await tx.ticket.create({
          data: {
            number: historicalNumber(techIndex, ticketIndex, createdAt),
            userId: requester.id,
            userName: requester.name,
            userEmail: requester.email,
            serviceId: service.id,
            serviceName: service.name,
            detail: pick(problemDetails, serial),
            location: ticketIndex % 3 === 0 ? "Campus institucional" : null,
            status,
            priority: priorityFor(serial),
            responsibleArea: service.responsibleArea,
            assignmentStatus: AssignmentStatus.accepted,
            assignedTechnicianId: technician.id,
            assignedTechnicianName: technician.name,
            acceptedAt,
            resolvedAt,
            resolvedById: resolvedAt ? technician.id : null,
            resolvedByName: resolvedAt ? technician.name : null,
            knowledgeArticleId: article?.id ?? null,
            resolutionSummary: resolvedAt ? pick(resolutions, serial) : null,
            levelAssigned: service.levelEntry,
            createdAt,
            updatedAt,
          },
          select: { id: true },
        });

        await tx.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            action: EventAction.CREATED,
            title: "Ticket historico creado",
            newStatus: TicketStatus.abierto,
            newArea: service.responsibleArea,
            newLevel: service.levelEntry,
            performedBy: requester.id,
            performedByName: requester.name,
            visibility: EventVisibility.public,
            createdAt,
          },
        });
        totalEvents++;

        await tx.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            action: EventAction.ACCEPTED,
            title: `Ticket aceptado por ${technician.name}`,
            previousStatus: TicketStatus.abierto,
            newStatus: TicketStatus.en_proceso,
            newTechnicianId: technician.id,
            performedBy: technician.id,
            performedByName: technician.name,
            visibility: EventVisibility.public,
            createdAt: acceptedAt,
          },
        });
        totalEvents++;

        await tx.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            action: EventAction.CONTRIBUTED,
            title: "Aportacion tecnica historica",
            description: pick(contributions, serial),
            performedBy: technician.id,
            performedByName: technician.name,
            visibility: ticketIndex % 4 === 0 ? EventVisibility.internal : EventVisibility.public,
            createdAt: contributionAt,
          },
        });
        totalEvents++;

        if (shouldEscalate && previousArea) {
          await tx.ticketEvent.create({
            data: {
              ticketId: ticket.id,
              action: EventAction.ESCALATED,
              title: "Derivacion historica registrada",
              previousStatus: TicketStatus.en_proceso,
              newStatus: TicketStatus.escalado,
              previousArea,
              newArea: service.responsibleArea,
              previousTechnicianId: technician.id,
              newTechnicianId: technician.id,
              reason: pick(escalationReasons, serial),
              workDone: pick(contributions, serial + 1),
              performedBy: technician.id,
              performedByName: technician.name,
              visibility: EventVisibility.public,
              createdAt: addHours(contributionAt, 1),
            },
          });
          summaries[techIndex].escalated++;
          totalEvents++;
        }

        if (resolvedAt) {
          await tx.ticketEvent.create({
            data: {
              ticketId: ticket.id,
              action: EventAction.RESOLVED,
              title: article ? `Ticket resuelto con solucion "${article.title}"` : "Ticket resuelto",
              previousStatus: shouldEscalate ? TicketStatus.escalado : TicketStatus.en_proceso,
              newStatus: TicketStatus.resuelto,
              reason: article ? `Solucion aplicada (${article.id})` : "Solucion aplicada",
              workDone: article?.title ?? "Solucion registrada",
              description: pick(resolutions, serial),
              performedBy: technician.id,
              performedByName: technician.name,
              visibility: EventVisibility.public,
              createdAt: resolvedAt,
            },
          });
          summaries[techIndex].resolved++;
          totalEvents++;
        }

        if (closedAt) {
          await tx.ticketEvent.create({
            data: {
              ticketId: ticket.id,
              action: EventAction.CLOSED,
              title: "Ticket cerrado historicamente",
              previousStatus: TicketStatus.resuelto,
              newStatus: TicketStatus.cerrado,
              description: "Cierre administrativo posterior a la resolucion.",
              performedBy: technician.id,
              performedByName: technician.name,
              visibility: EventVisibility.public,
              createdAt: closedAt,
            },
          });
          summaries[techIndex].closed++;
          totalEvents++;
        }
      });

      summaries[techIndex].created++;
    }
  }

  const emailAfter = await ticketPrisma.emailOutbox.count();
  const createdTickets = summaries.reduce((sum, item) => sum + item.created, 0);

  const [byService, byStatus, byArea, resolvedByTech] = await Promise.all([
    ticketPrisma.ticket.groupBy({
      by: ["serviceName"],
      where: { number: { startsWith: HIST_PREFIX } },
      _count: { _all: true },
      orderBy: { _count: { serviceName: "desc" } },
    }),
    ticketPrisma.ticket.groupBy({
      by: ["status"],
      where: { number: { startsWith: HIST_PREFIX } },
      _count: { _all: true },
    }),
    ticketPrisma.ticket.groupBy({
      by: ["responsibleArea"],
      where: { number: { startsWith: HIST_PREFIX } },
      _count: { _all: true },
    }),
    ticketPrisma.ticket.groupBy({
      by: ["resolvedByName"],
      where: { number: { startsWith: HIST_PREFIX }, resolvedById: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { resolvedByName: "desc" } },
    }),
  ]);

  console.log("Seed historico completado.");
  console.log(`Tecnicos detectados: ${technicians.length}`);
  console.log(`Usuarios solicitantes detectados: ${requesters.length}`);
  console.log(`Servicios activos detectados: ${services.length}`);
  console.log(`Articulos de conocimiento detectados/creados: ${articles.length}`);
  console.log(`Tickets historicos creados: ${createdTickets}`);
  console.log(`Eventos historicos creados: ${totalEvents}`);
  console.log(`Meses cubiertos: ${Array.from(touchedMonths).sort().join(", ")}`);
  console.log(`EmailOutbox antes/despues: ${emailBefore}/${emailAfter}`);
  console.log("");
  console.log("Resumen por tecnico:");
  console.table(
    summaries.map((s) => ({
      Tecnico: s.technician.name,
      Areas: s.technician.areas.join(", "),
      "Tickets creados": s.created,
      "Tickets resueltos": s.resolved,
      "Tickets cerrados": s.closed,
      "Tickets derivados": s.escalated,
    }))
  );
  console.log("Tickets por servicio:");
  console.table(byService.map((s) => ({ Servicio: s.serviceName ?? "-", Tickets: s._count._all })));
  console.log("Tickets por estado:");
  console.table(byStatus.map((s) => ({ Estado: s.status, Tickets: s._count._all })));
  console.log("Tickets por area responsable:");
  console.table(byArea.map((s) => ({ Area: s.responsibleArea, Tickets: s._count._all })));
  console.log("Tickets resueltos por tecnico:");
  console.table(resolvedByTech.map((s) => ({ Tecnico: s.resolvedByName ?? "-", Resueltos: s._count._all })));
  console.log(`Solicitantes usados: ${requesters.length} (correos ocultos; ejemplo seguro: ${maskEmail(requesters[0]?.email ?? null)})`);
}

main()
  .catch((err) => {
    console.error("[seed:historical] error:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([
      ticketPrisma.$disconnect(),
      authPrisma.$disconnect(),
      catalogPrisma.$disconnect(),
    ]);
  });
