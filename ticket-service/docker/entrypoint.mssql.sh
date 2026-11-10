#!/usr/bin/env sh
set -e
echo "[ticket-mssql] Aplicando prisma db push..."
# Fase P: PRISMA_ACCEPT_DATA_LOSS (default "true" = comportamiento histórico).
# El compose del servidor nuevo lo fija en "false": si un cambio de esquema
# implicara pérdida de datos, el arranque FALLA en vez de borrar columnas.
if [ "${PRISMA_ACCEPT_DATA_LOSS:-true}" = "true" ]; then
  npx prisma db push --skip-generate --accept-data-loss
else
  npx prisma db push --skip-generate
fi
echo "[ticket-mssql] Iniciando servicio Node..."
exec node dist/index.js
