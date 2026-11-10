// =============================================================================
// Roles y áreas — FUENTE ÚNICA de la autorización por área (Fase R).
//
// Roles oficiales:
//   admin       administración general: ambas áreas
//   technician  área TECHNICIANS
//   dtic        área DTIC (NO es administrador)
//   user        solicitante: solo sus propios tickets
//
// Los roles heredados (tech_n1..tech_n4) se NORMALIZAN al entrar (verifyJwt y
// datos de auth-service) y nunca se usan para autorizar.
// =============================================================================
import { ResponsibleArea } from "../domain/enums";

export const Roles = {
  admin: "admin",
  technician: "technician",
  dtic: "dtic",
  user: "user",
} as const;
export type OfficialRole = (typeof Roles)[keyof typeof Roles];
export type StaffRole = "admin" | "technician" | "dtic";

const LEGACY_ROLE_MAP: Record<string, OfficialRole> = {
  tech_n1: Roles.technician,
  tech_n2: Roles.technician,
  tech_n3: Roles.dtic,
  tech_n4: Roles.dtic,
};
const OFFICIAL = new Set<string>(Object.values(Roles));

/** Rol oficial equivalente; un valor desconocido degrada a `user`. */
export function normalizeRole(role: string | null | undefined): OfficialRole {
  if (!role) return Roles.user;
  if (OFFICIAL.has(role)) return role as OfficialRole;
  return LEGACY_ROLE_MAP[role] ?? Roles.user;
}

const ROLE_AREAS: Record<string, ResponsibleArea[]> = {
  [Roles.admin]: [ResponsibleArea.TECHNICIANS, ResponsibleArea.DTIC],
  [Roles.technician]: [ResponsibleArea.TECHNICIANS],
  [Roles.dtic]: [ResponsibleArea.DTIC],
};

/** Áreas que un rol puede atender/ver. user → ninguna. */
export function areasForRole(role: string | null | undefined): ResponsibleArea[] {
  return ROLE_AREAS[normalizeRole(role)] ?? [];
}

/** ¿Este rol puede atender tickets de esta área? */
export function canHandleArea(role: string | null | undefined, area: ResponsibleArea): boolean {
  return areasForRole(role).includes(area);
}

/** admin, technician o dtic. */
export function isStaffRole(role: string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === Roles.admin || r === Roles.technician || r === Roles.dtic;
}

/** technician o dtic (personal operativo, no admin). */
export function isTechRole(role: string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === Roles.technician || r === Roles.dtic;
}

export interface TicketAccessSubject {
  userId: string;
  role: string;
}
export interface TicketAccessTarget {
  userId: string;
  responsibleArea: string;
  assignedTechnicianId?: string | null;
}
export type TicketAccess =
  | { allowed: false }
  | { allowed: true; as: "admin" | "staff" | "requester" };

/**
 * Regla ÚNICA de lectura de un ticket (detalle, historial, adjuntos):
 *   · admin                                     → acceso completo
 *   · técnico/DTIC del ÁREA responsable          → acceso de staff (incluye eventos internos)
 *   · técnico asignado actualmente al ticket     → acceso de staff
 *   · propietario (cualquier rol)                → acceso de solicitante (solo eventos públicos)
 *   · cualquier otro (incl. técnico de la OTRA área) → denegado
 */
export function ticketAccess(subject: TicketAccessSubject, ticket: TicketAccessTarget): TicketAccess {
  const role = normalizeRole(subject.role);
  if (role === Roles.admin) return { allowed: true, as: "admin" };
  if (isTechRole(role)) {
    if (canHandleArea(role, ticket.responsibleArea)) return { allowed: true, as: "staff" };
    if (ticket.assignedTechnicianId && sameId(ticket.assignedTechnicianId, subject.userId)) {
      return { allowed: true, as: "staff" };
    }
  }
  if (sameId(ticket.userId, subject.userId)) return { allowed: true, as: "requester" };
  return { allowed: false };
}

/** Fase T: compara GUID sin distinguir mayúsculas (SQL Server los trata igual). */
export function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
