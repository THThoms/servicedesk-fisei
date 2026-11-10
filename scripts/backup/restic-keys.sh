#!/usr/bin/env bash
# =============================================================================
# scripts/backup/restic-keys.sh — claves de acceso al repositorio cifrado
#
# Restic admite VARIAS claves independientes para el mismo repositorio: cada
# una abre la clave maestra cifrada. Así la clave del servidor y las de los
# custodios son distintas y se pueden revocar por separado (ver
# docs/operations/CUSTODIA_CLAVE_BACKUPS.md).
#
#   restic-keys.sh list
#   restic-keys.sh add --new-password-file <archivo 600> --user <custodio> [--host <equipo>]
#   restic-keys.sh verify --password-file <archivo>      # ¿esta clave abre el repositorio?
#   restic-keys.sh remove <id>                            # no permite quitar la clave en uso
#   restic-keys.sh rotate-server-key                      # nueva clave del servidor, revoca la anterior
#
# Nunca imprime claves. Los archivos de clave los prepara el custodio (p. ej.
# con su gestor de contraseñas) y se borran de forma segura después.
# =============================================================================
set -euo pipefail
SD_LOG_TAG="restic-keys"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
. "$SD_DIR/scripts/lib/backup.sh"
trap 'rm -f "${SD_RESTIC_ERR:-}"' EXIT
sd_backup_load
sd_backup_validate
cmd="${1:-}"; shift || true

current_id() { sd_restic key list --json 2>/dev/null | tr '{' '\n' | grep '"current":true' | sed -n 's/.*"id":"\([0-9a-f]*\)".*/\1/p' | head -n1; }

case "$cmd" in
list)
  sd_restic key list
  ;;
add)
  NEW=""; USERN=""; HOSTN="custodia-offline"
  while [ $# -gt 0 ]; do case "$1" in --new-password-file) NEW="$2"; shift 2;; --user) USERN="$2"; shift 2;; --host) HOSTN="$2"; shift 2;; *) die "Opción desconocida: $1" 2;; esac; done
  [ -s "$NEW" ] && [ -n "$USERN" ] || die "Uso: add --new-password-file <archivo> --user <custodio>" 2
  [ "$(wc -c < "$NEW" | tr -d ' ')" -ge 20 ] || die "La clave nueva debe tener al menos 20 caracteres" 2
  SD_RESTIC_MOUNTS=(-v "$(sd_hostpath "$NEW"):/run/secrets/new-pass:ro")
  sd_restic key add --new-password-file /run/secrets/new-pass --user "$USERN" --host "$HOSTN" >/dev/null
  SD_RESTIC_MOUNTS=()
  SD_RESTIC_PASSWORD_FILE="$NEW" sd_restic_preflight || die "La clave añadida no abre el repositorio"
  ok "clave del custodio '$USERN' añadida y verificada (no se ha mostrado)"
  ;;
verify)
  [ "${1:-}" = --password-file ] && [ -s "${2:-}" ] || die "Uso: verify --password-file <archivo>" 2
  set +e; SD_RESTIC_PASSWORD_FILE="$2" sd_restic_preflight; rc=$?; set -e
  [ "$rc" -eq 0 ] && ok "La clave abre el repositorio" || die "La clave NO abre el repositorio [$(sd_restic_classify "$rc")]"
  ;;
remove)
  id="${1:-}"; [ -n "$id" ] || die "Uso: remove <id> (ver 'list')" 2
  cur="$(current_id)"; case "$cur" in "$id"*) die "No se puede eliminar la clave en uso por este servidor" 2;; esac
  sd_restic key remove "$id" >/dev/null
  ok "clave $id revocada"
  ;;
rotate-server-key)
  old_id="$(current_id)"; [ -n "$old_id" ] || die "No se pudo identificar la clave actual"
  new="$RESTIC_PASSWORD_FILE.new"; bak="$RESTIC_PASSWORD_FILE.old"
  ( umask 077; set +o pipefail; LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom 2>/dev/null | head -c 64 > "$new" )
  SD_RESTIC_MOUNTS=(-v "$(sd_hostpath "$new"):/run/secrets/new-pass:ro")
  sd_restic key add --new-password-file /run/secrets/new-pass --user servicedesk --host "$RESTIC_SNAPSHOT_HOST" >/dev/null
  SD_RESTIC_MOUNTS=()
  SD_RESTIC_PASSWORD_FILE="$new" sd_restic_preflight || { rm -f "$new"; die "La clave nueva no abre el repositorio: no se cambia nada"; }
  cp -p "$RESTIC_PASSWORD_FILE" "$bak"; mv -f "$new" "$RESTIC_PASSWORD_FILE"; chmod 600 "$RESTIC_PASSWORD_FILE" 2>/dev/null || true
  sd_restic key remove "$old_id" >/dev/null
  set +e; SD_RESTIC_PASSWORD_FILE="$bak" sd_restic_preflight; rc=$?; set -e
  rm -f "$bak"
  [ "$rc" -eq 12 ] || die "La clave anterior todavía abre el repositorio (rc=$rc): revisar 'list'"
  ok "clave del servidor rotada: la nueva abre el repositorio y la anterior quedó revocada"
  warn "Las claves de los custodios NO cambian. Si la rotación es por compromiso, revisa también 'list'."
  ;;
*) sed -n '2,18p' "$0"; exit 2;;
esac
