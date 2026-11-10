// Sprint 3+ — Catálogo de ubicaciones (FISEI).
//
//   GET    /locations            -> Lista pública (combobox NuevoTicket).
//                                   `?includeInactive=true` = admin ve todas.
//   POST   /locations            -> Admin crea una ubicación.
//   PUT    /locations/:id        -> Admin renombra / activa / desactiva.
//   DELETE /locations/:id        -> Admin soft delete (isActive=false).
//
// La UI de creación de ticket consume el GET público; nunca hardcodea el
// listado en el frontend.

import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { verifyJwt, requireRole } from "../middleware/verifyJwt";

const router = Router();

const uuidParam = z.string().uuid({ message: "id debe ser un UUID válido" });

// ---------------------------------------------------------------------------
// GET /locations -> combobox del NuevoTicket + panel admin.
// ---------------------------------------------------------------------------
router.get("/", async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive === "true";
  const where: Prisma.LocationWhereInput = includeInactive ? {} : { isActive: true };
  const locations = await prisma.location.findMany({
    where,
    orderBy: { name: "asc" },
  });
  res.json({ locations });
});

// ---------------------------------------------------------------------------
// POST /locations -> solo admin.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(200),
});

router.post("/", verifyJwt, requireRole("admin"), async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  try {
    const location = await prisma.location.create({ data: { name: parsed.data.name } });
    return res.status(201).json({ location });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe una ubicación con ese nombre" });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// PUT /locations/:id -> renombra o activa/desactiva. Solo admin.
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  isActive: z.boolean().optional(),
});

router.put("/:id", verifyJwt, requireRole("admin"), async (req: Request, res: Response) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) return res.status(400).json({ error: "id inválido" });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { name, isActive } = parsed.data;
  if (name === undefined && isActive === undefined) {
    return res.status(400).json({ error: "No hay cambios que aplicar" });
  }
  try {
    const location = await prisma.location.update({
      where: { id: idParsed.data },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });
    return res.json({ location });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "Ubicación no encontrada" });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ error: "Ya existe otra ubicación con ese nombre" });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// DELETE /locations/:id -> soft delete. Solo admin.
// ---------------------------------------------------------------------------
router.delete("/:id", verifyJwt, requireRole("admin"), async (req: Request, res: Response) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) return res.status(400).json({ error: "id inválido" });
  try {
    const location = await prisma.location.update({
      where: { id: idParsed.data },
      data: { isActive: false },
    });
    return res.json({ location });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "Ubicación no encontrada" });
    }
    throw err;
  }
});

export default router;
