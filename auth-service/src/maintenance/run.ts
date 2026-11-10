// Ejecutado por docker/entrypoint.mssql.sh en cada arranque (tras prisma db push).
// Solo registra conteos; nunca datos de usuarios ni tokens.
import { prisma } from "../db/client";
import { runMaintenance } from "./maintenance";

runMaintenance(prisma, Number(process.env.SESSION_RETENTION_DAYS ?? 7) || 7)
  .then((r) => {
    const roles = Object.entries(r.rolesMigrated).map(([k, v]) => `${k}=${v}`).join(", ") || "ninguno";
    console.log(`[auth-maintenance] roles migrados: ${roles} · sesiones convertidas a hash: ${r.sessionsHashed} · sesiones purgadas: ${r.sessionsPurged}`);
  })
  .catch((e) => {
    console.error("[auth-maintenance] ERROR:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
