// Sprint 4+ — Registro y baja de tokens FCM para push notifications.
//
//   POST /notifications/register    { token, platform, deviceId?, appVersion? }
//   POST /notifications/unregister  { token }
//   GET  /notifications/devices     (lista tokens activos del usuario autenticado)
//
// Todos protegidos por verifyJwt. El token FCM SIEMPRE se asocia al `userId`
// del JWT — nunca a otro usuario. Un dispositivo puede rotar su token con el
// tiempo; la reasociación es idempotente por `token` único.

import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { verifyJwt } from "../middleware/verifyJwt";

const router = Router();

const registerSchema = z.object({
  token: z.string().trim().min(20, "token FCM demasiado corto").max(4096),
  platform: z.enum(["android", "ios", "web"]),
  deviceId: z.string().trim().max(200).optional(),
  appVersion: z.string().trim().max(50).optional(),
});

router.post("/register", verifyJwt, async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  const { token, platform, deviceId, appVersion } = parsed.data;

  try {
    // Upsert por `token` único. Si otro user registró el mismo token
    // (rotación de dispositivo), lo re-vincula al user actual.
    const row = await prisma.deviceToken.upsert({
      where: { token },
      update: {
        userId: req.user!.userId,
        platform,
        deviceId: deviceId ?? null,
        appVersion: appVersion ?? null,
        isActive: true,
        lastSeenAt: new Date(),
      },
      create: {
        userId: req.user!.userId,
        token,
        platform,
        deviceId: deviceId ?? null,
        appVersion: appVersion ?? null,
      },
    });
    return res.status(201).json({
      device: {
        id: row.id,
        platform: row.platform,
        isActive: row.isActive,
        createdAt: row.createdAt,
      },
    });
  } catch (err) {
    console.error("[notifications/register] error:", err);
    return res.status(500).json({ error: "No se pudo registrar el token" });
  }
});

const unregisterSchema = z.object({
  token: z.string().trim().min(20).max(4096),
});

router.post("/unregister", verifyJwt, async (req: Request, res: Response) => {
  const parsed = unregisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Datos inválidos", details: parsed.error.issues });
  }
  try {
    // Solo puedes desactivar tus propios tokens.
    const result = await prisma.deviceToken.updateMany({
      where: {
        token: parsed.data.token,
        userId: req.user!.userId,
      },
      data: { isActive: false },
    });
    return res.json({ deactivated: result.count });
  } catch (err) {
    console.error("[notifications/unregister] error:", err);
    return res.status(500).json({ error: "No se pudo desactivar el token" });
  }
});

router.get("/devices", verifyJwt, async (req: Request, res: Response) => {
  const devices = await prisma.deviceToken.findMany({
    where: { userId: req.user!.userId },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      platform: true,
      deviceId: true,
      appVersion: true,
      isActive: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });
  return res.json({ devices });
});

// Explicit typing to keep TS strict happy when this file is imported into app.ts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ = Prisma.DeviceTokenWhereInput;

export default router;
