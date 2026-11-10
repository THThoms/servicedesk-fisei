// =============================================================================
// /routing — Fase R: RETIRADO (410 Gone).
//
// POST /routing/assign y POST /routing/preview pertenecían al modelo por NIVEL
// (N1–N4): recalculaban `levelAssigned` y autorizaban a cualquier personal sin
// considerar el área. Ningún cliente activo (web ni APK) los usa.
//
// El enrutamiento vigente es por ÁREA y ocurre al CREAR el ticket
// (POST /tickets → routingService + regla del servicio en catalog-service).
// La versión anterior de este archivo está en el historial de git.
// =============================================================================
import { Router, Request, Response } from "express";

const router = Router();

const gone = (_req: Request, res: Response) =>
  res.status(410).json({
    error: "Endpoint retirado",
    detail:
      "El enrutamiento por niveles ya no existe. El área responsable se asigna al crear el ticket (POST /api/tickets).",
  });

router.post("/assign", gone);
router.post("/preview", gone);

export default router;
