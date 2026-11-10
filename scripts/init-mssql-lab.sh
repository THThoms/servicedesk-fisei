#!/usr/bin/env bash
# =============================================================================
# ServiceDesk UTA - Runner del bootstrap del laboratorio SQL Server.
#
# El contenedor `mssql-tools:latest` no tiene todo; lo necesario es sqlcmd.
# Este script:
#   1) espera a que el servidor esté disponible (redundante — el healthcheck ya
#      lo hace pero mantenemos un retry por seguridad).
#   2) inyecta las variables como :setvar y ejecuta el .sql en sqlcmd.
#
# Requiere en el entorno:
#   MSSQL_SA_PASSWORD
#   AUTH_DB_NAME AUTH_DB_USER AUTH_DB_PASSWORD
#   CATALOG_DB_NAME CATALOG_DB_USER CATALOG_DB_PASSWORD
#   TICKET_DB_NAME TICKET_DB_USER TICKET_DB_PASSWORD
# =============================================================================
set -euo pipefail

SQLCMD_BIN="${SQLCMD_BIN:-/opt/mssql-tools/bin/sqlcmd}"
if [[ ! -x "$SQLCMD_BIN" ]]; then
    # imagen mssql-server incluye tools18
    SQLCMD_BIN="/opt/mssql-tools18/bin/sqlcmd"
fi

SERVER="${MSSQL_HOST:-mssql}"

echo "==> [init-mssql-lab] esperando a que ${SERVER} acepte conexiones..."
for i in {1..40}; do
    if "${SQLCMD_BIN}" -S "${SERVER}" -U sa -P "${MSSQL_SA_PASSWORD}" -C -N -l 5 \
         -Q "SELECT @@VERSION" > /dev/null 2>&1; then
        echo "==> [init-mssql-lab] servidor listo."
        break
    fi
    echo "    intento ${i}/40 — reintentando en 3s..."
    sleep 3
done

echo "==> [init-mssql-lab] ejecutando bootstrap T-SQL..."
"${SQLCMD_BIN}" \
    -S "${SERVER}" \
    -U sa \
    -P "${MSSQL_SA_PASSWORD}" \
    -C -N -b \
    -v AUTH_DB_NAME="${AUTH_DB_NAME}" \
    -v AUTH_DB_USER="${AUTH_DB_USER}" \
    -v AUTH_DB_PASSWORD="${AUTH_DB_PASSWORD}" \
    -v CATALOG_DB_NAME="${CATALOG_DB_NAME}" \
    -v CATALOG_DB_USER="${CATALOG_DB_USER}" \
    -v CATALOG_DB_PASSWORD="${CATALOG_DB_PASSWORD}" \
    -v TICKET_DB_NAME="${TICKET_DB_NAME}" \
    -v TICKET_DB_USER="${TICKET_DB_USER}" \
    -v TICKET_DB_PASSWORD="${TICKET_DB_PASSWORD}" \
    -i /init/init-mssql-lab.sql

echo "==> [init-mssql-lab] listo."
