#!/usr/bin/env bash
# ServiceDesk UTA — notificación de fallo (servicedesk-alert@.service, vía OnFailure=).
#
# Independiente del sistema de backup: no usa Restic, ni el repositorio, ni la
# base de datos; solo lee los archivos de estado (key=value, sin secretos) y
# notifica por canales que no dependen de lo que ha fallado:
#   · siempre: journal (prioridad err) + /var/log/servicedesk-alerts.log
#   · BACKUP_ALERT_EMAIL + comando `mail` (MTA del host) → correo
#   · BACKUP_ALERT_WEBHOOK_URL (deploy/server/.env) → POST JSON (Slack/Teams/ntfy…)
# Complemento recomendado: BACKUP_HEARTBEAT_URL en backup.env (healthchecks.io,
# Uptime Kuma push…): avisa aunque el servidor entero haya caído.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
unit="${1:-desconocida}"
dir="$(sd_env_get BACKUP_DIR /var/backups/servicedesk)"
case "$unit" in
  *restore-drill*) sf="$dir/last-drill";;
  *retention*) sf="$dir/last-retention";;
  *verify*) sf="$dir/last-restic-check";;
  *) sf="$dir/last-status";;
esac
code="$(grep '^code=' "$sf" 2>/dev/null | cut -d= -f2)"; detail="$(grep '^detail=' "$sf" 2>/dev/null | cut -d= -f2-)"
case "$code" in
  E_NO_SPACE) why="falta de espacio en disco";;
  E_VERIFYONLY) why="RESTORE VERIFYONLY falló";;
  E_CHECKSUM) why="checksum SHA-256 incorrecto";;
  E_BACKUP) why="fallo de BACKUP DATABASE o de la preparación del conjunto";;
  E_NO_CONTAINER) why="SQL Server no está en ejecución";;
  E_UPLOADS) why="fallo al respaldar las imágenes";;
  E_REPO_UNREACHABLE) why="repositorio externo no accesible";;
  E_REPO_CREDENTIALS) why="credenciales S3 inválidas";;
  E_REPO_PASSWORD) why="la clave Restic no abre el repositorio";;
  E_REPO_TLS) why="error TLS con el almacenamiento externo";;
  E_REPO_NOT_INIT) why="repositorio externo no inicializado";;
  E_S3_UPLOAD|E_SNAPSHOT_VERIFY) why="fallo de copia o verificación en S3";;
  E_NO_RECENT_SNAPSHOT) why="no hay snapshot externo reciente";;
  E_REPO_CHECK) why="restic check encontró errores";;
  E_DRILL) why="falló la restauración de prueba";;
  E_NO_OFFSITE) why="backup sin copia externa";;
  E_CONFIG) why="configuración de backup incompleta o insegura";;
  "") why="sin archivo de estado (ver journal)";;
  *) why="$code";;
esac
msg="ServiceDesk UTA en $(hostname): '$unit' FALLÓ a las $(date -u +%FT%TZ) — $why. ${detail:+Detalle: $detail}"
logger -p user.err -t servicedesk-alert "$msg" 2>/dev/null || true
echo "$msg" >> /var/log/servicedesk-alerts.log 2>/dev/null || true
to="$(sd_env_get BACKUP_ALERT_EMAIL "")"
if [ -n "$to" ] && command -v mail >/dev/null 2>&1; then
  printf '%s\n\nRevisar: journalctl -u %s -n 100\n' "$msg" "$unit" | mail -s "[ServiceDesk] FALLO $unit" "$to" || true
fi
hook="$(sd_env_get BACKUP_ALERT_WEBHOOK_URL "")"
if [ -n "$hook" ] && command -v curl >/dev/null 2>&1; then
  body="$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  curl -fsS -m 10 --retry 2 -H 'Content-Type: application/json' -d "{\"text\":\"$body\"}" -o /dev/null "$hook" 2>/dev/null || true
fi
echo "$msg"
