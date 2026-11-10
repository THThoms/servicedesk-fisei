// HU-10 - Endpoints de la base de conocimiento institucional.
//
//   GET  /knowledge/search?q=<term>[&serviceId=<uuid>][&page=N][&limit=N]
//   GET  /knowledge/:id        -> Detalle. Usado por ticket-service para validar
//                                 que `knowledgeArticleId` existe al resolver.
//   POST /knowledge            -> Crear artículo (admin/tech_*). Permite que el
//                                 técnico registre una solución nueva al cerrar
//                                 un ticket (Sprint 2 rev).
//
import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { verifyJwt, requireRole } from "../middleware/verifyJwt";

const router = Router();

// Fase R: la base de conocimiento es institucional y compartida por todo el
// personal (admin, technician, dtic); su edición sigue siendo solo de admin.
const STAFF_ROLES = ["admin", "technician", "dtic"] as const;

// Sprint 3+: la búsqueda por texto es OPCIONAL — se puede filtrar solo por
// categoría (serviceId) o listar todo activo sin filtros. Si se envía `q`,
// debe tener al menos 2 caracteres para evitar recorridos triviales.
const searchQuerySchema = z.object({
  q: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length === 0 || s.length >= 2, {
      message: "La búsqueda por texto debe tener al menos 2 caracteres",
    })
    .optional(),
  serviceId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

router.get(
  "/search",
  verifyJwt,
  requireRole(...STAFF_ROLES),
  async (req: Request, res: Response) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Búsqueda inválida", details: parsed.error.issues });
    }
    const { q, serviceId, page, limit } = parsed.data;
    const effectivePage = page ?? 1;
    const effectiveLimit = limit ?? 20;
    const skip = (effectivePage - 1) * effectiveLimit;

    // Construcción del filtro. Todos los combinables:
    //  - q + serviceId  → texto dentro del servicio
    //  - q sin serviceId → texto en todas las categorías
    //  - serviceId sin q → todos los artículos del servicio
    //  - sin ambos       → todos los artículos activos
    //
    // Sprint B (adaptación MSSQL):
    //  · Ya no existe `keywords String[]` — se consulta `KnowledgeKeyword` 1:N.
    //  · Se elimina `mode: "insensitive"` (no soportado por prisma-sqlserver);
    //    la case-insensitivity depende de la colación del servidor
    //    (SQL_Latin1_General_CP1_CI_AS en el lab; PG con `citext` opcional).
    const where: Prisma.KnowledgeArticleWhereInput = { isActive: true };
    const AND: Prisma.KnowledgeArticleWhereInput[] = [];

    const hasText = typeof q === "string" && q.length > 0;
    if (hasText) {
      const lower = q.toLowerCase();
      AND.push({
        OR: [
          { title: { contains: q } },
          { problemDescription: { contains: q } },
          { solution: { contains: q } },
          { keywords: { some: { keyword: lower } } },
          { service: { name: { contains: q } } },
        ],
      });
    }
    if (serviceId) {
      AND.push({ serviceId });
    }
    if (AND.length > 0) {
      where.AND = AND;
    }

    const [results, total] = await Promise.all([
      prisma.knowledgeArticle.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          service: { select: { id: true, name: true } },
          keywords: { select: { keyword: true } },
        },
        skip,
        take: effectiveLimit,
      }),
      prisma.knowledgeArticle.count({ where }),
    ]);

    return res.json({
      query: q ?? "",
      total,
      page: effectivePage,
      limit: effectiveLimit,
      results: results.map((a) => ({
        id: a.id,
        title: a.title,
        problemDescription: a.problemDescription,
        solution: a.solution,
        keywords: a.keywords.map((k) => k.keyword),
        service: a.service ? { id: a.service.id, name: a.service.name } : null,
        updatedAt: a.updatedAt,
        createdAt: a.createdAt,
      })),
    });
  }
);

// ---------------------------------------------------------------------------
// GET /knowledge/:id  -> Detalle de un artículo.
// Sprint 2 (rev): ticket-service lo consume para verificar que la solución que
// referencia un ticket resuelto existe realmente en catalog_db.
// ---------------------------------------------------------------------------
const uuidParam = z.string().uuid({ message: "id debe ser un UUID válido" });

router.get(
  "/:id",
  verifyJwt,
  requireRole(...STAFF_ROLES),
  async (req: Request, res: Response) => {
    const parsedId = uuidParam.safeParse(req.params.id);
    if (!parsedId.success) {
      return res.status(400).json({ error: "id inválido" });
    }
    const article = await prisma.knowledgeArticle.findUnique({
      where: { id: parsedId.data },
      include: {
        service: { select: { id: true, name: true } },
        keywords: { select: { keyword: true } },
      },
    });
    if (!article || !article.isActive) {
      return res.status(404).json({ error: "Artículo no encontrado" });
    }
    return res.json({
      article: {
        id: article.id,
        title: article.title,
        problemDescription: article.problemDescription,
        solution: article.solution,
        keywords: article.keywords.map((k) => k.keyword),
        service: article.service ? { id: article.service.id, name: article.service.name } : null,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      },
    });
  }
);

// ---------------------------------------------------------------------------
// POST /knowledge  -> Crear artículo de la base de conocimiento.
// Sprint 2 (rev): habilitado para admin y técnicos. Lo usa el flujo de
// resolución de ticket cuando el técnico elige "Crear nueva solución".
//   body: { title, problemDescription, solution, keywords[>=1], serviceId? }
// ---------------------------------------------------------------------------
const createSchema = z.object({
  title: z.string().trim().min(3, "El título debe tener al menos 3 caracteres").max(200),
  problemDescription: z
    .string()
    .trim()
    .min(10, "La descripción del problema debe tener al menos 10 caracteres"),
  solution: z.string().trim().min(10, "La solución debe tener al menos 10 caracteres"),
  keywords: z
    .array(z.string().trim().min(1))
    .min(1, "Debes proporcionar al menos una palabra clave")
    .max(20),
  serviceId: z.string().uuid().optional(),
});

router.post(
  "/",
  verifyJwt,
  requireRole(...STAFF_ROLES),
  async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Datos inválidos", details: parsed.error.issues });
    }
    const { title, problemDescription, solution, keywords, serviceId } = parsed.data;

    // Si viene serviceId, validar que exista (FK física dentro de catalog_db).
    if (serviceId) {
      const service = await prisma.service.findUnique({ where: { id: serviceId } });
      if (!service) {
        return res.status(400).json({ error: "El servicio referenciado no existe" });
      }
    }

    // Normalizar keywords a lowercase + deduplicar (misma semántica que
    // hacía el schema PG con `String[]`).
    const normalized = Array.from(
      new Set(keywords.map((k) => k.toLowerCase()))
    );

    const article = await prisma.knowledgeArticle.create({
      data: {
        title,
        problemDescription,
        solution,
        serviceId: serviceId ?? null,
        createdByUserId: req.user!.userId,
        keywords: {
          create: normalized.map((k) => ({ keyword: k })),
        },
      },
      include: {
        service: { select: { id: true, name: true } },
        keywords: { select: { keyword: true } },
      },
    });

    return res.status(201).json({
      article: {
        id: article.id,
        title: article.title,
        problemDescription: article.problemDescription,
        solution: article.solution,
        keywords: article.keywords.map((k) => k.keyword),
        service: article.service ? { id: article.service.id, name: article.service.name } : null,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      },
    });
  }
);

// ---------------------------------------------------------------------------
// Sprint 3+ — Administración de la Base de Conocimiento (solo admin).
//
//   GET    /knowledge/admin/list  -> Listado paginado con includeInactive
//                                    para el panel del administrador.
//   PUT    /knowledge/:id         -> Actualizar campos del artículo.
//   DELETE /knowledge/:id         -> Soft delete (isActive=false). Preserva
//                                    referencias históricas de tickets ya
//                                    resueltos con esta solución.
//
// Los técnicos pueden crear artículos al resolver un ticket (POST arriba),
// pero solo el admin edita/elimina para no romper contenido curado.
// ---------------------------------------------------------------------------
const adminListSchema = z.object({
  serviceId: z.string().uuid().optional(),
  includeInactive: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get(
  "/admin/list",
  verifyJwt,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const parsed = adminListSchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Filtros inválidos", details: parsed.error.issues });
    }
    const { serviceId, includeInactive, page, limit } = parsed.data;
    const effectivePage = page ?? 1;
    const effectiveLimit = limit ?? 20;

    const where: Prisma.KnowledgeArticleWhereInput = {};
    if (!includeInactive) where.isActive = true;
    if (serviceId) where.serviceId = serviceId;

    const [results, total] = await Promise.all([
      prisma.knowledgeArticle.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: {
          service: { select: { id: true, name: true } },
          keywords: { select: { keyword: true } },
        },
        skip: (effectivePage - 1) * effectiveLimit,
        take: effectiveLimit,
      }),
      prisma.knowledgeArticle.count({ where }),
    ]);

    return res.json({
      total,
      page: effectivePage,
      limit: effectiveLimit,
      results: results.map((a) => ({
        id: a.id,
        title: a.title,
        problemDescription: a.problemDescription,
        solution: a.solution,
        keywords: a.keywords.map((k) => k.keyword),
        service: a.service ? { id: a.service.id, name: a.service.name } : null,
        isActive: a.isActive,
        updatedAt: a.updatedAt,
        createdAt: a.createdAt,
      })),
    });
  }
);

const updateSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  problemDescription: z.string().trim().min(10).optional(),
  solution: z.string().trim().min(10).optional(),
  keywords: z.array(z.string().trim().min(1)).min(1).max(20).optional(),
  serviceId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

router.put(
  "/:id",
  verifyJwt,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const idParsed = uuidParam.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: "id inválido" });
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Datos inválidos", details: parsed.error.issues });
    }
    const data = parsed.data;

    if (data.serviceId) {
      const service = await prisma.service.findUnique({ where: { id: data.serviceId } });
      if (!service) {
        return res.status(400).json({ error: "El servicio referenciado no existe" });
      }
    }

    try {
      // Sprint B: si vienen keywords, reemplazamos el set completo dentro de
      // una transacción — deleteMany + create es la vía portable a MSSQL
      // (evita depender de operadores tipo `set` sobre `String[]` PG-only).
      const article = await prisma.$transaction(async (tx) => {
        if (data.keywords !== undefined) {
          const normalized = Array.from(
            new Set(data.keywords.map((k) => k.toLowerCase()))
          );
          await tx.knowledgeKeyword.deleteMany({ where: { articleId: idParsed.data } });
          if (normalized.length > 0) {
            await tx.knowledgeKeyword.createMany({
              data: normalized.map((k) => ({ articleId: idParsed.data, keyword: k })),
            });
          }
        }
        return tx.knowledgeArticle.update({
          where: { id: idParsed.data },
          data: {
            ...(data.title !== undefined ? { title: data.title } : {}),
            ...(data.problemDescription !== undefined
              ? { problemDescription: data.problemDescription }
              : {}),
            ...(data.solution !== undefined ? { solution: data.solution } : {}),
            ...(data.serviceId !== undefined ? { serviceId: data.serviceId } : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          },
          include: {
            service: { select: { id: true, name: true } },
            keywords: { select: { keyword: true } },
          },
        });
      });
      return res.json({
        article: {
          id: article.id,
          title: article.title,
          problemDescription: article.problemDescription,
          solution: article.solution,
          keywords: article.keywords.map((k) => k.keyword),
          service: article.service ? { id: article.service.id, name: article.service.name } : null,
          isActive: article.isActive,
          createdAt: article.createdAt,
          updatedAt: article.updatedAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        return res.status(404).json({ error: "Artículo no encontrado" });
      }
      throw err;
    }
  }
);

// Soft delete: isActive=false. Se mantiene el registro para que los tickets
// ya resueltos con esta solución conserven la referencia (knowledgeArticleId).
router.delete(
  "/:id",
  verifyJwt,
  requireRole("admin"),
  async (req: Request, res: Response) => {
    const idParsed = uuidParam.safeParse(req.params.id);
    if (!idParsed.success) {
      return res.status(400).json({ error: "id inválido" });
    }
    try {
      const article = await prisma.knowledgeArticle.update({
        where: { id: idParsed.data },
        data: { isActive: false },
        select: { id: true, isActive: true },
      });
      return res.json({ article, message: "Artículo desactivado" });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        return res.status(404).json({ error: "Artículo no encontrado" });
      }
      throw err;
    }
  }
);

export default router;
