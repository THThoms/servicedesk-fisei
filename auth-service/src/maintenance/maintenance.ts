// =============================================================================
// Fase R — Mantenimiento de auth_db (idempotente; seguro en instalación limpia
// y en bases RESTAURADAS de versiones anteriores). No borra usuarios ni logs.
//
//   1. migrateRoles        tech_n1/tech_n2 → technician · tech_n3/tech_n4 → dtic
//                          (mismo id, mismos datos; solo cambia el valor de `role`)
//   2. hashLegacySessions  sesiones que aún guardan el JWT completo → SHA-256.
//                          Mismo algoritmo que hashToken() (UTF-8 = ASCII en JWT),
//                          así las sesiones vigentes siguen siendo válidas.
//   3. purgeSessions       borra sesiones caducadas o revocadas hace > N días.
// =============================================================================
import type { PrismaClient } from "@prisma/client";
import { LEGACY_ROLE_MAP } from "../domain/enums";

export interface MaintenanceResult {
  rolesMigrated: Record<string, number>;
  sessionsHashed: number;
  sessionsPurged: number;
}

export async function migrateRoles(prisma: PrismaClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [legacy, official] of Object.entries(LEGACY_ROLE_MAP)) {
    const n = await prisma.$executeRawUnsafe(
      "UPDATE dbo.users SET role = @P1, updated_at = SYSUTCDATETIME() WHERE role = @P2",
      official,
      legacy
    );
    if (n > 0) out[`${legacy}->${official}`] = n;
  }
  return out;
}

export async function hashLegacySessions(prisma: PrismaClient): Promise<number> {
  // Un hash SHA-256 hex tiene exactamente 64 caracteres [0-9a-f]; un JWT nunca.
  return prisma.$executeRawUnsafe(
    "UPDATE dbo.sessions " +
      "SET token = LOWER(CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(token AS varchar(2048))), 2)) " +
      "WHERE LEN(token) <> 64 OR token LIKE '%.%'"
  );
}

export async function purgeSessions(prisma: PrismaClient, retentionDays = 7): Promise<number> {
  return prisma.$executeRawUnsafe(
    "DELETE FROM dbo.sessions WHERE expires_at < DATEADD(day, -@P1, SYSUTCDATETIME()) " +
      "OR (revoked_at IS NOT NULL AND revoked_at < DATEADD(day, -@P1, SYSUTCDATETIME()))",
    retentionDays
  );
}

export async function runMaintenance(prisma: PrismaClient, retentionDays = 7): Promise<MaintenanceResult> {
  const rolesMigrated = await migrateRoles(prisma);
  const sessionsHashed = await hashLegacySessions(prisma);
  const sessionsPurged = await purgeSessions(prisma, retentionDays);
  return { rolesMigrated, sessionsHashed, sessionsPurged };
}
