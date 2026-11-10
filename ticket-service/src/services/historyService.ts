// HU-09 - Servicio reutilizable para registrar eventos en la bitácora del ticket.
// Centraliza la inserción en `ticket_events` para que cualquier endpoint que
// muta un ticket (crear, escalar, cambiar estado, asignar, comentar, cerrar)
// pueda invocarlo de forma consistente sin duplicar lógica.

import { Prisma } from "@prisma/client";
// Sprint B: enums de dominio movidos a src/domain/enums.ts.
import {
  EventAction,
  EventVisibility,
  Level,
  ResponsibleArea,
  TicketStatus,
} from "../domain/enums";

export interface RecordEventInput {
  ticketId: string;
  action: EventAction;
  performedBy: string;
  performedByName: string;
  title?: string | null;
  previousLevel?: Level | null;
  newLevel?: Level | null;
  previousStatus?: TicketStatus | null;
  newStatus?: TicketStatus | null;
  // Sprint 2 (rev) - cambios de área/técnico para escalamiento y asignaciones.
  previousArea?: ResponsibleArea | null;
  newArea?: ResponsibleArea | null;
  previousTechnicianId?: string | null;
  newTechnicianId?: string | null;
  reason?: string | null;
  workDone?: string | null;
  description?: string | null;
  visibility?: EventVisibility;
}

// Tipo del cliente Prisma "extendido" — admite tanto el `prisma` global como
// el `tx` interno de prisma.$transaction(...).
type PrismaLike =
  | Prisma.TransactionClient
  | {
      ticketEvent: { create: (args: Prisma.TicketEventCreateArgs) => Promise<unknown> };
    };

/**
 * Persiste un evento de historial.
 * Diseñado para usarse tanto en transacciones como fuera de ellas: pasar `tx`
 * cuando se quiere atomicidad con otras operaciones (ej. update ticket + event).
 */
export async function recordTicketEvent(
  client: PrismaLike,
  input: RecordEventInput
): Promise<void> {
  await client.ticketEvent.create({
    data: {
      ticketId: input.ticketId,
      action: input.action,
      performedBy: input.performedBy,
      performedByName: input.performedByName,
      title: input.title ?? null,
      previousLevel: input.previousLevel ?? null,
      newLevel: input.newLevel ?? null,
      previousStatus: input.previousStatus ?? null,
      newStatus: input.newStatus ?? null,
      previousArea: input.previousArea ?? null,
      newArea: input.newArea ?? null,
      previousTechnicianId: input.previousTechnicianId ?? null,
      newTechnicianId: input.newTechnicianId ?? null,
      reason: input.reason ?? null,
      workDone: input.workDone ?? null,
      description: input.description ?? null,
      visibility: input.visibility ?? "public",
    },
  });
}

// ---------------------------------------------------------------------------
// Descripción legible de un evento. Vive en backend para que el frontend
// pueda pintar la timeline sin tener que reimplementar reglas.
// ---------------------------------------------------------------------------
const STATUS_LABEL: Record<TicketStatus, string> = {
  abierto: "Pendiente",
  en_proceso: "En Proceso",
  escalado: "Escalado",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
};

const AREA_LABEL: Record<ResponsibleArea, string> = {
  TECHNICIANS: "Técnicos",
  DTIC: "DTIC",
};

function areaLabel(area: ResponsibleArea | null | undefined): string {
  return area ? AREA_LABEL[area] : "responsable";
}

function performerLabel(name: string): string {
  return /^T[eé]cnico\s+Nivel\b/i.test(name) ? "Técnico" : name;
}

export function describeEvent(event: {
  action: EventAction;
  previousLevel: Level | null;
  newLevel: Level | null;
  previousStatus: TicketStatus | null;
  newStatus: TicketStatus | null;
  previousArea?: ResponsibleArea | null;
  newArea?: ResponsibleArea | null;
  reason: string | null;
  performedByName: string;
}): string {
  const performer = performerLabel(event.performedByName);
  switch (event.action) {
    case "CREATED":
      return `${performer} creó el ticket`;
    case "CATEGORIZED":
      return `Ticket categorizado para el área ${areaLabel(event.newArea)}`;
    case "AVAILABLE":
      return `Ticket disponible en la bandeja del área ${areaLabel(event.newArea)}`;
    case "ACCEPTED":
      return `${performer} aceptó el ticket`;
    case "ASSIGNED":
      return `${performer} asignó el ticket`;
    case "REASSIGNED":
      return `${performer} reasignó el ticket`;
    case "CONTRIBUTED":
      return `${performer} agregó una aportación al ticket`;
    case "ESCALATED":
      if (event.previousArea && event.newArea && event.previousArea !== event.newArea) {
        return `${performer} escaló el ticket de ${areaLabel(event.previousArea)} a ${areaLabel(event.newArea)}`;
      }
      return `${performer} escaló el ticket`;
    case "STATUS_CHANGED":
      return `${performer} cambió el estado de ${STATUS_LABEL[event.previousStatus ?? "abierto"]} a ${STATUS_LABEL[event.newStatus ?? "abierto"]}`;
    case "COMMENTED":
      return `${performer} agregó un comentario`;
    case "RESOLVED":
      // Sprint I · P4 — el técnico marca resolución; queda pendiente la
      // validación del solicitante.
      return `${performer} propuso una solución (pendiente de validación)`;
    case "USER_ACCEPTED":
      return `${performer} aceptó la solución propuesta — ticket cerrado`;
    case "USER_REJECTED_RESOLUTION":
      return `${performer} rechazó la solución — el ticket vuelve a proceso`;
    case "CLOSED":
      return `${performer} cerró el ticket`;
    default:
      return `${performer} realizó una acción sobre el ticket`;
  }
}
