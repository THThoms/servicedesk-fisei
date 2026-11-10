#!/usr/bin/env bash
# =============================================================================
# scripts/backup/restic-retention.sh — retención 14 diarios · 8 semanales · 12 mensuales
#
#   scripts/backup/restic-retention.sh --dry-run    # muestra qué se olvidaría
#   scripts/backup/restic-retention.sh              # aplica 'forget' (sin borrar datos)
#   scripts/backup/restic-retention.sh --prune      # aplica 'forget' y libera espacio
#
# Antes de tocar nada (si algo falla, NO se aplica la política):
#   1. el repositorio es accesible y 'restic check' (estructura) es correcto;
#   2. hay snapshots de ServiceDesk;
#   3. el último tiene menos de MAX_AGE_HOURS (26) h (--allow-stale para omitirlo
#      conscientemente, p. ej. tras una parada larga) y contiene manifest.json,
#      SHA256SUMS y las 3 bases.
# Después: el último snapshot sigue existiendo, el número de snapshots coincide
# con lo previsto y, si hubo --prune, se repite 'restic check'.
#
# Nunca se borra nada a mano: solo 'restic forget' con la política y
# --keep-last 1 (el último snapshot NUNCA se elimina).
# =============================================================================
set -euo pipefail
SD_LOG_TAG="restic-retention"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
. "$SD_DIR/scripts/lib/backup.sh"
PRUNE=0; DRY=0; STALE=0
while [ $# -gt 0 ]; do
  case "$1" in --prune) PRUNE=1;; --dry-run) DRY=1;; --allow-stale) STALE=1;; -h|--help) sed -n '2,20p' "$0"; exit 0;; *) die "Opción desconocida: $1" 2;; esac; shift
done
BACKUP_DIR="${BACKUP_DIR:-$(sd_env_get BACKUP_DIR /var/backups/servicedesk)}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"
STATUS="$BACKUP_DIR/last-retention"; mkdir -p "$BACKUP_DIR"
SD_ERR_CODE=E_RETENTION
trap 'rc=$?; [ $rc -ne 0 ] && [ "$DRY" = 0 ] && sd_status_write "$STATUS" FAILED "$SD_ERR_CODE" "retención no aplicada"; rm -f "${SD_RESTIC_ERR:-}"' EXIT
sd_backup_load
sd_backup_validate
FILTER=(--tag servicedesk --host "$RESTIC_SNAPSHOT_HOST")
ids() { sd_restic snapshots --json "${FILTER[@]}" 2>/dev/null | grep -o '"id":"[0-9a-f]\{64\}"' | cut -d'"' -f4; }

# 1) accesible + estructura
set +e; sd_restic_preflight; rc=$?; set -e
[ "$rc" -eq 0 ] || { SD_ERR_CODE="$(sd_restic_classify "$rc")"; die "Repositorio no accesible: $(sd_restic_explain "$SD_ERR_CODE")"; }
sd_restic check >/dev/null || { SD_ERR_CODE=E_REPO_CHECK; die "restic check falló: no se aplica la retención"; }
ok "repositorio íntegro (estructura)"

# 2) snapshots
mapfile -t before < <(ids)
[ "${#before[@]}" -gt 0 ] || die "No hay snapshots de ServiceDesk: nada que retener"
last_json="$(sd_restic snapshots --json --latest 1 "${FILTER[@]}" 2>/dev/null)"
last_id="$(printf '%s' "$last_json" | grep -o '"id":"[0-9a-f]\{64\}"' | tail -n1 | cut -d'"' -f4)"
last_t="$(printf '%s' "$last_json" | sed -n 's/.*"time":"\([^"]*\)".*/\1/p' | tail -n1)"

# 3) último snapshot reciente y completo
age_h=$(( ( $(date -u +%s) - $(date -u -d "$last_t" +%s) ) / 3600 ))
if [ "$age_h" -gt "$MAX_AGE_HOURS" ] && [ "$STALE" = 0 ]; then
  die "El último snapshot tiene ${age_h} h: no se aplica retención sin un backup reciente correcto (usa --allow-stale si es intencionado)"
fi
listing="$(sd_restic ls --json "$last_id")"
for f in manifest.json SHA256SUMS; do
  printf '%s\n' "$listing" | grep -q "\"path\":\"/servicedesk-backup/$f\"" || die "El último snapshot no contiene $f: no se aplica retención"
done
for db in $(sd_db_names); do
  printf '%s\n' "$listing" | grep -q "\"path\":\"/servicedesk-backup/db/$db-" || die "El último snapshot no contiene $db: no se aplica retención"
done
ok "último snapshot ${last_id:0:8} de hace ${age_h} h, completo · snapshots actuales: ${#before[@]}"

# 4) política
pol=(--keep-daily "$RESTIC_KEEP_DAILY" --keep-weekly "$RESTIC_KEEP_WEEKLY" --keep-monthly "$RESTIC_KEEP_MONTHLY" --keep-last 1 --group-by host,paths)
if [ "$DRY" = 1 ]; then
  sd_restic forget "${FILTER[@]}" "${pol[@]}" --dry-run --compact
  ok "dry-run: no se modificó nada"; exit 0
fi
log "forget ${pol[*]}$([ $PRUNE = 1 ] && echo ' --prune')"
sd_restic forget "${FILTER[@]}" "${pol[@]}" $([ "$PRUNE" = 1 ] && echo --prune) --compact >/dev/null

# 5) verificación del resultado
mapfile -t after < <(ids)
printf '%s\n' "${after[@]}" | grep -qx "$last_id" || { SD_ERR_CODE=E_RETENTION_LAST_LOST; die "¡El último snapshot ya no existe tras la retención!"; }
[ "${#after[@]}" -gt 0 ] && [ "${#after[@]}" -le "${#before[@]}" ] || die "Resultado inesperado de la retención"
if [ "$PRUNE" = 1 ]; then sd_restic check >/dev/null || { SD_ERR_CODE=E_REPO_CHECK; die "restic check falló después de prune"; }; fi
ok "retención aplicada: ${#before[@]} → ${#after[@]} snapshots (último conservado)"
sd_status_write "$STATUS" OK OK "retención ${#before[@]}→${#after[@]} prune=$PRUNE"
