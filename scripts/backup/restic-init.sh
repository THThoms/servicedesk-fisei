#!/usr/bin/env bash
# =============================================================================
# scripts/backup/restic-init.sh — inicializa el repositorio Restic cifrado
#
#   sudo scripts/backup/restic-init.sh --generate-password   # crea la clave (si no existe)
#   sudo scripts/backup/restic-init.sh                       # inicializa el repositorio
#
# --generate-password crea $RESTIC_PASSWORD_FILE con 64 caracteres aleatorios y
# permisos 600. NUNCA la imprime ni la registra. Ver la custodia en
# docs/operations/CUSTODIA_CLAVE_BACKUPS.md (la clave NO debe existir solo aquí).
#
# Idempotente y seguro: si el repositorio ya existe NO se reinicializa (eso
# crearía un repositorio nuevo e inaccesible para los snapshots anteriores).
# Salida: 0 inicializado o ya existente · 2 configuración · 1 otro error
# =============================================================================
set -euo pipefail
SD_LOG_TAG="restic-init"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
. "$SD_DIR/scripts/lib/backup.sh"
sd_backup_load

if [ "${1:-}" = "--generate-password" ]; then
  [ -n "$RESTIC_PASSWORD_FILE" ] || die "Define RESTIC_PASSWORD_FILE en $SD_BACKUP_ENV" 2
  if [ -s "$RESTIC_PASSWORD_FILE" ]; then
    ok "La clave ya existe en RESTIC_PASSWORD_FILE: no se sobrescribe"
  else
    ( umask 077; mkdir -p "$(dirname "$RESTIC_PASSWORD_FILE")"
      set +o pipefail; LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom 2>/dev/null | head -c 64 > "$RESTIC_PASSWORD_FILE" )
    [ "$(wc -c < "$RESTIC_PASSWORD_FILE" | tr -d ' ')" = 64 ] || die "No se pudo generar la clave Restic" 
    chmod 600 "$RESTIC_PASSWORD_FILE" 2>/dev/null || true
    ok "Clave Restic generada (64 caracteres, permisos 600). NO se ha mostrado."
    warn "Siguiente paso OBLIGATORIO: custodia fuera del servidor (docs/operations/CUSTODIA_CLAVE_BACKUPS.md)"
  fi
  exit 0
fi

sd_backup_validate
set +e; sd_restic_preflight; rc=$?; set -e
if [ "$rc" -eq 0 ]; then ok "El repositorio ya está inicializado: no se reinicializa"; exit 0; fi
code="$(sd_restic_classify "$rc")"
[ "$code" = E_REPO_NOT_INIT ] || die "No se puede inicializar: $(sd_restic_explain "$code")"
log "Inicializando repositorio (formato v2, compresión habilitada, cifrado AES-256)"
sd_restic init --repository-version 2 >/dev/null
sd_restic_preflight || die "El repositorio se creó pero no se puede abrir"
ok "Repositorio inicializado. Comprueba con scripts/backup/restic-test-connection.sh"
