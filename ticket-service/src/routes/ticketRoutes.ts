import { Router, Request, Response, NextFunction } from "express";
import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import { z } from "zod";
import multer from "multer";
import { prisma } from "../db/client";
import { verifyJwt } from "../middleware/verifyJwt";
import { uploadAttachments, HEIC_MESSAGE } from "../middleware/upload";
import { fetchService, fetchAllServices, ServiceNotFoundError } from "../services/catalogClient";
import { fetchUsersByIds } from "../services/authClient";
import { generateTicketNumber } from "../services/ticketNumber";
import {
  resolveLevel,
  NoRoutingRuleError,
  InvalidLevelError,
} from "../services/routingService";
import { recordTicketEvent, describeEvent } from "../services/historyService";
import { getStorageAdapter, StoredImage, serializeAttachment } from "../services/storageService";
import { detectImageType, readHead, EXT_BY_MIME } from "../services/imageType";
import { dispatchPushInBackground } from "../services/fcmService";
import { fetchTechnicians } from "../services/authClient";
import { areasForRole, ticketAccess } from "../services/areaService";
import { Prisma } from "@prisma/client";
// Sprint B: enums migrados a src/domain/enums.ts.
import { EventAction, Level, Priority, ResponsibleArea, TicketStatus } from "../domain/enums";
import { env } from "../config/env";




const router = Router();

const createSchema = z.object({
  serviceId: z.string().uuid({ message: "serviceId debe ser un UUID válido" }),
  detail: z.string().min(5, "El detalle debe tener al menos 5 caracteres").max(5000),
  location: z.string().max(255).optional(),
  // HU-06: prioridad opcional. Default `media` (en BD), el motor sube el nivel
  // cuando es `alta` o `critica`. Compat: clientes viejos no envían el campo.
  priority: z.nativeEnum(Priority).optional(),
});

// ---------------------------------------------------------------------------
// Limpieza de archivos en disco si la transacción posterior falla.
// ---------------------------------------------------------------------------
function cleanupFiles(files: Express.Multer.File[]) {
  for (const f of files) {
    fs.unlink(f.path, () => undefined);
  }
}

// Captura errores de multer (tamaño, conteo, mime) y los traduce a HTTP 4xx claros.
function handleUploadErrors(req: Request, res: Response, next: NextFunction) {
  uploadAttachments.array("attachments", env.upload.maxFiles)(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: `Archivo demasiado grande. Máximo ${env.upload.maxFileSizeBytes / 1024 / 1024} MB por imagen.`,
        });
      }
      if (err.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({
          error: `Máximo ${env.upload.maxFiles} archivos por ticket.`,
        });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    // Fase R: validación del tipo REAL por bytes. Se ignora el MIME declarado:
    // se guarda el detectado y la extensión del archivo se corrige.
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    for (const f of files) {
      let detected: ReturnType<typeof detectImageType> = null;
      try {
        detected = detectImageType(readHead(f.path));
      } catch {
        detected = null;
      }
      if (detected === "image/heic") {
        cleanupFiles(files);
        return res.status(415).json({ error: HEIC_MESSAGE });
      }
      if (!detected) {
        cleanupFiles(files);
        return res.status(415).json({
          error: `"${f.originalname}" no es una imagen JPG, PNG o WebP válida.`,
        });
      }
      const ext = EXT_BY_MIME[detected];
      if (path.extname(f.path).toLowerCase() !== ext) {
        const renamed = f.path.slice(0, f.path.length - path.extname(f.path).length) + ext;
        fs.renameSync(f.path, renamed);
        f.path = renamed;
        f.filename = path.basename(renamed);
      }
      f.mimetype = detected;
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// POST /tickets -> Crear ticket (multipart/form-data)
// Campos: serviceId, detail, attachments[] (0..5 imágenes JPG/PNG hasta 5MB c/u)
// ---------------------------------------------------------------------------
router.post(
  "/",
  verifyJwt,
  handleUploadErrors,
  async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      cleanupFiles(files);
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
    }
    const { serviceId, detail, location, priority } = parsed.data;

    // Sprint 2 (rev): el flujo nuevo usa `responsibleArea`. El `levelAssigned`
    // sobrevive como columna NOT NULL del modelo legacy. Si el servicio trae
    // `routingRule`, calculamos el nivel como antes; si no, hacemos fallback
    // a `service.levelEntry` o, como último recurso, a `N1`. Esto evita que
    // un servicio nuevo creado sin regla legacy bloquee la creación.
    let level: Level;
    let serviceName: string;
    let responsibleArea: ResponsibleArea = "TECHNICIANS";
    try {
      const userToken = (req.headers.authorization ?? "").slice("Bearer ".length).trim();
      const service = await fetchService(serviceId, userToken);
      if (!service.isActive) {
        cleanupFiles(files);
        return res.status(400).json({ error: "El servicio seleccionado está deshabilitado" });
      }
      if (service.routingRule) {
        level = resolveLevel(service.routingRule, priority ?? null, serviceId);
      } else {
        const fallback = (service.levelEntry ?? "N1") as Level;
        console.warn(
          `[tickets] servicio ${serviceId} sin routingRule legacy; usando fallback ${fallback}`
        );
        level = fallback;
      }
      serviceName = service.name;
      responsibleArea = (service.responsibleArea ?? "TECHNICIANS") as ResponsibleArea;
    } catch (err) {
      cleanupFiles(files);
      if (err instanceof ServiceNotFoundError) {
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof NoRoutingRuleError) {
        // Defensivo: resolveLevel también puede lanzar esto si la regla es null.
        // Con el fallback de arriba no debería pasar, pero por compat lo manejamos.
        return res.status(400).json({ error: err.message });
      }
      if (err instanceof InvalidLevelError) {
        return res.status(400).json({ error: err.message });
      }
      console.error("Error consultando catalog-service:", err);
      return res.status(502).json({ error: "No se pudo validar el servicio en el catálogo" });
    }

    // Sprint 3+: subir cada imagen al storage configurado ANTES de la
    // transacción del ticket. Si el storage falla, se limpian los adjuntos
    // ya subidos (best-effort) y se cancela la creación del ticket.
    const storage = getStorageAdapter();
    let uploaded: StoredImage[];
    try {
      uploaded = await Promise.all(files.map((f) => storage.upload(f)));
    } catch (err) {
      cleanupFiles(files);
      console.error("[tickets] error al subir imágenes:", err);
      return res
        .status(502)
        .json({ error: "No se pudieron subir las imágenes al almacenamiento" });
    }

    try {
      const number = await generateTicketNumber();
      // HU-09: la creación del ticket y el evento CREATED se hacen en una
      // sola transacción para garantizar trazabilidad atómica.
      const ticket = await prisma.$transaction(async (tx) => {
        const created = await tx.ticket.create({
          data: {
            number,
            userId: req.user!.userId,
            userName: req.user!.name,
            userEmail: req.user!.email,
            serviceId,
            serviceName,
            detail,
            location: location || null,
            levelAssigned: level,
            responsibleArea,
            assignmentStatus: "available",
            ...(priority !== undefined ? { priority } : {}),
            attachments: {
              create: uploaded.map((u, i) => ({
                imageUrl: u.imageUrl,
                filePath: u.filePath ?? null,
                storageProvider: u.storageProvider,
                fileSize: files[i].size,
                mimeType: files[i].mimetype,
              })),
            },
          },
          include: { attachments: true },
        });
        await recordTicketEvent(tx, {
          ticketId: created.id,
          action: "CREATED",
          title: "Ticket creado y disponible",
          newLevel: created.levelAssigned,
          newStatus: created.status,
          newArea: created.responsibleArea,
          performedBy: req.user!.userId,
          performedByName: req.user!.name,
        });
        return created;
      });

      // Sprint 4+ · Push notification a los técnicos elegibles del área.
      // Fire-and-forget: nunca bloquea la respuesta al solicitante ni deshace
      // la creación del ticket si Firebase falla.
      void notifyTechniciansNewTicket({
        userToken: (req.headers.authorization ?? "").slice("Bearer ".length).trim(),
        ticketId: ticket.id,
        ticketNumber: ticket.number,
        serviceName: ticket.serviceName ?? "Servicio",
        area: ticket.responsibleArea,
        priority: ticket.priority,
      });

      return res.status(201).json({ ticket });
    } catch (err) {
      cleanupFiles(files);
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        return res.status(400).json({ error: "No se pudo crear el ticket", code: err.code });
      }
      throw err;
    }
  }
);

// Sprint 4+ · Helper: identifica técnicos elegibles para un ticket recién
// creado (o escalado a una nueva área) y dispara push a sus dispositivos.
async function notifyTechniciansNewTicket(ctx: {
  userToken: string;
  ticketId: string;
  ticketNumber: string;
  serviceName: string;
  area: ResponsibleArea;
  priority: string;
}): Promise<void> {
  try {
    const technicians = await fetchTechnicians(ctx.userToken);
    const eligibleIds = technicians
      .filter((t) => t.isActive && areasForRole(t.role).includes(ctx.area))
      .map((t) => t.id);
    if (eligibleIds.length === 0) return;

    dispatchPushInBackground(eligibleIds, {
      title: `Nuevo ticket ${ctx.ticketNumber}`,
      body: `${ctx.serviceName} · prioridad ${ctx.priority}`,
      data: {
        ticketId: ctx.ticketId,
        eventType: "TICKET_CREATED",
        area: String(ctx.area),
      },
      deepLink: `/tickets/${ctx.ticketId}`,
    });
  } catch (err) {
    console.error("[tickets] push new-ticket falló (best-effort):", err);
  }
}

// ---------------------------------------------------------------------------
// Fase R — Endpoints HEREDADOS del modelo por NIVEL (N1–N4): retirados.
// Autorizaban por nivel y no por área, y PATCH /:id/status permitía poner un
// ticket en resuelto/cerrado saltándose la validación del usuario. Ningún
// cliente activo (web, APK) los usa: el flujo vigente es /available, /accept,
// /:id/contributions, /:id/escalate, /:id/resolve, /:id/user-accept|reject.
// ---------------------------------------------------------------------------
function gone(replacement: string) {
  return (_req: Request, res: Response) =>
    res.status(410).json({
      error: "Endpoint retirado",
      detail: `Este endpoint del modelo por niveles ya no existe. Usa ${replacement}.`,
    });
}
router.get("/", gone("GET /api/tickets/my (solicitante) o GET /api/tickets/available y /my-assigned (personal)"));
router.put("/escalate", gone("PUT /api/tickets/:id/escalate con targetArea"));
router.get("/level", gone("GET /api/tickets/available y GET /api/tickets/my-assigned"));
router.patch("/:id/status", gone("el flujo POST /:id/resolve → /:id/user-accept | /:id/user-reject"));

// ---------------------------------------------------------------------------
// HU-09 - GET /tickets/history/:id
// Devuelve la bitácora completa del ticket en orden cronológico ascendente.
// Cada evento incluye una descripción computada legible.
//
// Permisos (Fase R · regla única ticketAccess):
//   - admin: cualquier ticket.
//   - technician / dtic: tickets de SU área o asignados a él (con eventos internos).
//   - propietario: su ticket, solo eventos públicos.
//   - técnico de la OTRA área u otro usuario: 403.
// ---------------------------------------------------------------------------
router.get("/history/:id", verifyJwt, async (req: Request, res: Response) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    // Sprint I · P3 — attachments incluidos para que el modal de historial
    // muestre las imágenes al solicitante, técnico y admin autorizados.
    include: { attachments: true },
  });
  if (!ticket) {
    return res.status(404).json({ error: "Ticket no encontrado" });
  }

  const access = ticketAccess(req.user!, ticket);
  if (!access.allowed) {
    return res
      .status(403)
      .json({ error: "No tienes permisos para ver el historial de este ticket" });
  }

  // El solicitante nunca debe ver eventos `internal` (defensa en backend,
  // independiente del filtro adicional que aplique el frontend).
  const isRequesterOnly = access.as === "requester";

  const events = await prisma.ticketEvent.findMany({
    where: {
      ticketId: req.params.id,
      ...(isRequesterOnly ? { visibility: "public" } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  return res.json({
    ticketId: ticket.id,
    ticket: {
      id: ticket.id,
      number: ticket.number,
      serviceId: ticket.serviceId,
      serviceName: ticket.serviceName,
      userName: ticket.userName,
      // Fase T: descripción del problema y ubicación, para revisar la solución.
      detail: ticket.detail,
      location: ticket.location,
      responsibleArea: ticket.responsibleArea,
      status: ticket.status,
      priority: ticket.priority,
      assignmentStatus: ticket.assignmentStatus,
      assignedTechnicianName: ticket.assignedTechnicianName,
      acceptedAt: ticket.acceptedAt,
      resolvedAt: ticket.resolvedAt,
      resolvedByName: ticket.resolvedByName,
      resolutionSummary: ticket.resolutionSummary,
      levelAssigned: ticket.levelAssigned,
      createdAt: ticket.createdAt,
      // Sprint I · P3 + Sprint L · P2 — attachments serializados con URLs
      // consumibles por el navegador (endpoint autenticado o Cloudinary
      // público). Defensivo si mock de tests trae attachments undefined.
      attachments: (ticket.attachments ?? []).map((a) => serializeAttachment(ticket.id, a)),
    },
    history: events.map((e) => ({
      id: e.id,
      actionType: e.action,
      description: describeEvent(e),
      previousStatus: e.previousStatus,
      newStatus: e.newStatus,
      previousLevel: e.previousLevel,
      newLevel: e.newLevel,
      previousArea: e.previousArea,
      newArea: e.newArea,
      reason: e.reason,
      workDone: e.workDone,
      eventDescription: e.description,
      visibility: e.visibility,
      performedBy: { id: e.performedBy, name: e.performedByName },
      createdAt: e.createdAt,
    })),
  });
});

// ---------------------------------------------------------------------------
// Sprint L · P2 — Descargar el binario de un attachment protegido por JWT.
//
// GET /tickets/:id/attachments/:attachmentId
//
// Reglas:
//   · JWT válido (verifyJwt aplicado al router).
//   · El attachment debe existir Y pertenecer al ticket indicado.
//   · Autorización: mismo criterio que /tickets/:id (dueño, técnico, admin).
//   · Sirve con Content-Type real de la imagen (no text/html, no JSON).
//   · Streaming vía res.sendFile — no bloquea event loop para imágenes grandes.
//   · Cloudinary attachments no llegan aquí: sus imageUrl absolutas son
//     públicas y el frontend las carga directamente sin pasar por este endpoint.
//
// Este endpoint SUSTITUYE la ruta estática `/uploads/*` desde el punto de
// vista del navegador. `/uploads/*` sigue montada como fallback interno
// (el ticket-service la usa desde su propia red Docker), pero jamás se
// devuelve al frontend.
// ---------------------------------------------------------------------------
router.get(
  "/:id/attachments/:attachmentId",
  verifyJwt,
  async (req: Request, res: Response) => {
    const { id: ticketId, attachmentId } = req.params;
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, userId: true, responsibleArea: true, assignedTechnicianId: true },
    });
    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

    // Fase R: misma regla que el historial (área responsable / asignado / propietario).
    if (!ticketAccess(req.user!, ticket).allowed) {
      return res.status(403).json({ error: "No tienes permisos para ver este adjunto" });
    }

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: {
        id: true,
        ticketId: true,
        filePath: true,
        imageUrl: true,
        storageProvider: true,
        mimeType: true,
      },
    });
    if (!attachment) return res.status(404).json({ error: "Adjunto no encontrado" });
    // Fase T: los GUID de SQL Server son insensibles a mayúsculas; un enlace con
    // el id en mayúsculas (notificación, copia manual) no debe dar un falso 403.
    if (attachment.ticketId.toLowerCase() !== ticketId.toLowerCase()) {
      // No devolvemos 404 para no filtrar existencia; usamos 403.
      return res.status(403).json({ error: "El adjunto no pertenece al ticket" });
    }

    // Cloudinary: el imageUrl es una URL absoluta y pública. En teoría el
    // frontend nunca debería llamarnos para un attachment cloudinary, pero
    // si sucede redirigimos al CDN para no filtrar bytes por aquí.
    if (attachment.storageProvider === "cloudinary" && attachment.imageUrl) {
      return res.redirect(302, attachment.imageUrl);
    }

    // Local: reconstruir la ruta absoluta con seguridad — el filePath persistido
    // es solo el basename (por diskStorage en middleware/upload.ts), pero por
    // defensa filtramos "../" y solo aceptamos el basename limpio.
    const raw = attachment.filePath ?? attachment.imageUrl?.replace(/^\/uploads\//, "") ?? "";
    const safeName = path.basename(raw);
    if (!safeName || safeName.startsWith(".") || safeName.includes("..")) {
      return res.status(404).json({ error: "Adjunto no disponible" });
    }
    const absolute = path.resolve(env.uploadDir, safeName);
    if (!absolute.startsWith(path.resolve(env.uploadDir))) {
      return res.status(400).json({ error: "Ruta inválida" });
    }

    // Verificar existencia física para poder devolver 404 legible en lugar
    // de un error opaco desde sendFile.
    try {
      await fsPromises.access(absolute, fs.constants.R_OK);
    } catch {
      return res.status(404).json({ error: "El archivo del adjunto ya no existe" });
    }

    const contentType =
      attachment.mimeType && /^image\//i.test(attachment.mimeType)
        ? attachment.mimeType
        : "application/octet-stream";
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(contentType);
    return res.sendFile(absolute);
  }
);

// ---------------------------------------------------------------------------
// GET /tickets/:id -> Detalle. Solo el dueño o un admin/tech puede verlo.
// ---------------------------------------------------------------------------
router.get("/:id", verifyJwt, async (req: Request, res: Response) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: { attachments: true },
  });
  if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

  // Fase R: misma regla que el historial (área responsable / asignado / propietario).
  if (!ticketAccess(req.user!, ticket).allowed) {
    return res.status(403).json({ error: "No tienes permisos para ver este ticket" });
  }
  res.json({
    ticket: {
      ...ticket,
      // Sprint L · P2 — attachments serializan `imageUrl` como endpoint
      // autenticado (excepto Cloudinary que ya es público).
      attachments: (ticket.attachments ?? []).map((a) => serializeAttachment(ticket.id, a)),
    },
  });
});

export default router;
