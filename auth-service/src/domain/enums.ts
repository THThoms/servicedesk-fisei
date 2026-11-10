// =============================================================================
// auth-service - Enums de dominio.
//
// Prisma-SQLServer no soporta `enum`: las columnas son NVarChar y los valores
// válidos viven aquí.
//
// Fase R — ROLES DEFINITIVOS (únicos que la autorización reconoce):
//   admin      administración general (ambas áreas)
//   technician área TECHNICIANS (antes tech_n1 / tech_n2)
//   dtic       área DTIC        (antes tech_n3 / tech_n4) — NO es administrador
//   user       solicitante
//
// Los roles heredados tech_n1..n4 solo se NORMALIZAN (JWT antiguos durante la
// transición y datos restaurados antes de la migración); nunca se emiten.
// =============================================================================

export const Role = {
  admin: "admin",
  technician: "technician",
  dtic: "dtic",
  user: "user",
} as const;
export type Role = string;

export const OFFICIAL_ROLES: readonly string[] = [Role.admin, Role.technician, Role.dtic, Role.user];
export const STAFF_ROLES: readonly string[] = [Role.admin, Role.technician, Role.dtic];
export const TECH_ROLES: readonly string[] = [Role.technician, Role.dtic];

/** Mapeo controlado de los roles anteriores a la Fase R. */
export const LEGACY_ROLE_MAP: Readonly<Record<string, string>> = {
  tech_n1: Role.technician,
  tech_n2: Role.technician,
  tech_n3: Role.dtic,
  tech_n4: Role.dtic,
};

/** Devuelve el rol oficial equivalente. Un valor desconocido degrada a `user`. */
export function normalizeRole(role: string | null | undefined): string {
  if (!role) return Role.user;
  if (OFFICIAL_ROLES.includes(role)) return role;
  return LEGACY_ROLE_MAP[role] ?? Role.user;
}

// -----------------------------------------------------------------------------
// Fase T — Bloques físicos de la FISEI (clasificación de técnicos, no un rol).
// Solo aplica al rol `technician`. DTIC conserva su clasificación independiente.
// -----------------------------------------------------------------------------
export const TechBlock = { BLOQUE_1: "BLOQUE_1", BLOQUE_2: "BLOQUE_2" } as const;
export const TECH_BLOCKS: readonly string[] = [TechBlock.BLOQUE_1, TechBlock.BLOQUE_2];
export const TECH_BLOCK_LABELS: Readonly<Record<string, string>> = {
  BLOQUE_1: "Bloque 1",
  BLOQUE_2: "Bloque 2",
};
/** Bloque válido para un usuario: solo técnicos; para cualquier otro rol, null. */
export function blockForRole(role: string, block: string | null | undefined): string | null {
  return normalizeRole(role) === Role.technician && block && TECH_BLOCKS.includes(block) ? block : null;
}
