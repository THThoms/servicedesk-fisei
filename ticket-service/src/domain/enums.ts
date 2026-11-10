// =============================================================================
// ticket-service - Enums de dominio (Sprint B / preparación MSSQL).
// Ver comentario en auth-service/src/domain/enums.ts.
// =============================================================================

export const TicketStatus = {
  abierto: "abierto",
  en_proceso: "en_proceso",
  escalado: "escalado",
  // Sprint I · P4 — el técnico marcó el ticket como resuelto pero el
  // solicitante todavía debe validar la solución. En este estado el ticket:
  //   · sigue asignado al técnico que resolvió (assignedTechnicianId).
  //   · no aparece en la bandeja "disponibles".
  //   · aparece en "Mis Tickets" del usuario con acciones aceptar/rechazar.
  //   · solo el propietario puede aceptar (→ cerrado) o rechazar (→ en_proceso).
  pendiente_validacion: "pendiente_validacion",
  resuelto: "resuelto",
  cerrado: "cerrado",
} as const;
export type TicketStatus = string;

export const Level = {
  N1: "N1",
  N2: "N2",
  N3: "N3",
  N4: "N4",
} as const;
export type Level = string;

export const Priority = {
  baja: "baja",
  media: "media",
  alta: "alta",
  critica: "critica",
} as const;
export type Priority = string;

export const ResponsibleArea = {
  TECHNICIANS: "TECHNICIANS",
  DTIC: "DTIC",
} as const;
export type ResponsibleArea = string;

export const AssignmentStatus = {
  unassigned: "unassigned",
  available: "available",
  accepted: "accepted",
  assigned_by_admin: "assigned_by_admin",
} as const;
export type AssignmentStatus = string;

export const EventAction = {
  CREATED: "CREATED",
  CATEGORIZED: "CATEGORIZED",
  AVAILABLE: "AVAILABLE",
  ACCEPTED: "ACCEPTED",
  ASSIGNED: "ASSIGNED",
  CONTRIBUTED: "CONTRIBUTED",
  STATUS_CHANGED: "STATUS_CHANGED",
  ESCALATED: "ESCALATED",
  REASSIGNED: "REASSIGNED",
  COMMENTED: "COMMENTED",
  RESOLVED: "RESOLVED",
  // Sprint I · P4 — el solicitante valida la solución propuesta por el técnico.
  USER_ACCEPTED: "USER_ACCEPTED",
  USER_REJECTED_RESOLUTION: "USER_REJECTED_RESOLUTION",
  CLOSED: "CLOSED",
} as const;
export type EventAction = string;

export const EventVisibility = {
  public: "public",
  internal: "internal",
} as const;
export type EventVisibility = string;

export const EmailStatus = {
  pending: "pending",
  sent: "sent",
  failed: "failed",
} as const;
export type EmailStatus = string;
