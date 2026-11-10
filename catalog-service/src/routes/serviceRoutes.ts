import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { Prisma } from "@prisma/client";
// Sprint B: enums Level / ResponsibleArea en src/domain/enums.ts.
import { Level, ResponsibleArea } from "../domain/enums";
import { verifyJwt, requireRole } from "../middleware/verifyJwt";

const router = Router();

const levelEnum = z.nativeEnum(Level);

// HU-06: la regla de enrutamiento es configurable por servicio.
// Si no se especifican los campos de prioridad, se usa solo `levelEntry`.
const routingRuleSchema = z.object({
  priorityHigh: levelEnum.nullable().optional(),
  priorityCritical: levelEnum.nullable().optional(),
  isCritical: z.boolean().optional(),
});

const areaEnum = z.nativeEnum(ResponsibleArea);

// Sprint 2 (rev): la UI de Catálogo ya no expone `levelEntry` (lógica legacy
// N1-N4). El admin configura nombre + descripción + responsibleArea. El campo
// `levelEntry` se mantiene NOT NULL en BD por compat con el seed y los tickets
// ya existentes; si la petición no lo trae, defaulteamos a `N1` server-side.
const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  levelEntry: levelEnum.optional(),
  responsibleArea: areaEnum.optional(),
  routingRule: routingRuleSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  levelEntry: levelEnum.optional(),
  responsibleArea: areaEnum.optional(),
  isActive: z.boolean().optional(),
  routingRule: routingRuleSchema.optional(),
});

// ---------------------------------------------------------------------------
// GET /services -> Lista pública (combobox del formulario de tickets).
// Solo devuelve servicios activos a no ser que ?includeInactive=true (admin).
// ---------------------------------------------------------------------------
router.get("/", async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive === "true";
  const where: Prisma.ServiceWhereInput = includeInactive ? {} : { isActive: true };
  const services = await prisma.service.findMany({
    where,
    orderBy: { name: "asc" },
    include: { routingRule: true },
  });
  res.json({ services });
});

// ---------------------------------------------------------------------------
// GET /services/:id -> Detalle. Usado por ticket-service para obtener la regla
// de enrutamiento completa del servicio.
// ---------------------------------------------------------------------------
router.get("/:id", async (req: Request, res: Response) => {
  const service = await prisma.service.findUnique({
    where: { id: req.params.id },
    include: { routingRule: true },
  });
  if (!service) return res.status(404).json({ error: "Servicio no encontrado" });
  res.json({ service });
});

// ---------------------------------------------------------------------------
// POST /services -> Solo admin
// ---------------------------------------------------------------------------
router.post("/", verifyJwt, requireRole("admin"), async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { routingRule, levelEntry, ...rest } = parsed.data;
  // Sprint 2 (rev): si la UI nueva no manda `levelEntry`, defaulteamos a N1
  // para mantener la columna NOT NULL del modelo y la regla de routing legacy.
  const effectiveLevel = levelEntry ?? Level.N1;
  try {
    const service = await prisma.service.create({
      data: {
        ...rest,
        levelEntry: effectiveLevel,
        routingRule: {
          create: {
            levelEntry: effectiveLevel,
            priorityHigh: routingRule?.priorityHigh ?? null,
            priorityCritical: routingRule?.priorityCritical ?? null,
            isCritical: routingRule?.isCritical ?? false,
          },
        },
      },
      include: { routingRule: true },
    });
    res.status(201).json({ service });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe un servicio con ese nombre" });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// PATCH /services/:id -> Solo admin
// ---------------------------------------------------------------------------
router.patch("/:id", verifyJwt, requireRole("admin"), async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { routingRule, ...serviceFields } = parsed.data;
  try {
    const data: Prisma.ServiceUpdateInput = { ...serviceFields };
    const needRuleUpdate = serviceFields.levelEntry !== undefined || routingRule !== undefined;
    if (needRuleUpdate) {
      data.routingRule = {
        update: {
          ...(serviceFields.levelEntry !== undefined ? { levelEntry: serviceFields.levelEntry } : {}),
          ...(routingRule?.priorityHigh !== undefined ? { priorityHigh: routingRule.priorityHigh } : {}),
          ...(routingRule?.priorityCritical !== undefined ? { priorityCritical: routingRule.priorityCritical } : {}),
          ...(routingRule?.isCritical !== undefined ? { isCritical: routingRule.isCritical } : {}),
        },
      };
    }
    const service = await prisma.service.update({
      where: { id: req.params.id },
      data,
      include: { routingRule: true },
    });
    res.json({ service });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "Servicio no encontrado" });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// DELETE /services/:id -> Soft delete (is_active = false). Solo admin.
// ---------------------------------------------------------------------------
router.delete("/:id", verifyJwt, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const service = await prisma.service.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ service });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "Servicio no encontrado" });
    }
    throw err;
  }
});

export default router;
