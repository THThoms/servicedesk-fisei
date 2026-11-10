#!/usr/bin/env bash
# =============================================================================
# scripts/backup/restic-check.sh — comprueba el repositorio y los snapshots
#
#   scripts/backup/restic-check.sh --quick     # cada 6 h: accesible + último snapshot reciente
#   scripts/backup/restic-check.sh             # semanal: estructura + lee $RESTIC_CHECK_SUBSET (5 %) de los datos
#   scripts/backup/restic-check.sh --full      # bajo demanda: lee y descifra TODOS los datos
#   scripts/backup/restic-check.sh --unlock    # elimina SOLO bloqueos huérfanos (restic unlock)
#
# "Reciente" = el último snapshot con etiqueta servicedesk del host lógico
# $RESTIC_SNAPSHOT_HOST tiene menos de MAX_AGE_HOURS (26) horas.
# Estado en $BACKUP_DIR/last-restic-check. Salida: 0 OK · 1 fallo · 2 configuración
# =============================================================================
set -euo pipefail
SD_LOG_TAG="restic-check"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
. "$SD_DIR/scripts/lib/backup.sh"
MODE=standard
case "${1:-}" in --quick) MODE=quick;; --full) MODE=full;; --unlock) MODE=unlock;; "") ;; -h|--help) sed -n '2,13p' "$0"; exit 0;; *) die "Opción desconocida: $1" 2;; esac
BACKUP_DIR="${BACKUP_DIR:-$(sd_env_get BACKUP_DIR /var/backups/servicedesk)}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
STATUS="$BACKUP_DIR/last-restic-check"; mkdir -p "$BACKUP_DIR"
SD_ERR_CODE=E_RESTIC
trap 'rc=$?; [ $rc -ne 0 ] && sd_status_write "$STATUS" FAILED "$SD_ERR_CODE" "restic-check $MODE"; rm -f "${SD_RESTIC_ERR:-}"' EXIT

sd_backup_load
sd_backup_validate

set +e; sd_restic_preflight; rc=$?; set -e
if [ "$rc" -ne 0 ]; then SD_ERR_CODE="$(sd_restic_classify "$rc")"; die "Repositorio no accesible: $(sd_restic_explain "$SD_ERR_CODE")"; fi

if [ "$MODE" = unlock ]; then
  sd_restic unlock >/dev/null && ok "bloqueos huérfanos eliminados (los de tareas activas se conservan)"; exit 0
fi

# Último snapshot (time en RFC3339; se compara en segundos UTC).
SD_ERR_CODE=E_NO_RECENT_SNAPSHOT
last="$(sd_restic snapshots --json --latest 1 --tag servicedesk --host "$RESTIC_SNAPSHOT_HOST" 2>/dev/null)"
t="$(printf '%s' "$last" | sed -n 's/.*"time":"\([^"]*\)".*/\1/p' | tail -n1)"
id="$(printf '%s' "$last" | sed -n 's/.*"short_id":"\([^"]*\)".*/\1/p' | tail -n1)"
total="$(sd_restic snapshots --json --tag servicedesk --host "$RESTIC_SNAPSHOT_HOST" 2>/dev/null | { grep -o '"short_id"' || true; } | wc -l | tr -d ' ')"
[ -n "$t" ] || die "No hay ningún snapshot de ServiceDesk (host lógico $RESTIC_SNAPSHOT_HOST)"
age_h=$(( ( $(date -u +%s) - $(date -u -d "$t" +%s) ) / 3600 ))
[ "$age_h" -le "$MAX_AGE_HOURS" ] || die "El último snapshot ($id) tiene ${age_h} h (máximo ${MAX_AGE_HOURS} h)"
ok "último snapshot $id de hace ${age_h} h · total $total"

if [ "$MODE" != quick ]; then
  SD_ERR_CODE=E_REPO_CHECK
  args=(); [ "$MODE" = full ] && args=(--read-data) || args=("--read-data-subset=$RESTIC_CHECK_SUBSET")
  log "restic check ${args[*]}"
  sd_restic check "${args[@]}" >/dev/null || die "restic check encontró errores en el repositorio"
  ok "integridad del repositorio correcta (${args[*]})"
fi
sd_status_write "$STATUS" OK OK "restic-check $MODE · último $id (${age_h} h) · total $total"
