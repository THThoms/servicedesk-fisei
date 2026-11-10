#!/usr/bin/env bash
# =============================================================================
# scripts/backup-mssql.sh — Backup completo de ServiceDesk UTA (SQL Server 2022)
#
#   sudo SD_DIR=/opt/servicedesk scripts/backup-mssql.sh        (lo ejecuta systemd)
#
# Una ejecución = un CONJUNTO identificado por un ID (sd-<UTC>-<rand>):
#
#   SQL Server ─► BACKUP DATABASE (auth_db, catalog_db, ticket_db) WITH CHECKSUM
#              ─► archivo existe y tamaño > 0 ─► RESTORE VERIFYONLY WITH CHECKSUM
#              ─► SHA-256 ─► conteos y relaciones ─► lista SHA-256 de imágenes
#              ─► configuración necesaria (solo si hay repositorio cifrado)
#              ─► manifest.json ─► Restic (cifrado AES-256) ─► B2 / S3
#
# Estructura local  $BACKUP_DIR/sets/<ID>/ :
#   db/<base>-<STAMP>.bak (x3) · manifest.json · counts.txt · uploads.sha256
#   SHA256SUMS · .complete   (+ config/ temporal, solo mientras sube a Restic)
#
# Las imágenes NO se copian al disco local: Restic las lee directamente del
# volumen real (detectado por el montaje /app/uploads del contenedor) y las
# deduplica. Sin repositorio externo se genera uploads-<STAMP>.tar.gz local.
#
# Configuración: deploy/server/.env (BACKUP_DIR, BACKUP_LOCAL_KEEP=3,
# BACKUP_REQUIRE_OFFSITE=true) y /etc/servicedesk/backup.env (Restic/S3).
# NUNCA hay secretos en este script; la contraseña de 'sa' se usa DENTRO del
# contenedor y la clave de Restic se monta como archivo de solo lectura.
#
# Códigos de salida:
#   0 OK (local verificado + snapshot cifrado verificado)
#   1 fallo de backup o verificación local (el conjunto NO es válido)
#   3 backup local correcto pero SIN repositorio externo configurado
#   4 backup local correcto pero falló la copia externa (Restic/S3)
# Estado: $BACKUP_DIR/last-status (status/code/backup_id/detail, sin secretos).
# NO borra bases ni volúmenes. Solo rota conjuntos locales completos antiguos.
# =============================================================================
set -euo pipefail
SD_LOG_TAG="backup-mssql"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPTS/lib/common.sh"
. "$SCRIPTS/lib/backup.sh"
sd_backup_load

BACKUP_DIR="${BACKUP_DIR:-$(sd_env_get BACKUP_DIR /var/backups/servicedesk)}"
LOCAL_KEEP="${BACKUP_LOCAL_KEEP:-$(sd_env_get BACKUP_LOCAL_KEEP 3)}"
REQUIRE_OFFSITE="${BACKUP_REQUIRE_OFFSITE:-$(sd_env_get BACKUP_REQUIRE_OFFSITE true)}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BID="sd-$STAMP-$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')"
SET="$BACKUP_DIR/sets/$BID"
INNER=""   # se fija con la ruta de backup de la instancia (sd_mssql_path backup)
STATUS_FILE="$BACKUP_DIR/last-status"
T0="$(date +%s)"
STAGE="inicio"; SD_ERR_CODE="E_BACKUP"; MSSQL_C=""

umask 077
mkdir -p "$BACKUP_DIR/sets"
chmod 700 "$BACKUP_DIR" "$BACKUP_DIR/sets" 2>/dev/null || true
exec 9>"$BACKUP_DIR/.lock"
command -v flock >/dev/null 2>&1 && { flock -n 9 || die "Otro backup está en curso"; }

on_exit() {
  local rc=$?
  [ -n "$MSSQL_C" ] && [ -n "$INNER" ] && docker exec "$MSSQL_C" rm -rf "$INNER" >/dev/null 2>&1 || true
  rm -rf "$SET/config" 2>/dev/null || true          # la configuración solo vive cifrada
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 3 ] && [ "$rc" -ne 4 ]; then
    [ -d "$SET" ] && : > "$SET/.failed" 2>/dev/null
    sd_status_write "$STATUS_FILE" FAILED "$SD_ERR_CODE" "etapa: $STAGE (exit $rc)" "$BID"
    sd_heartbeat fail
    printf '%s [%s] FALLO backup_id=%s code=%s etapa=%s\n' "$(date -u +%FT%TZ)" "$SD_LOG_TAG" "$BID" "$SD_ERR_CODE" "$STAGE" >&2
  fi
}
trap on_exit EXIT

# ------------------------------------------------------------- 1. contenedores
STAGE="contenedores"; SD_ERR_CODE=E_NO_CONTAINER
MSSQL_C="$(sd_container mssql)"; [ -n "$MSSQL_C" ] || die "No se encontró el contenedor de SQL Server"
img="$(docker inspect -f '{{.Config.Image}}|{{.State.Running}}' "$MSSQL_C" 2>/dev/null || true)"
case "$img" in *mssql*'|true') ;; *) die "El contenedor '$MSSQL_C' no es un SQL Server en ejecución";; esac
TICKET_C="$(sd_container ticket-service)"
UP_TYPE=""; UP_NAME=""; UP_SRC=""
if [ -n "$TICKET_C" ]; then
  IFS='|' read -r UP_TYPE UP_NAME UP_SRC < <(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Type}}|{{.Name}}|{{.Source}}{{end}}{{end}}' "$TICKET_C") || true
fi

EDITION="$(sd_query "SELECT CAST(SERVERPROPERTY('Edition') AS nvarchar(128));" | tr -d '\r' | head -n1)"
BAKDIR="$(sd_mssql_path backup)"; INNER="$BAKDIR/_backup_$BID"
VERSION="$(sd_query "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(32));" | tr -d '\r' | head -n1)"
COLLATION="$(sd_query "SELECT CAST(SERVERPROPERTY('Collation') AS nvarchar(128));" | tr -d '\r' | head -n1)"
read -r A C T <<<"$(sd_db_names)"
OFFSITE=0; sd_backup_configured && OFFSITE=1
# Compresión de SQL Server: un .bak comprimido cambia por completo cada día y
# Restic no puede deduplicarlo. Con repositorio externo (auto) se respalda SIN
# comprimir y Restic comprime (zstd) y deduplica antes de cifrar. Express no comprime nunca.
SQLCOMP="${BACKUP_SQL_COMPRESSION:-$(sd_env_get BACKUP_SQL_COMPRESSION auto)}"
case "$SQLCOMP" in auto) [ "$OFFSITE" = 1 ] && SQLCOMP=false || SQLCOMP=true;; true|false) ;; *) die "BACKUP_SQL_COMPRESSION debe ser auto, true o false";; esac
case "$EDITION" in *Express*) SQLCOMP=false;; esac
if [ "$SQLCOMP" = true ]; then COMPRESSION="COMPRESSION,"; COMP_JSON=true; else COMPRESSION=""; COMP_JSON=false; fi
APP_VERSION="$(head -n1 "$SD_DIR/VERSION" 2>/dev/null || git -C "$SD_DIR" describe --always --dirty 2>/dev/null || echo desconocida)"
log "Inicio $BID · $EDITION $VERSION · repositorio externo: $([ $OFFSITE = 1 ] && echo configurado || echo NO)"

# ------------------------------------------------------------- 2. espacio
STAGE="espacio"; SD_ERR_CODE=E_NO_SPACE
need_kb="$(sd_query "SELECT CAST(SUM(CAST(size AS bigint)) * 8 AS bigint) FROM sys.master_files WHERE type = 0 AND database_id IN (DB_ID(N'$A'), DB_ID(N'$C'), DB_ID(N'$T'));" | tr -d '\r' | head -n1)"
[ -n "$need_kb" ] && [ "$need_kb" != NULL ] || { SD_ERR_CODE=E_BACKUP; die "No se encontraron las bases $A $C $T"; }
need_kb=$(( need_kb * 12 / 10 + 102400 ))          # tamaño asignado +20 % + 100 MB
free_in="$(docker exec "$MSSQL_C" df -Pk "$BAKDIR" | awk 'NR==2{print $4}')"
free_host="$(df -Pk "$BACKUP_DIR" | awk 'NR==2{print $4}')"
[ "${free_in:-0}" -ge "$need_kb" ] || die "Falta espacio en el volumen de backups de SQL Server ($BAKDIR): libres ${free_in:-?} KB, necesarios $need_kb KB"
[ "${free_host:-0}" -ge "$need_kb" ] || die "Falta espacio en $BACKUP_DIR: libres ${free_host:-?} KB, necesarios $need_kb KB"
ok "espacio suficiente (necesario ≈ $((need_kb / 1024)) MB)"

mkdir -p "$SET/db" "$SET/uploads"; chmod 700 "$SET" "$SET/db"
docker exec "$MSSQL_C" mkdir -p "$INNER"

# ------------------------------------------------------------- 3. bases de datos
declare -A C_BEFORE C_AFTER
read_counts() { # read_counts <array>  — conteos actuales de las 13 tablas
  local -n _arr="$1"; local line
  while IFS= read -r line; do line="${line%$'\r'}"; [ -n "$line" ] && _arr["${line%%=*}"]="${line#*=}"; done \
    < <(sd_query "$(sd_counts_sql "$A" "$C" "$T")")
}
read_counts C_BEFORE
DB_JSON=""
for db in $A $C $T; do
  file="db/$db-$STAMP.bak"; t1="$(date +%s)"
  STAGE="BACKUP $db"; SD_ERR_CODE=E_BACKUP
  log "BACKUP $db"
  sd_query "BACKUP DATABASE [$db] TO DISK = N'$INNER/$(basename "$file")' WITH $COMPRESSION CHECKSUM, INIT, FORMAT, STATS = 50;" >/dev/null
  STAGE="VERIFYONLY $db"; SD_ERR_CODE=E_VERIFYONLY
  sd_query "RESTORE VERIFYONLY FROM DISK = N'$INNER/$(basename "$file")' WITH CHECKSUM;" >/dev/null
  STAGE="copia $db"; SD_ERR_CODE=E_BACKUP
  docker exec "$MSSQL_C" cat "$INNER/$(basename "$file")" > "$SET/$file"
  docker exec "$MSSQL_C" rm -f "$INNER/$(basename "$file")"
  [ -s "$SET/$file" ] || die "El archivo $file no existe o está vacío"
  size="$(wc -c < "$SET/$file" | tr -d ' ')"
  inner_size="$(sd_query "SELECT TOP 1 CAST(backup_size AS bigint) FROM msdb.dbo.backupset WHERE database_name = N'$db' ORDER BY backup_finish_date DESC;" | tr -d '\r' | head -n1)"
  sha="$(sha256sum "$SET/$file" | cut -d' ' -f1)"
  dur=$(( $(date +%s) - t1 ))
  ok "$db: VERIFYONLY correcto · $size bytes · ${dur}s"
  [ -n "$DB_JSON" ] && DB_JSON+=","
  DB_JSON+=$'\n    '"{\"name\": $(sd_json_str "$db"), \"file\": $(sd_json_str "$file"), \"sizeBytes\": $size, \"backupSizeBytes\": ${inner_size:-null}, \"sha256\": \"$sha\", \"checksum\": true, \"compressed\": $COMP_JSON, \"verifyOnly\": \"PASSED\", \"durationSeconds\": $dur}"
done
read_counts C_AFTER

STAGE="conteos"; SD_ERR_CODE=E_BACKUP
{
  echo "# conteos al inicio y al final del backup (iguales = valor exacto del backup)"
  for spec in $SD_COUNT_TABLES; do k="${spec#*:}"; echo "$k=${C_BEFORE[$k]:-0} ${C_AFTER[$k]:-0}"; done
  sd_query "$(sd_relations_sql "$A" "$C" "$T")" | tr -d '\r' | grep '='
} > "$SET/counts.txt"
COUNTS_JSON=""
for spec in $SD_COUNT_TABLES; do
  k="${spec#*:}"; v="${C_AFTER[$k]:-0}"; [ "${C_BEFORE[$k]:-0}" = "$v" ] || v="${C_BEFORE[$k]}..$v"
  [ -n "$COUNTS_JSON" ] && COUNTS_JSON+=", "; COUNTS_JSON+="\"$k\": $(sd_json_str "$v")"
done
REL_BAD="$(grep '^fk_' "$SET/counts.txt" | grep -vc '=0$' || true)"

# ------------------------------------------------------------- 4. imágenes
STAGE="imagenes"; SD_ERR_CODE=E_UPLOADS
UP_FILES=0; UP_BYTES=0; ATT_LOCAL=0; ATT_EXT=0; ATT_MISSING=0; ORPHANS=0
if [ -n "$TICKET_C" ] && [ -n "$UP_TYPE" ]; then
  docker exec "$TICKET_C" sh -c 'cd /app/uploads && find . -type f -exec sha256sum {} +' | LC_ALL=C sort -k2 > "$SET/uploads.sha256"
  UP_FILES="$(wc -l < "$SET/uploads.sha256" | tr -d ' ')"
  UP_BYTES="$(docker exec "$TICKET_C" sh -c 'cd /app/uploads && find . -type f -exec stat -c %s {} +' | awk '{s+=$1} END {print s+0}')"
  sed 's#^[0-9a-f]*  \./##' "$SET/uploads.sha256" | LC_ALL=C sort > "$SET/.files"
  sd_query "$(sd_attachments_sql "$T")" | tr -d '\r' | grep '|' > "$SET/.att" || true
  ATT_EXT="$(grep -vc '^local|' "$SET/.att" || true)"
  grep '^local|' "$SET/.att" | cut -d'|' -f2 | sed 's#.*/##' | LC_ALL=C sort -u > "$SET/.attnames" || true
  ATT_LOCAL="$(wc -l < "$SET/.attnames" | tr -d ' ')"
  ATT_MISSING="$(LC_ALL=C comm -23 "$SET/.attnames" "$SET/.files" | wc -l | tr -d ' ')"
  ORPHANS="$(LC_ALL=C comm -13 "$SET/.attnames" "$SET/.files" | wc -l | tr -d ' ')"
  rm -f "$SET/.files" "$SET/.att" "$SET/.attnames"
  ok "imágenes: $UP_FILES archivos ($UP_BYTES bytes) en ${UP_TYPE}:${UP_NAME:-$UP_SRC} · adjuntos locales $ATT_LOCAL · sin archivo $ATT_MISSING · huérfanos $ORPHANS"
  [ "$ATT_MISSING" = 0 ] || warn "$ATT_MISSING adjunto(s) registrados en ticket_db no tienen archivo en el volumen (se documenta, no se corrige)"
  [ "$ORPHANS" = 0 ] || warn "$ORPHANS archivo(s) huérfanos en el volumen (sin fila en attachments). No se eliminan."
  if [ "$OFFSITE" = 0 ]; then   # sin repositorio externo: única copia de las imágenes
    docker exec "$TICKET_C" tar czf - -C /app uploads > "$SET/uploads-$STAMP.tar.gz"
  fi
else
  : > "$SET/uploads.sha256"
  warn "No se encontró ticket-service o su montaje /app/uploads: imágenes NO respaldadas"
fi

# ------------------------------------------------------------- 5. configuración
CONFIG_FILES=0
if [ "$OFFSITE" = 1 ]; then
  STAGE="configuracion"; SD_ERR_CODE=E_BACKUP
  CFG="$SET/config"; mkdir -p "$CFG"; chmod 700 "$CFG"
  cpc() { [ -f "$1" ] && { cp "$1" "$CFG/$2"; chmod 600 "$CFG/$2"; CONFIG_FILES=$((CONFIG_FILES + 1)); } || true; }
  cpc "$SD_ENV_FILE" server.env
  cpc "$SD_COMPOSE_FILE" compose.yaml
  for f in "$(dirname "$SD_ENV_FILE")"/.install-state.*; do cpc "$f" "$(basename "$f")"; done
  cpc "${BACKUP_NGINX_CONF:-/etc/nginx/sites-available/servicedesk.conf}" nginx-servicedesk.conf
  cpc /etc/docker/daemon.json docker-daemon.json
  for f in /etc/systemd/system/servicedesk-*; do [ -f "$f" ] && { mkdir -p "$CFG/systemd"; cpc "$f" "systemd/$(basename "$f")"; }; done
  {
    echo "edition=$EDITION"; echo "version=$VERSION"; echo "collation=$COLLATION"
    sd_query "SELECT CONCAT(name COLLATE DATABASE_DEFAULT, ' recovery=', recovery_model_desc COLLATE DATABASE_DEFAULT, ' compat=', compatibility_level, ' collation=', collation_name COLLATE DATABASE_DEFAULT) FROM sys.databases WHERE name IN (N'$A', N'$C', N'$T');" | tr -d '\r'
    sd_query "SELECT 'max_server_memory_mb=' + CAST(value_in_use AS varchar(20)) FROM sys.configurations WHERE name = 'max server memory (MB)';" | tr -d '\r'
  } > "$CFG/mssql-server.txt"; CONFIG_FILES=$((CONFIG_FILES + 1))
  # Excluido a propósito: claves SSH, /etc/letsencrypt (se reemite), la clave
  # Restic y las credenciales S3 (backup.env), .initial-admin-secret y
  # cualquier archivo de contraseña temporal.
  ( cd "$CFG" && find . -type f ! -name SHA256SUMS -exec sha256sum {} + | LC_ALL=C sort -k2 > SHA256SUMS )
  ok "configuración preparada: $CONFIG_FILES archivo(s) (solo irán al repositorio cifrado)"
fi

# ------------------------------------------------------------- 6. manifest
STAGE="manifest"; SD_ERR_CODE=E_BACKUP
cat > "$SET/manifest.json" <<JSON
{
  "schema": 1,
  "backupId": "$BID",
  "timestampUtc": "$(date -u -d "@$T0" +%FT%TZ 2>/dev/null || date -u +%FT%TZ)",
  "finishedUtc": "$(date -u +%FT%TZ)",
  "durationSeconds": $(( $(date +%s) - T0 )),
  "serverName": $(sd_json_str "$RESTIC_SNAPSHOT_HOST"),
  "application": {"name": "ServiceDesk UTA", "version": $(sd_json_str "$APP_VERSION")},
  "sqlServer": {"edition": $(sd_json_str "$EDITION"), "version": $(sd_json_str "$VERSION"), "collation": $(sd_json_str "$COLLATION")},
  "databases": [$DB_JSON
  ],
  "counts": {$COUNTS_JSON},
  "relationsWithinDatabasesOk": $([ "$REL_BAD" = 0 ] && echo true || echo false),
  "uploads": {"source": $(sd_json_str "${UP_TYPE:-none}:${UP_NAME:-$UP_SRC}"), "files": $UP_FILES, "bytes": $UP_BYTES, "checksumList": "uploads.sha256"},
  "attachments": {"localRows": $ATT_LOCAL, "externalRows": $ATT_EXT, "rowsWithoutFile": $ATT_MISSING, "orphanFiles": $ORPHANS},
  "config": {"included": $([ "$OFFSITE" = 1 ] && echo true || echo false), "files": $CONFIG_FILES},
  "verifyOnly": "PASSED",
  "backupResult": "COMPLETE",
  "status": "LOCAL_VERIFIED"
}
JSON
( cd "$SET" && find db -type f -name '*.bak' -exec sha256sum {} + | LC_ALL=C sort -k2 > SHA256SUMS \
  && sha256sum manifest.json counts.txt uploads.sha256 >> SHA256SUMS \
  && { ls uploads-*.tar.gz >/dev/null 2>&1 && sha256sum uploads-*.tar.gz >> SHA256SUMS || true; } )
STAGE="checksum"; SD_ERR_CODE=E_CHECKSUM
( cd "$SET" && sha256sum -c --quiet SHA256SUMS ) || die "SHA-256 del conjunto no coincide tras escribirlo"
find "$SET" -type f -exec chmod 600 {} + 2>/dev/null || true
: > "$SET/.complete"
ok "conjunto local verificado: $SET"

# ------------------------------------------------------------- 7. rotación local
rotate_local() {
  local keep="$1" n=0 d
  for d in $(find "$BACKUP_DIR/sets" -mindepth 1 -maxdepth 1 -type d -name 'sd-20*' | LC_ALL=C sort -r); do
    [ -f "$d/.complete" ] || continue
    n=$((n + 1))
    if [ "$n" -gt "$keep" ] && [ "$d" != "$SET" ]; then rm -rf "$d"; log "rotación local: eliminado $(basename "$d")"; fi
  done
}

# ------------------------------------------------------------- 8. copia externa
if [ "$OFFSITE" = 1 ]; then
  STAGE="restic"
  set +e
  "$SCRIPTS/backup/restic-backup.sh" --set "$SET" --uploads "${UP_TYPE:-none}|${UP_NAME:-$UP_SRC}"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    code="$(grep '^code=' "$SET/offsite-status" 2>/dev/null | cut -d= -f2)"
    sd_status_write "$STATUS_FILE" FAILED "${code:-E_S3_UPLOAD}" "backup local correcto; falló la copia cifrada externa" "$BID"
    sd_heartbeat fail
    rotate_local "$LOCAL_KEEP"
    warn "El conjunto local es válido pero NO hay copia externa de esta ejecución"
    exit 4
  fi
  snap="$(grep '^snapshot=' "$SET/offsite-status" | cut -d= -f2)"
  sd_status_write "$STATUS_FILE" OK OK "local verificado + snapshot cifrado $snap" "$BID"
  sd_heartbeat ok
  rotate_local "$LOCAL_KEEP"
  ok "Backup completo $BID → snapshot $snap ($(( $(date +%s) - T0 ))s)"
  exit 0
fi

rotate_local "$LOCAL_KEEP"
if [ "$REQUIRE_OFFSITE" = "true" ]; then
  warn "Sin repositorio externo configurado ($SD_BACKUP_ENV): el backup SOLO existe en este disco."
  sd_status_write "$STATUS_FILE" NO_OFFSITE E_NO_OFFSITE "backup local correcto, sin copia externa" "$BID"
  exit 3
fi
sd_status_write "$STATUS_FILE" OK OK "solo local (BACKUP_REQUIRE_OFFSITE=false)" "$BID"
ok "Backup local completo: $SET"
