#!/usr/bin/env bash
# =============================================================================
# scripts/backup/restic-test-connection.sh — diagnóstico del repositorio externo
#
#   sudo scripts/backup/restic-test-connection.sh
#
# Muestra el ESTADO de cada variable (CONFIGURADA / VACÍA), nunca su valor, y
# distingue: configuración incompleta · sin TLS · endpoint inaccesible · TLS ·
# credenciales S3 inválidas · repositorio sin inicializar · clave Restic incorrecta.
# Salida: 0 conexión y clave correctas · 10 accesible pero sin inicializar ·
#         2 configuración · 1 cualquier otro fallo (con el motivo)
# =============================================================================
set -euo pipefail
SD_LOG_TAG="restic-test"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
. "$SD_DIR/scripts/lib/backup.sh"
sd_backup_load

st() { [ -n "${!1:-}" ] && echo CONFIGURADA || echo VACÍA; }
echo "Archivo de configuración: $SD_BACKUP_ENV ($([ -f "$SD_BACKUP_ENV" ] && echo existe || echo NO existe))"
for k in RESTIC_REPOSITORY RESTIC_PASSWORD_FILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY B2_S3_ENDPOINT B2_BUCKET B2_REGION RESTIC_CACERT BACKUP_HEARTBEAT_URL; do
  printf '   %-24s %s\n' "$k" "$(st "$k")"
done
printf '   %-24s %s\n' RESTIC_IMAGE "$RESTIC_IMAGE" RESTIC_SNAPSHOT_HOST "$RESTIC_SNAPSHOT_HOST" RESTIC_DOCKER_NETWORK "$RESTIC_DOCKER_NETWORK"
[ -n "$RESTIC_REPOSITORY" ] && echo "   endpoint: $(printf '%s' "$RESTIC_REPOSITORY" | sed -E 's#^s3:(https?://[^/]+)/.*#\1#')"

sd_backup_validate
docker image inspect "$RESTIC_IMAGE" >/dev/null 2>&1 || { log "Descargando $RESTIC_IMAGE"; docker pull -q "$RESTIC_IMAGE" >/dev/null; }
set +e; sd_restic_preflight; rc=$?; set -e
code="$(sd_restic_classify "$rc")"
case "$code" in
  OK) ok "Conexión correcta: credenciales S3 válidas, repositorio inicializado y la clave Restic lo abre"
      n="$(sd_restic snapshots --json --tag servicedesk 2>/dev/null | { grep -o '"short_id"' || true; } | wc -l | tr -d ' ')"
      ok "snapshots de ServiceDesk en el repositorio: $n"; exit 0;;
  E_REPO_NOT_INIT) warn "Endpoint y credenciales aceptados, pero el repositorio NO está inicializado → scripts/backup/restic-init.sh"; exit 10;;
  *) die "Fallo de conexión [$code]: $(sd_restic_explain "$code")" 1;;
esac
