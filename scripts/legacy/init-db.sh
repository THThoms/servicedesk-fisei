#!/bin/bash
# =============================================================================
# Sincroniza esquemas Prisma + seeds de los 3 microservicios en orden.
# Uso: docker compose exec api-gateway sh /app/scripts/init-db.sh
#   o: ./scripts/init-db.sh   (con los servicios ya levantados)
# =============================================================================
set -e

echo "==> [1/3] Sincronizando + sembrando auth-service"
docker compose exec -T auth-service npx prisma db push
docker compose exec -T auth-service npx prisma db seed

echo "==> [2/3] Sincronizando + sembrando catalog-service"
docker compose exec -T catalog-service npx prisma db push
docker compose exec -T catalog-service npx prisma db seed

echo "==> [3/3] Sincronizando ticket-service (sin seed)"
docker compose exec -T ticket-service npx prisma db push

echo "==> Sincronización de esquemas y seeds completada"
