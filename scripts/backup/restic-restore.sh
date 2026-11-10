#!/usr/bin/env bash
# =============================================================================
# scripts/backup/restic-restore.sh — recupera un snapshot cifrado a un directorio
#
#   scripts/backup/restic-restore.sh --list
#   scripts/backup/restic-restore.sh --snapshot latest|<id> --target <directorio nuevo>
#
# Restaura SOLO archivos (no toca bases ni volúmenes) en un directorio que no
# exista o esté vacío, y verifica:
#   · restic restore --verify (contenido descifrado = el del snapshot);
#   · SHA256SUMS del conjunto (bases, manifest, conteos, lista de imágenes);
#   · cada imagen contra uploads.sha256; config/SHA256SUMS si hay configuración.
# El resultado se usa con:
#   scripts/restore-mssql.sh --from <target> --with-uploads   (servidor nuevo)
#   scripts/backup/restore-drill.sh                            (prueba aislada)
# El directorio contiene secretos (config/server.env): queda con permisos 700.
# =============================================================================
set -euo pipefail
SD_LOG_TAG="restic-restore"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
. "$SD_DIR/scripts/lib/backup.sh"
SNAP=""; TARGET=""; LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot) SNAP="$2"; shift 2;;
    --target) TARGET="$2"; shift 2;;
    --list) LIST=1; shift;;
    -h|--help) sed -n '2,18p' "$0"; exit 0;;
    *) die "Opción desconocida: $1" 2;;
  esac
done
trap 'rm -f "${SD_RESTIC_ERR:-}"' EXIT
sd_backup_load
sd_backup_validate
FILTER=(--tag servicedesk); [ -n "${RESTORE_FROM_HOST:-}" ] && FILTER+=(--host "$RESTORE_FROM_HOST")

if [ "$LIST" = 1 ]; then sd_restic snapshots "${FILTER[@]}"; exit 0; fi
[ -n "$SNAP" ] && [ -n "$TARGET" ] || die "Uso: --snapshot latest|<id> --target <directorio>" 2
case "$TARGET" in
  /|/var/lib/docker*|/var/opt/mssql*|/etc*|/usr*|/bin*|/boot*) die "Destino no permitido: $TARGET" 2;;
esac
if [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then die "El destino $TARGET no está vacío: elige un directorio nuevo" 2; fi
( umask 077; mkdir -p "$TARGET" ); chmod 700 "$TARGET" 2>/dev/null || true

set +e; sd_restic_preflight; rc=$?; set -e
[ "$rc" -eq 0 ] || { c="$(sd_restic_classify "$rc")"; die "Repositorio no accesible [$c]: $(sd_restic_explain "$c")"; }

if [ "$SNAP" = latest ]; then
  SNAP="$(sd_restic snapshots --json --latest 1 "${FILTER[@]}" 2>/dev/null | grep -o '"id":"[0-9a-f]\{64\}"' | tail -n1 | cut -d'"' -f4)"
  [ -n "$SNAP" ] || die "No hay snapshots de ServiceDesk en el repositorio"
fi
log "Restaurando snapshot ${SNAP:0:8} → $TARGET"
t1="$(date +%s)"
SD_RESTIC_MOUNTS=(-v "$(sd_hostpath "$TARGET"):/restore")
sd_restic restore "$SNAP:/servicedesk-backup" --target /restore --verify >/dev/null \
  || die "restic restore falló o el contenido restaurado no coincide (--verify)"
SD_RESTIC_MOUNTS=()
ok "archivos restaurados y verificados por restic ($(( $(date +%s) - t1 ))s)"

[ -f "$TARGET/SHA256SUMS" ] || die "El snapshot no contiene SHA256SUMS: no es un conjunto de ServiceDesk"
( cd "$TARGET" && sha256sum -c --quiet SHA256SUMS ) || die "SHA-256 del conjunto restaurado NO coincide"
ok "SHA256SUMS correcto (bases, manifest, conteos, lista de imágenes)"
if [ -s "$TARGET/uploads.sha256" ]; then
  ( cd "$TARGET/uploads" && sha256sum -c --quiet ../uploads.sha256 ) || die "Alguna imagen restaurada no coincide con uploads.sha256"
  ok "imágenes: $(grep -c . "$TARGET/uploads.sha256") archivos idénticos al origen"
fi
if [ -f "$TARGET/config/SHA256SUMS" ]; then
  ( cd "$TARGET/config" && sha256sum -c --quiet SHA256SUMS ) || die "La configuración restaurada no coincide con su SHA256SUMS"
  ok "configuración: $(grep -c . "$TARGET/config/SHA256SUMS") archivos íntegros (contiene secretos: permisos 700)"
fi
find "$TARGET" -type f -exec chmod 600 {} + 2>/dev/null || true
printf 'snapshot=%s\nrestored=%s\n' "$SNAP" "$(date -u +%FT%TZ)" > "$TARGET/.restored-from"
ok "Snapshot ${SNAP:0:8} listo en $TARGET"
