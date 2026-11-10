#!/usr/bin/env bash
# =============================================================================
# scripts/restore-mssql.sh — Restauración de ServiceDesk UTA desde backups .bak
#
#   scripts/restore-mssql.sh --from /ruta/al/backup/<STAMP> [opciones]
#
# El directorio debe contener auth_db-*.bak, catalog_db-*.bak, ticket_db-*.bak
# (uno por base, en la raíz o en db/) y opcionalmente SHA256SUMS y las imágenes:
# uploads/ + uploads.sha256 (formato Fase S, restaurado de Restic) o
# uploads-*.tar.gz (formato anterior). También acepta backups del VPS anterior.
#
# Opciones:
#   --from DIR        directorio del backup (obligatorio)
#   --replace         permite SOBRESCRIBIR bases existentes (pide confirmación)
#   --with-uploads    restaura también las imágenes (uploads-*.tar.gz)
#   --yes             no pregunta (solo junto a --replace, para automatización)
#   --dry-run         valida y muestra lo que haría, sin restaurar
#
# Garantías:
#   · Verifica SHA256SUMS si existe, y RESTORE VERIFYONLY WITH CHECKSUM.
#   · Comprueba que la versión del backup sea compatible con el servidor.
#   · Sin --replace, ABORTA si alguna base ya existe (no mezcla instalaciones).
#   · Tras restaurar: DBCC CHECKDB + re-mapeo de usuarios (mssql-init) + conteos.
#   · NUNCA ejecuta seeds. NUNCA borra volúmenes.
# =============================================================================
set -euo pipefail
SD_LOG_TAG="restore-mssql"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

FROM=""; REPLACE=0; UPLOADS=0; YES=0; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; shift 2;;
    --replace) REPLACE=1; shift;;
    --with-uploads) UPLOADS=1; shift;;
    --yes) YES=1; shift;;
    --dry-run) DRY=1; shift;;
    -h|--help) sed -n '2,25p' "$0"; exit 0;;
    *) die "Opción desconocida: $1";;
  esac
done
[ -n "$FROM" ] && [ -d "$FROM" ] || die "Indica --from con un directorio de backup existente"

MSSQL_C="$(sd_container mssql)"; [ -n "$MSSQL_C" ] || die "SQL Server no está en ejecución (docker compose up -d mssql)"

# 1) Integridad de archivos
if [ -f "$FROM/SHA256SUMS" ]; then
  log "Verificando SHA256SUMS"
  ( cd "$FROM" && sha256sum -c --quiet SHA256SUMS ) || die "SHA-256 no coincide: backup corrupto o alterado"
  ok "SHA-256 correcto"
else
  warn "No hay SHA256SUMS en el backup: se confía solo en RESTORE VERIFYONLY"
fi

SERVER_MAJOR="$(sd_query "SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS int);" | tr -d '\r' | head -n1)"
EDITION="$(sd_query "SELECT CAST(SERVERPROPERTY('Edition') AS nvarchar(128));" | tr -d '\r' | head -n1)"
log "Servidor destino: $EDITION (versión mayor $SERVER_MAJOR)"

INNER="$(sd_mssql_path backup)/_restore_$(date -u +%Y%m%dT%H%M%SZ)"
trap 'docker exec "$MSSQL_C" rm -rf "$INNER" >/dev/null 2>&1 || true' EXIT
docker exec "$MSSQL_C" mkdir -p "$INNER"

declare -A BAK
for db in $(sd_db_names); do
  mapfile -t found < <(find "$FROM" "$FROM/db" -maxdepth 1 -type f -name "${db}-*.bak" 2>/dev/null | sort)
  [ "${#found[@]}" -eq 1 ] || die "Se esperaba exactamente 1 archivo ${db}-*.bak en $FROM (hay ${#found[@]})"
  BAK[$db]="${found[0]}"
  exists="$(sd_query "SELECT CASE WHEN DB_ID(N'$db') IS NULL THEN 0 ELSE 1 END;" | tr -d '\r' | head -n1)"
  if [ "$exists" = 1 ] && [ "$REPLACE" = 0 ]; then
    die "La base $db YA EXISTE. Para sobrescribirla usa --replace (operación destructiva)."
  fi
done

if [ "$REPLACE" = 1 ] && [ "$YES" = 0 ] && [ "$DRY" = 0 ]; then
  echo "${C_B}Vas a SOBRESCRIBIR las bases: $(sd_db_names)${C_0}"
  read -r -p "Escribe RESTAURAR para continuar: " ans
  [ "$ans" = "RESTAURAR" ] || die "Cancelado por el operador"
fi

for db in $(sd_db_names); do
  src="${BAK[$db]}"; name="$(basename "$src")"
  log "Validando $name"
  docker exec -i "$MSSQL_C" bash -c "cat > '$INNER/$name'" < "$src"
  sd_query "RESTORE VERIFYONLY FROM DISK = N'$INNER/$name' WITH CHECKSUM;" >/dev/null \
    || die "RESTORE VERIFYONLY falló para $name"
  bak_major="$(sd_query "SET NOCOUNT ON; DECLARE @h TABLE (BackupName nvarchar(128), BackupDescription nvarchar(255), BackupType smallint, ExpirationDate datetime, Compressed bit, Position smallint, DeviceType tinyint, UserName nvarchar(128), ServerName nvarchar(128), DatabaseName nvarchar(128), DatabaseVersion int, DatabaseCreationDate datetime, BackupSize numeric(20,0), FirstLSN numeric(25,0), LastLSN numeric(25,0), CheckpointLSN numeric(25,0), DatabaseBackupLSN numeric(25,0), BackupStartDate datetime, BackupFinishDate datetime, SortOrder smallint, CodePage smallint, UnicodeLocaleId int, UnicodeComparisonStyle int, CompatibilityLevel tinyint, SoftwareVendorId int, SoftwareVersionMajor int, SoftwareVersionMinor int, SoftwareVersionBuild int, MachineName nvarchar(128), Flags int, BindingID uniqueidentifier, RecoveryForkID uniqueidentifier, Collation nvarchar(128), FamilyGUID uniqueidentifier, HasBulkLoggedData bit, IsSnapshot bit, IsReadOnly bit, IsSingleUser bit, HasBackupChecksums bit, IsDamaged bit, BeginsLogChain bit, HasIncompleteMetaData bit, IsForceOffline bit, IsCopyOnly bit, FirstRecoveryForkID uniqueidentifier, ForkPointLSN numeric(25,0), RecoveryModel nvarchar(60), DifferentialBaseLSN numeric(25,0), DifferentialBaseGUID uniqueidentifier, BackupTypeDescription nvarchar(60), BackupSetGUID uniqueidentifier, CompressedBackupSize bigint, Containment tinyint, KeyAlgorithm nvarchar(32), EncryptorThumbprint varbinary(20), EncryptorType nvarchar(32), LastValidRestoreTime datetime, TimeZone nvarchar(32), CompressionAlgorithm nvarchar(32)); INSERT @h EXEC('RESTORE HEADERONLY FROM DISK = N''$INNER/$name'''); SELECT TOP 1 SoftwareVersionMajor FROM @h;" | tr -d '\r' | head -n1)"
  if [ -n "$bak_major" ] && [ "$bak_major" -gt "$SERVER_MAJOR" ] 2>/dev/null; then
    die "$name proviene de SQL Server $bak_major, más nuevo que el destino ($SERVER_MAJOR). No restaurable."
  fi
  ok "$name válido (origen SQL Server ${bak_major:-?})"
done

if [ "$DRY" = 1 ]; then ok "DRY-RUN: los 3 backups son restaurables. No se modificó nada."; exit 0; fi

for db in $(sd_db_names); do
  name="$(basename "${BAK[$db]}")"
  log "RESTORE $db"
  sd_restore_database "$INNER/$name" "$db" "$REPLACE"
  log "DBCC CHECKDB $db"
  sd_query "DBCC CHECKDB (N'$db') WITH NO_INFOMSGS;" >/dev/null || die "DBCC CHECKDB reportó errores en $db"
  ok "$db restaurada e íntegra"
done

if [ "$UPLOADS" = 1 ]; then
  tarball="$(find "$FROM" -maxdepth 1 -name 'uploads-*.tar.gz' | sort | tail -n1)"
  if [ -d "$FROM/uploads" ] && [ -n "$(find "$FROM/uploads" -type f | head -n1)" ]; then
    # Formato Fase S (snapshot Restic): directorio uploads/ + lista uploads.sha256
    if [ -f "$FROM/uploads.sha256" ]; then
      ( cd "$FROM/uploads" && sha256sum -c --quiet ../uploads.sha256 ) || die "Las imágenes no coinciden con uploads.sha256"
      ok "imágenes verificadas contra uploads.sha256"
    fi
    log "Restaurando imágenes adjuntas (directorio uploads/)"
    tar -C "$FROM/uploads" -cf - . | sd_compose run --rm --no-deps -T --entrypoint tar ticket-service xf - -C /app/uploads
    ok "imágenes restauradas ($(find "$FROM/uploads" -type f | wc -l | tr -d ' ') archivos)"
  elif [ -n "$tarball" ]; then
    log "Restaurando imágenes adjuntas"
    sd_compose run --rm --no-deps -T --entrypoint tar ticket-service xzf - -C /app < "$tarball"
    ok "imágenes restauradas ($(tar -tzf - < "$tarball" | grep -vc '/$' || true) archivos)"
  else
    warn "No se encontró uploads-*.tar.gz en $FROM"
  fi
fi

log "Re-mapeando logins/usuarios (mssql-init)"
if [ -z "${MSSQL_CONTAINER:-}" ]; then
  sd_compose run --rm --no-deps mssql-init >/dev/null
  ok "usuarios re-mapeados a los logins de este servidor"
else
  warn "MSSQL_CONTAINER definido: ejecuta manualmente el init de logins de esa instalación"
fi

A="$(sd_env_get AUTH_DB_NAME auth_db)"; C="$(sd_env_get CATALOG_DB_NAME catalog_db)"; T="$(sd_env_get TICKET_DB_NAME ticket_db)"
log "Conteos restaurados:"
sd_query "SELECT CONCAT('  users=', (SELECT COUNT(*) FROM [$A].dbo.users), ' services=', (SELECT COUNT(*) FROM [$C].dbo.services), ' knowledge=', (SELECT COUNT(*) FROM [$C].dbo.knowledge_articles), ' tickets=', (SELECT COUNT(*) FROM [$T].dbo.tickets), ' events=', (SELECT COUNT(*) FROM [$T].dbo.ticket_events), ' attachments=', (SELECT COUNT(*) FROM [$T].dbo.attachments));"
ok "Restauración completada. Arranca los servicios con RUN_SEED=false (lo hace install-server.sh)."
