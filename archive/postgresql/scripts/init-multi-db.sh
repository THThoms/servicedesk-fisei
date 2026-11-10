#!/bin/bash
# =============================================================================
# ⛔ LEGACY — NO EJECUTAR
# PostgreSQL fue retirado del runtime en Fase N (2026-09-15). Este script
# solo tiene sentido si se reconstruye un contenedor postgres antiguo para
# leer los dumps `postgresql-final-retired/*.custom.dump`. En producción y
# desarrollo actuales el runtime es SQL Server (docker-compose.mssql.yml
# y docker-compose.prod-mssql.yml). Ver docs/mssql/POSTGRESQL_RETIRADO.md.
# =============================================================================
# Inicializa 3 bases aisladas en una sola instancia de Postgres,
# cada una con su propio usuario (principio de privilegio mínimo).
# Se ejecutaba UNA sola vez al levantar el contenedor postgres por primera
# vez (se montaba en /docker-entrypoint-initdb.d/).
# =============================================================================
set -e

create_db_and_user() {
    local db_name=$1
    local db_user=$2
    local db_password=$3

    echo "==> Creando base '$db_name' y usuario '$db_user'"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
        CREATE USER $db_user WITH PASSWORD '$db_password';
        CREATE DATABASE $db_name OWNER $db_user;
        GRANT ALL PRIVILEGES ON DATABASE $db_name TO $db_user;
EOSQL

    # Privilegios sobre el schema public dentro de la nueva base
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db_name" <<-EOSQL
        GRANT ALL ON SCHEMA public TO $db_user;
        ALTER SCHEMA public OWNER TO $db_user;
EOSQL
}

create_db_and_user "${AUTH_DB_NAME}"    "${AUTH_DB_USER}"    "${AUTH_DB_PASSWORD}"
create_db_and_user "${CATALOG_DB_NAME}" "${CATALOG_DB_USER}" "${CATALOG_DB_PASSWORD}"
create_db_and_user "${TICKET_DB_NAME}"  "${TICKET_DB_USER}"  "${TICKET_DB_PASSWORD}"

echo "==> Bases creadas correctamente"
