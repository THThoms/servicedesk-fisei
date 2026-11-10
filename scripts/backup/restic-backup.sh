#!/usr/bin/env bash
# =============================================================================
# scripts/backup/restic-backup.sh — sube un conjunto YA VERIFICADO a Restic
#
#   scripts/backup/restic-backup.sh --set <dir del conjunto> [--uploads "volume|<nombre>" | "bind||<ruta>"]
#
# Lo invoca scripts/backup-mssql.sh (no hace falta llamarlo a mano). Restic cifra
# en el cliente (AES-256 + Poly1305) ANTES de enviar nada; el bucket solo recibe
# paquetes cifrados.
#
# Contenido del snapshot (rutas fijas, idénticas en cualquier servidor):
#   /servicedesk-backup/            ← el conjunto (db/*.bak, manifest.json, counts.txt,
#                                     uploads.sha256, SHA256SUMS, config/)
#   /servicedesk-backup/uploads/    ← el volumen REAL de imágenes, de solo lectura
# Etiquetas: servicedesk · backup-id=<ID> · host lógico $RESTIC_SNAPSHOT_HOST.
#
# Después del backup VERIFICA el snapshot: SHA256SUMS descargado = local, las 3
# bases presentes y el número de imágenes. Resultado en <set>/offsite-status.
# Salida: 0 OK · 2 configuración · 4 fallo de repositorio/subida/verificación
# =============================================================================
set -euo pipefail
SD_LOG_TAG="restic-backup"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
. "$SD_DIR/scripts/lib/backup.sh"

SET=""; UPLOADS="none|"
while [ $# -gt 0 ]; do
  case "$1" in
    --set) SET="$2"; shift 2;;
    --uploads) UPLOADS="$2"; shift 2;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    *) die "Opción desconocida: $1" 2;;
  esac
done
[ -n "$SET" ] && [ -f "$SET/.complete" ] && [ -f "$SET/SHA256SUMS" ] || die "--set debe ser un conjunto completo y verificado (falta .complete o SHA256SUMS)" 2
BID="$(sed -n 's/.*"backupId": "\([^"]*\)".*/\1/p' "$SET/manifest.json" | head -n1)"
[ -n "$BID" ] || die "manifest.json sin backupId" 2
OUT="$SET/offsite-status"; SD_ERR_CODE=E_S3_UPLOAD
finish() { local rc=$?; [ "$rc" -ne 0 ] && printf 'code=%s\nbackup_id=%s\nfinished=%s\n' "$SD_ERR_CODE" "$BID" "$(date -u +%FT%TZ)" > "$OUT"; rm -f "${SD_RESTIC_ERR:-}" "${JSON:-}"; }
trap finish EXIT

sd_backup_load
sd_backup_validate

# 1) repositorio accesible, inicializado y la clave lo abre
set +e; sd_restic_preflight; rc=$?; set -e
if [ "$rc" -ne 0 ]; then SD_ERR_CODE="$(sd_restic_classify "$rc")"; die "Repositorio no disponible: $(sd_restic_explain "$SD_ERR_CODE")" 4; fi

# 2) montajes de solo lectura
SD_RESTIC_MOUNTS=(-v "$(sd_hostpath "$SET"):/servicedesk-backup:ro")
IFS='|' read -r utype uname usrc <<<"$UPLOADS"
case "$utype" in
  volume) [ -n "$uname" ] && SD_RESTIC_MOUNTS+=(-v "$uname:/servicedesk-backup/uploads:ro");;
  bind)   [ -n "$usrc" ] && SD_RESTIC_MOUNTS+=(-v "$(sd_hostpath "$usrc"):/servicedesk-backup/uploads:ro");;
  *) warn "Sin origen de imágenes: el snapshot no incluirá uploads/";;
esac

# 3) backup
log "Subiendo $BID (cifrado en el cliente) → $(printf '%s' "$RESTIC_REPOSITORY" | sed -E 's#^s3:(https?://[^/]+)/.*#\1#')"
JSON="$(mktemp)"
t1="$(date +%s)"
set +e
sd_restic backup /servicedesk-backup --host "$RESTIC_SNAPSHOT_HOST" --tag servicedesk --tag "backup-id=$BID" --json > "$JSON"
rc=$?
set -e
if [ "$rc" -ne 0 ]; then SD_ERR_CODE="$(sd_restic_classify "$rc")"; [ "$SD_ERR_CODE" = E_RESTIC ] && SD_ERR_CODE=E_S3_UPLOAD; die "restic backup falló: $(sd_restic_explain "$SD_ERR_CODE")" 4; fi
summary="$(grep '"message_type":"summary"' "$JSON" | tail -n1)"
snap="$(printf '%s' "$summary" | sed -n 's/.*"snapshot_id":"\([0-9a-f]*\)".*/\1/p')"
added="$(printf '%s' "$summary" | sed -n 's/.*"data_added":\([0-9]*\).*/\1/p')"
packed="$(printf '%s' "$summary" | sed -n 's/.*"data_added_packed":\([0-9]*\).*/\1/p')"
files_new="$(printf '%s' "$summary" | sed -n 's/.*"files_new":\([0-9]*\).*/\1/p')"
[ -n "$snap" ] || { SD_ERR_CODE=E_S3_UPLOAD; die "restic no devolvió el id del snapshot" 4; }
ok "snapshot $snap · datos nuevos ${added:-?} bytes (subidos tras comprimir: ${packed:-?}) · archivos nuevos ${files_new:-?} · $(( $(date +%s) - t1 ))s"

# 4) verificación del snapshot recién creado (lee del repositorio, no del disco local)
SD_ERR_CODE=E_SNAPSHOT_VERIFY; SD_RESTIC_MOUNTS=()
remote_sums="$(sd_restic dump "$snap" /servicedesk-backup/SHA256SUMS)" || die "No se pudo leer SHA256SUMS del snapshot" 4
[ "$remote_sums" = "$(cat "$SET/SHA256SUMS")" ] || die "SHA256SUMS del snapshot difiere del conjunto local" 4
listing="$(sd_restic ls --json "$snap")" || die "No se pudo listar el snapshot" 4
for db in $(sd_db_names); do
  printf '%s\n' "$listing" | grep '"type":"file"' | grep -q "\"path\":\"/servicedesk-backup/db/$db-[^\"]*\.bak\"" || die "El snapshot no contiene el backup de $db" 4
done
exp_up="$(grep -c . "$SET/uploads.sha256" || true)"
got_files="$(printf '%s\n' "$listing" | grep '"type":"file"' | grep -c '"path":"/servicedesk-backup/uploads/' || true)"
[ "$got_files" -ge "$exp_up" ] || die "El snapshot tiene $got_files imágenes; se esperaban al menos $exp_up" 4
ok "snapshot verificado: SHA256SUMS idéntico, 3 bases, $got_files imágenes"

printf 'code=OK\nsnapshot=%s\nbackup_id=%s\nfinished=%s\ndata_added=%s\ndata_added_packed=%s\n' "$snap" "$BID" "$(date -u +%FT%TZ)" "${added:-}" "${packed:-}" > "$OUT"
chmod 600 "$OUT" 2>/dev/null || true
