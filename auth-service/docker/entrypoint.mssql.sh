#!/usr/bin/env sh
# =============================================================================
# auth-service - Bootstrap MSSQL laboratorio.
#   1) prisma db push (esquema idempotente sobre auth_db)
#   2) Filtered unique index sobre ms_oid (permite múltiples NULLs, feature
#      necesaria para usuarios locales sin Microsoft SSO — SQL Server no lo
#      permite por defecto).
#   3) prisma db seed
#   4) arranca el server
# =============================================================================
set -e

echo "[auth-mssql] Aplicando prisma db push..."
# Fase P: PRISMA_ACCEPT_DATA_LOSS (default "true" = comportamiento histórico).
# El compose del servidor nuevo lo fija en "false": si un cambio de esquema
# implicara pérdida de datos, el arranque FALLA en vez de borrar columnas.
if [ "${PRISMA_ACCEPT_DATA_LOSS:-true}" = "true" ]; then
  npx prisma db push --skip-generate --accept-data-loss
else
  npx prisma db push --skip-generate
fi

echo "[auth-mssql] Verificando/creando filtered unique index para ms_oid..."
node -e "
(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    // sys.indexes verifica si el filtered index ya existe.
    const idx = await prisma.\$queryRawUnsafe(
      \"SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.users') AND name = 'users_ms_oid_key_filtered'\"
    );
    if (Array.isArray(idx) && idx.length > 0) {
      console.log('[auth-mssql]   filtered index ya existe, se omite.');
      return;
    }
    // Buscar el nombre del unique key generado por Prisma sobre ms_oid.
    const rows = await prisma.\$queryRawUnsafe(
      \"SELECT i.name AS name FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id WHERE i.object_id=OBJECT_ID('dbo.users') AND i.is_unique=1 AND c.name='ms_oid'\"
    );
    if (Array.isArray(rows) && rows.length > 0) {
      const name = rows[0].name;
      await prisma.\$executeRawUnsafe('ALTER TABLE dbo.users DROP CONSTRAINT ' + name);
      console.log('[auth-mssql]   unique constraint ' + name + ' eliminada.');
    }
    // Requiere SET QUOTED_IDENTIFIER ON para filtered index.
    await prisma.\$executeRawUnsafe('SET QUOTED_IDENTIFIER ON');
    await prisma.\$executeRawUnsafe(
      'CREATE UNIQUE INDEX users_ms_oid_key_filtered ON dbo.users (ms_oid) WHERE ms_oid IS NOT NULL'
    );
    console.log('[auth-mssql]   filtered index creado.');
  } finally {
    await prisma.\$disconnect();
  }
})();
"

echo "[auth-mssql] Mantenimiento (roles oficiales, sesiones con hash, purga)..."
node dist/maintenance/run.js

echo "[auth-mssql] Ejecutando seed..."
# Fase P: RUN_SEED (default "true" = comportamiento histórico). En modo
# RESTAURACIÓN el instalador lo fija en "false" para no sembrar sobre datos reales.
if [ "${RUN_SEED:-true}" = "true" ]; then
  npx prisma db seed || echo "[auth-mssql]   seed reportó fallo (posible re-ejecución idempotente); continuando."
else
  echo "[auth-mssql] RUN_SEED=false — seed omitido."
fi

echo "[auth-mssql] Iniciando servicio Node..."
exec node dist/index.js
