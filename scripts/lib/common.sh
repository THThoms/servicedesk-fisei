#!/usr/bin/env bash
# =============================================================================
# ServiceDesk UTA — funciones comunes para los scripts de servidor.
# Se incluye con:  . "$(dirname "$0")/lib/common.sh"
#
# Variables reconocidas (todas opcionales):
#   SD_DIR        raíz del proyecto instalado (por defecto: carpeta padre de scripts/)
#   SD_ENV_FILE   archivo .env del servidor   (por defecto: $SD_DIR/deploy/server/.env)
#   SD_PROJECT    nombre del proyecto compose (por defecto: servicedesk)
#   MSSQL_CONTAINER / TICKET_CONTAINER  nombres de contenedor explícitos, para
#                 instalaciones que no usan deploy/server/compose.yaml (p. ej. el
#                 VPS antiguo: sd-mssql / sd-ticket).
#
# Reglas: nunca imprimir valores de secretos; nunca hacer "source" del .env
# completo (se leen solo las claves necesarias con sd_env_get).
# =============================================================================

SD_DIR="${SD_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# Git Bash (Windows, solo para pruebas locales): docker.exe no entiende rutas
# MSYS como /tmp/... → se pasan a la forma C:/... En Linux no hace nada.
if command -v cygpath >/dev/null 2>&1; then
  SD_DIR="$(cygpath -m "$SD_DIR")"
  [ -n "${SD_ENV_FILE:-}" ] && SD_ENV_FILE="$(cygpath -m "$SD_ENV_FILE")"
fi
SD_ENV_FILE="${SD_ENV_FILE:-$SD_DIR/deploy/server/.env}"
SD_PROJECT="${SD_PROJECT:-servicedesk}"
SD_COMPOSE_FILE="${SD_COMPOSE_FILE:-$SD_DIR/deploy/server/compose.yaml}"
SQLCMD_IN_CONTAINER="/opt/mssql-tools18/bin/sqlcmd"

if [ -t 1 ]; then C_R=$'\e[31m'; C_G=$'\e[32m'; C_Y=$'\e[33m'; C_B=$'\e[1m'; C_0=$'\e[0m'; else C_R=; C_G=; C_Y=; C_B=; C_0=; fi
log()  { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SD_LOG_TAG:-servicedesk}" "$*"; }
ok()   { printf '%s  ✔ %s%s\n' "$C_G" "$*" "$C_0"; }
warn() { printf '%s  ⚠ %s%s\n' "$C_Y" "$*" "$C_0" >&2; }
die()  { printf '%s  ✘ %s%s\n' "$C_R" "$1" "$C_0" >&2; exit "${2:-1}"; }

# Lee UNA clave del .env sin evaluarlo (soporta comillas simples/dobles).
sd_env_get() {
  local key="$1" default="${2:-}" line val
  [ -f "$SD_ENV_FILE" ] || { printf '%s' "$default"; return; }
  line="$(grep -E "^[[:space:]]*${key}=" "$SD_ENV_FILE" | tail -n 1 || true)"
  if [ -z "$line" ]; then printf '%s' "$default"; return; fi
  val="${line#*=}"
  val="${val%$'\r'}"
  if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
  [ -n "$val" ] && printf '%s' "$val" || printf '%s' "$default"
}

# Estado de una clave sin revelar su valor: CONFIGURADA / VACÍA / AUSENTE
sd_env_state() {
  local key="$1"
  [ -f "$SD_ENV_FILE" ] || { echo "AUSENTE"; return; }
  if ! grep -qE "^[[:space:]]*${key}=" "$SD_ENV_FILE"; then echo "AUSENTE"; return; fi
  [ -n "$(sd_env_get "$key")" ] && echo "CONFIGURADA" || echo "VACÍA"
}

sd_compose() {
  docker compose -p "$SD_PROJECT" -f "$SD_COMPOSE_FILE" --env-file "$SD_ENV_FILE" "$@"
}

# Id del contenedor de un servicio (o el nombre explícito si se definió).
sd_container() {
  local svc="$1" explicit=""
  case "$svc" in
    mssql) explicit="${MSSQL_CONTAINER:-}";;
    ticket-service) explicit="${TICKET_CONTAINER:-}";;
  esac
  if [ -n "$explicit" ]; then echo "$explicit"; return; fi
  sd_compose ps -q "$svc" 2>/dev/null | head -n 1
}

# Ejecuta T-SQL como 'sa' DENTRO del contenedor mssql (pasado por stdin para
# evitar problemas de comillas). La contraseña se toma del entorno del propio
# contenedor ($MSSQL_SA_PASSWORD): nunca pasa por la línea de comandos del host.
# SD_QUERY_CONTAINER permite apuntar a otra instancia (p. ej. el SQL Server
# efímero del restore drill) sin cambiar nada más.
sd_query() {
  local c="${SD_QUERY_CONTAINER:-}"; [ -n "$c" ] || c="$(sd_container mssql)"; [ -n "$c" ] || die "Contenedor mssql no encontrado"
  printf 'SET NOCOUNT ON;\n%s\nGO\n' "$1" | docker exec -i "$c" bash -c \
    "$SQLCMD_IN_CONTAINER -S 127.0.0.1 -U sa -P \"\$MSSQL_SA_PASSWORD\" -C -b -h -1 -W -s '|' -i /dev/stdin"
}

sd_db_names() {
  echo "$(sd_env_get AUTH_DB_NAME auth_db) $(sd_env_get CATALOG_DB_NAME catalog_db) $(sd_env_get TICKET_DB_NAME ticket_db)"
}

# Rutas por defecto de la instancia, leídas del propio SQL Server (sin barra
# final): data → .mdf, log → .ldf, backup → .bak temporales. Funcionan con un
# solo volumen (laboratorio) o con volúmenes separados (servidor, Fase T).
sd_mssql_path() { # sd_mssql_path data|log|backup
  local prop p
  case "$1" in data) prop=InstanceDefaultDataPath;; log) prop=InstanceDefaultLogPath;; backup) prop=InstanceDefaultBackupPath;; *) die "sd_mssql_path: $1";; esac
  p="$(sd_query "SELECT CAST(SERVERPROPERTY('$prop') AS nvarchar(260));" | tr -d '\r' | head -n1)"
  p="${p%/}"; { [ -n "$p" ] && [ "$p" != NULL ]; } || p=/var/opt/mssql/data
  printf '%s' "$p"
}

# RESTORE DATABASE con MOVE de cada archivo lógico (leídos del propio backup) a
# la ruta estándar del contenedor. NO comprueba si la base existe: eso lo decide
# el llamador. Uso: sd_restore_database <ruta .bak dentro del contenedor> <base> [replace 0|1]
sd_restore_database() {
  local src="$1" db="$2" replace="${3:-0}" row t l ext moves="" nd=0 nl=0 repl="" lf ddir ldir
  ddir="$(sd_mssql_path data)"; ldir="$(sd_mssql_path log)"
  mapfile -t lf < <(sd_query "SET NOCOUNT ON; DECLARE @f TABLE (LogicalName nvarchar(128), PhysicalName nvarchar(260), Type char(1), FileGroupName nvarchar(128), Size numeric(20,0), MaxSize numeric(20,0), FileId bigint, CreateLSN numeric(25,0), DropLSN numeric(25,0), UniqueId uniqueidentifier, ReadOnlyLSN numeric(25,0), ReadWriteLSN numeric(25,0), BackupSizeInBytes bigint, SourceBlockSize int, FileGroupId int, LogGroupGUID uniqueidentifier, DifferentialBaseLSN numeric(25,0), DifferentialBaseGUID uniqueidentifier, IsReadOnly bit, IsPresent bit, TDEThumbprint varbinary(32), SnapshotUrl nvarchar(360)); INSERT @f EXEC('RESTORE FILELISTONLY FROM DISK = N''$src'''); SELECT CONCAT(Type, '|', LogicalName) FROM @f;" | tr -d '\r')
  for row in "${lf[@]}"; do
    [ -z "$row" ] && continue
    t="${row%%|*}"; l="${row#*|}"
    if [ "$t" = "L" ]; then
      ext="_log.ldf"; [ "$nl" -gt 0 ] && ext="_log$nl.ldf"; nl=$((nl + 1))
      moves+="MOVE N'$l' TO N'$ldir/${db}${ext}', "
    else
      ext=".mdf"; [ "$nd" -gt 0 ] && ext="_$nd.ndf"; nd=$((nd + 1))
      moves+="MOVE N'$l' TO N'$ddir/${db}${ext}', "
    fi
  done
  [ -n "$moves" ] || die "No se pudieron leer los archivos lógicos de $src"
  if [ "$replace" = 1 ]; then
    repl="REPLACE, "
    sd_query "IF DB_ID(N'$db') IS NOT NULL ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;" >/dev/null || true
  fi
  sd_query "RESTORE DATABASE [$db] FROM DISK = N'$src' WITH ${moves}${repl}RECOVERY, STATS = 50;" >/dev/null
  sd_query "ALTER DATABASE [$db] SET MULTI_USER;" >/dev/null
}

sd_require_cmd() { command -v "$1" >/dev/null 2>&1 || die "Falta el comando '$1'"; }

# Espera a que todos los servicios con healthcheck estén healthy.
sd_wait_healthy() {
  local timeout="${1:-420}" waited=0 pending
  while :; do
    pending=""
    for svc in mssql auth-service catalog-service ticket-service api-gateway frontend; do
      local c st
      c="$(sd_compose ps -q "$svc" 2>/dev/null | head -n1)"
      if [ -z "$c" ]; then pending+=" $svc(sin contenedor)"; continue; fi
      st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null)"
      [ "$st" = "healthy" ] || pending+=" $svc($st)"
    done
    [ -z "$pending" ] && return 0
    [ "$waited" -ge "$timeout" ] && { warn "Sin healthy tras ${timeout}s:$pending"; return 1; }
    sleep 5; waited=$((waited + 5))
  done
}
