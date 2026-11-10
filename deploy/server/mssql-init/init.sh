#!/bin/bash
# =============================================================================
# ServiceDesk UTA — bootstrap de SQL Server para el servidor nuevo.
# Lo ejecuta el servicio `mssql-init` del compose (una vez por arranque).
# Idempotente. No borra nada. No imprime secretos.
# =============================================================================
set -euo pipefail

SQLCMD="/opt/mssql-tools18/bin/sqlcmd"
SERVER="${MSSQL_HOST:-mssql}"

echo "==> [mssql-init] esperando a ${SERVER}..."
for i in $(seq 1 60); do
  if "$SQLCMD" -S "$SERVER" -U sa -P "$MSSQL_SA_PASSWORD" -C -l 5 -Q "SELECT 1" >/dev/null 2>&1; then
    echo "==> [mssql-init] servidor listo."
    break
  fi
  [ "$i" = 60 ] && { echo "==> [mssql-init] ERROR: SQL Server no respondió."; exit 1; }
  sleep 3
done

echo "==> [mssql-init] edición del motor:"
"$SQLCMD" -S "$SERVER" -U sa -P "$MSSQL_SA_PASSWORD" -C -h -1 -W \
  -Q "SET NOCOUNT ON; SELECT CONCAT('    ', CAST(SERVERPROPERTY('Edition') AS nvarchar(128)), ' · ', CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(32)), ' · ', CAST(SERVERPROPERTY('ProductUpdateLevel') AS nvarchar(16)))"

echo "==> [mssql-init] bases, logins y usuarios..."
"$SQLCMD" -S "$SERVER" -U sa -P "$MSSQL_SA_PASSWORD" -C -b \
  -v AUTH_DB_NAME="$AUTH_DB_NAME" AUTH_DB_USER="$AUTH_DB_USER" AUTH_DB_PASSWORD="$AUTH_DB_PASSWORD" \
     CATALOG_DB_NAME="$CATALOG_DB_NAME" CATALOG_DB_USER="$CATALOG_DB_USER" CATALOG_DB_PASSWORD="$CATALOG_DB_PASSWORD" \
     TICKET_DB_NAME="$TICKET_DB_NAME" TICKET_DB_USER="$TICKET_DB_USER" TICKET_DB_PASSWORD="$TICKET_DB_PASSWORD" \
  -i /init/init.sql

echo "==> [mssql-init] listo."
