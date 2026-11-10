#!/usr/bin/env bash
# =============================================================================
# scripts/backup/restore-drill.sh — recuperación de PRUEBA automática y verificable
#
#   scripts/backup/restore-drill.sh [--snapshot latest|<id>] [--mode ephemeral|instance] [--keep-files]
#
#   SNAPSHOT RESTIC ─► restic restore --verify ─► directorio temporal (700)
#      ─► SHA-256 del conjunto e imágenes ─► SQL Server de pruebas
#      ─► RESTORE DATABASE como auth_db_restore_verify, catalog_db_restore_verify,
#         ticket_db_restore_verify ─► DBCC CHECKDB ─► conteos de 13 tablas
#      ─► relaciones (dentro y entre bases) ─► adjuntos ↔ archivos ─► informe JSON
#
# Modos de SQL Server:
#   ephemeral (por defecto) contenedor SQL Server NUEVO, sin red (--network none),
#             que se destruye al terminar. Independiente de producción.
#   instance  la instancia de este servidor, con nombres *_restore_verify
#             (menos RAM; las bases principales no se tocan).
#
# Garantías: nunca usa los nombres de las bases principales; solo elimina las
# bases *_restore_verify que él mismo crea y el contenedor efímero que él mismo
# arranca; borra el directorio temporal (contiene secretos) salvo --keep-files.
# Informe: $BACKUP_DIR/drills/drill-<UTC>.json · estado: $BACKUP_DIR/last-drill
# Salida: 0 PASS · 1 FAIL (con el motivo) · 2 configuración
# =============================================================================
set -euo pipefail
SD_LOG_TAG="restore-drill"
SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$SCRIPTS/lib/common.sh"
. "$SCRIPTS/lib/backup.sh"
SNAP=latest; MODE="${DRILL_MODE:-$(sd_env_get DRILL_MODE ephemeral)}"; KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot) SNAP="$2"; shift 2;;
    --mode) MODE="$2"; shift 2;;
    --keep-files) KEEP=1; shift;;
    -h|--help) sed -n '2,25p' "$0"; exit 0;;
    *) die "Opción desconocida: $1" 2;;
  esac
done
case "$MODE" in ephemeral|instance) ;; *) die "--mode debe ser ephemeral o instance" 2;; esac
BACKUP_DIR="${BACKUP_DIR:-$(sd_env_get BACKUP_DIR /var/backups/servicedesk)}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$BACKUP_DIR/drill/$TS"; FILES="$WORK/files"
REPORT_DIR="$BACKUP_DIR/drills"; REPORT="$REPORT_DIR/drill-$TS.json"; STATUS="$BACKUP_DIR/last-drill"
SUFFIX="_restore_verify"
read -r A C T <<<"$(sd_db_names)"
EPH=""; CREATED=(); INNER=""; FAILS=(); WARNS=()
T0="$(date +%s)"
umask 077; mkdir -p "$WORK" "$REPORT_DIR"; chmod 700 "$BACKUP_DIR/drill" "$WORK" 2>/dev/null || true

cleanup() {
  local rc=$? db
  if [ -n "${SD_QUERY_CONTAINER:-}" ]; then
    if [ -z "$EPH" ]; then   # modo instance: solo las bases que creó este drill
      for db in "${CREATED[@]}"; do
        case "$db" in *"$SUFFIX") sd_query "IF DB_ID(N'$db') IS NOT NULL BEGIN ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$db]; END" >/dev/null 2>&1 || warn "No se pudo eliminar $db";; esac
      done
    fi
    [ -n "$INNER" ] && docker exec "$SD_QUERY_CONTAINER" rm -rf "$INNER" >/dev/null 2>&1 || true
  fi
  [ -n "$EPH" ] && docker rm -f -v "$EPH" >/dev/null 2>&1 || true
  if [ "$KEEP" = 0 ]; then rm -rf "$WORK"; fi
  if [ "$rc" -ne 0 ] && [ ! -f "$REPORT" ]; then
    sd_status_write "$STATUS" FAILED E_DRILL "drill abortado (exit $rc)"; sd_heartbeat fail
  fi
  rm -f "${SD_RESTIC_ERR:-}"
}
trap cleanup EXIT
fail() { FAILS+=("$*"); printf '  ✘ %s\n' "$*" >&2; }

# ------------------------------------------------------------ 1. snapshot → archivos
log "Drill $TS · snapshot $SNAP · modo $MODE"
t1="$(date +%s)"
"$SCRIPTS/backup/restic-restore.sh" --snapshot "$SNAP" --target "$FILES"
T_FILES=$(( $(date +%s) - t1 ))
SNAP_ID="$(sed -n 's/^snapshot=//p' "$FILES/.restored-from")"
BID="$(sed -n 's/.*"backupId": "\([^"]*\)".*/\1/p' "$FILES/manifest.json" | head -n1)"
SRC_TS="$(sed -n 's/.*"timestampUtc": "\([^"]*\)".*/\1/p' "$FILES/manifest.json" | head -n1)"
SRC_MISSING="$(sed -n 's/.*"rowsWithoutFile": \([0-9]*\).*/\1/p' "$FILES/manifest.json" | head -n1)"

# ------------------------------------------------------------ 2. SQL Server de pruebas
if [ "$MODE" = ephemeral ]; then
  EPH="sd-restore-drill-$(printf '%s' "$TS" | tr 'A-Z' 'a-z')"
  img="${DRILL_MSSQL_IMAGE:-$(sd_env_get MSSQL_IMAGE mcr.microsoft.com/mssql/server:2022-latest)}"
  log "Arrancando SQL Server efímero aislado ($img, ${DRILL_MSSQL_PID:-Express}, sin red)"
  ( set +o pipefail; export MSSQL_SA_PASSWORD="Dr$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom 2>/dev/null | head -c 24)_9x"
    docker run -d --name "$EPH" --network none --label servicedesk.restore-drill=1 \
      --memory "${DRILL_MSSQL_MEMORY:-2g}" -e ACCEPT_EULA=Y -e "MSSQL_PID=${DRILL_MSSQL_PID:-Express}" \
      -e MSSQL_SA_PASSWORD "$img" >/dev/null )
  SD_QUERY_CONTAINER="$EPH"
  for i in $(seq 1 60); do sd_query "SELECT 1;" >/dev/null 2>&1 && break; sleep 4; done
  sd_query "SELECT 1;" >/dev/null 2>&1 || die "El SQL Server efímero no arrancó"
else
  SD_QUERY_CONTAINER="$(sd_container mssql)"; [ -n "$SD_QUERY_CONTAINER" ] || die "No se encontró el SQL Server de esta instalación" 2
fi
export SD_QUERY_CONTAINER
EDITION="$(sd_query "SELECT CAST(SERVERPROPERTY('Edition') AS nvarchar(128));" | tr -d '\r' | head -n1)"
ok "SQL Server de pruebas: $EDITION"

# ------------------------------------------------------------ 3. RESTORE *_restore_verify
INNER="$(sd_mssql_path backup)/_drill_$TS"
docker exec "$SD_QUERY_CONTAINER" mkdir -p "$INNER"
t1="$(date +%s)"; CHECKDB=PASSED
for db in $A $C $T; do
  tgt="$db$SUFFIX"
  case " $A $C $T " in *" $tgt "*) die "El nombre de prueba $tgt coincide con una base principal" 2;; esac
  bak="$(find "$FILES/db" -maxdepth 1 -name "$db-*.bak" | head -n1)"; [ -n "$bak" ] || die "El snapshot no contiene $db"
  if [ "$(sd_query "SELECT CASE WHEN DB_ID(N'$tgt') IS NULL THEN 0 ELSE 1 END;" | tr -d '\r' | head -n1)" = 1 ]; then
    warn "$tgt existe (resto de un drill anterior): se elimina"
    sd_query "ALTER DATABASE [$tgt] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$tgt];" >/dev/null
  fi
  docker exec -i "$SD_QUERY_CONTAINER" bash -c "cat > '$INNER/$(basename "$bak")'" < "$bak"
  CREATED+=("$tgt")
  sd_restore_database "$INNER/$(basename "$bak")" "$tgt" 0
  if sd_query "DBCC CHECKDB (N'$tgt') WITH NO_INFOMSGS;" >/dev/null; then ok "$tgt restaurada · DBCC CHECKDB correcto"
  else CHECKDB=FAILED; fail "DBCC CHECKDB con errores en $tgt"; fi
done
T_SQL=$(( $(date +%s) - t1 ))

# ------------------------------------------------------------ 4. conteos
declare -A EXP REL GOT
while IFS= read -r line; do
  case "$line" in \#*|"") continue;; esac
  k="${line%%=*}"; v="${line#*=}"
  case "$k" in fk_*|xref_*) REL[$k]="$v";; *) EXP[$k]="$v";; esac
done < "$FILES/counts.txt"
while IFS= read -r line; do line="${line%$'\r'}"; [ -n "$line" ] && GOT["${line%%=*}"]="${line#*=}"; done \
  < <(sd_query "$(sd_counts_sql "$A$SUFFIX" "$C$SUFFIX" "$T$SUFFIX")")
COUNTS_JSON=""
for spec in $SD_COUNT_TABLES; do
  k="${spec#*:}"; read -r b a <<<"${EXP[$k]:-x x}"; r="${GOT[$k]:-x}"
  lo=$b; hi=$a; [ "$b" -gt "$a" ] 2>/dev/null && { lo=$a; hi=$b; }
  okc=false
  if [ "$r" != x ] && [ "$b" != x ] && [ "$r" -ge "$lo" ] && [ "$r" -le "$hi" ]; then okc=true; else fail "conteo $k: restaurado $r, esperado $lo..$hi"; fi
  exp="$lo"; [ "$lo" = "$hi" ] || exp="$lo..$hi"
  [ -n "$COUNTS_JSON" ] && COUNTS_JSON+=","
  COUNTS_JSON+=$'\n    '"\"$k\": {\"expected\": \"$exp\", \"restored\": $r, \"ok\": $okc}"
done
ok "conteos comparados: ${#GOT[@]} tablas"

# ------------------------------------------------------------ 5. relaciones
REL_JSON=""
while IFS= read -r line; do
  line="${line%$'\r'}"; [ -n "$line" ] || continue
  k="${line%%=*}"; r="${line#*=}"; src="${REL[$k]:-}"; okr=true
  case "$k" in
    fk_*) [ "$r" = 0 ] || { okr=false; fail "relación $k: $r filas huérfanas"; };;
    xref_*) if [ -z "$src" ] || [ "$r" -gt "$src" ]; then okr=false; fail "referencia entre bases $k: $r (origen ${src:-?})"; fi
            [ "$r" = 0 ] || WARNS+=("$k=$r (igual que en el origen)");;
  esac
  [ -n "$REL_JSON" ] && REL_JSON+=","
  REL_JSON+=$'\n    '"\"$k\": {\"restored\": $r, \"source\": ${src:-null}, \"ok\": $okr}"
done < <(sd_query "$(sd_relations_sql "$A$SUFFIX" "$C$SUFFIX" "$T$SUFFIX")")
ok "relaciones verificadas (dentro y entre las 3 bases)"

# ------------------------------------------------------------ 6. adjuntos ↔ imágenes
( cd "$FILES/uploads" 2>/dev/null && find . -type f | sed 's#^\./##' | LC_ALL=C sort ) > "$WORK/.files" || : > "$WORK/.files"
sd_query "$(sd_attachments_sql "$T$SUFFIX")" | tr -d '\r' | grep '|' > "$WORK/.att" || true
grep '^local|' "$WORK/.att" | cut -d'|' -f2 | sed 's#.*/##' | LC_ALL=C sort -u > "$WORK/.names" || true
ATT_LOCAL="$(grep -c . "$WORK/.names" || true)"; ATT_EXT="$(grep -vc '^local|' "$WORK/.att" || true)"
MISSING="$(LC_ALL=C comm -23 "$WORK/.names" "$WORK/.files" | grep -c . || true)"
ORPHANS="$(LC_ALL=C comm -13 "$WORK/.names" "$WORK/.files" | grep -c . || true)"
FILES_N="$(grep -c . "$WORK/.files" || true)"
SUMS_N="$(grep -c . "$FILES/uploads.sha256" || true)"
[ "$FILES_N" -ge "$SUMS_N" ] || fail "imágenes restauradas $FILES_N < registradas $SUMS_N"
if [ "$MISSING" -gt "${SRC_MISSING:-0}" ]; then fail "$MISSING adjunto(s) sin archivo tras restaurar (en el origen: ${SRC_MISSING:-0})"; fi
[ "$ORPHANS" = 0 ] || WARNS+=("$ORPHANS archivo(s) huérfano(s) sin fila en attachments (no se eliminan)")
[ "$ATT_EXT" = 0 ] || WARNS+=("$ATT_EXT adjunto(s) en almacenamiento externo: no verificables desde el backup")
ok "imágenes: $FILES_N archivos (SHA-256 verificado) · adjuntos locales $ATT_LOCAL · sin archivo $MISSING · huérfanos $ORPHANS"

# ------------------------------------------------------------ 7. informe
RESULT=PASS; [ "${#FAILS[@]}" -eq 0 ] || RESULT=FAIL
arr() { local out="" x; for x in "$@"; do [ -n "$out" ] && out+=", "; out+="$(sd_json_str "$x")"; done; printf '[%s]' "$out"; }
cat > "$REPORT" <<JSON
{
  "drill": "$TS",
  "result": "$RESULT",
  "snapshot": "$SNAP_ID",
  "backupId": $(sd_json_str "$BID"),
  "backupTimestampUtc": $(sd_json_str "$SRC_TS"),
  "mode": "$MODE",
  "sqlServerEdition": $(sd_json_str "$EDITION"),
  "restoredDatabases": $(arr "${CREATED[@]}"),
  "durationsSeconds": {"resticRestoreAndVerify": $T_FILES, "sqlRestoreAndCheckdb": $T_SQL, "total": $(( $(date +%s) - T0 ))},
  "checkdb": "$CHECKDB",
  "counts": {$COUNTS_JSON
  },
  "relations": {$REL_JSON
  },
  "images": {"restoredFiles": $FILES_N, "checksumListed": $SUMS_N, "localAttachmentRows": $ATT_LOCAL, "externalAttachmentRows": $ATT_EXT, "rowsWithoutFile": $MISSING, "rowsWithoutFileAtSource": ${SRC_MISSING:-0}, "orphanFiles": $ORPHANS},
  "failures": $(arr "${FAILS[@]}"),
  "warnings": $(arr "${WARNS[@]}")
}
JSON
chmod 600 "$REPORT" 2>/dev/null || true
if [ "$RESULT" = PASS ]; then
  sd_status_write "$STATUS" OK OK "drill PASS snapshot ${SNAP_ID:0:8} backup $BID ($(( $(date +%s) - T0 ))s)" "$BID"
  ok "RESTORE DRILL PASS · informe $REPORT"
else
  sd_status_write "$STATUS" FAILED E_DRILL "drill FAIL: ${FAILS[0]}" "$BID"
  sd_heartbeat fail
  die "RESTORE DRILL FAIL (${#FAILS[@]} fallo(s)) · informe $REPORT" 1
fi
