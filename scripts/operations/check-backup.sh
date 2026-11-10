#!/usr/bin/env bash
# ServiceDesk UTA — vigilancia de backups (servicedesk-backup-check.timer, cada 6 h).
#   1. último conjunto local completo: SHA-256 correcto y de menos de MAX_AGE_HOURS (26);
#   2. estado de la última ejecución ($BACKUP_DIR/last-status);
#   3. si hay repositorio externo: accesible y con un snapshot de < MAX_AGE_HOURS
#      (scripts/backup/restic-check.sh --quick).
# Salida: 0 OK · 1 fallo (backup ausente, antiguo, corrupto, fallido o repositorio
# externo inaccesible/desactualizado) · 3 backup correcto pero SIN copia externa.
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
. "$SD_DIR/scripts/lib/backup.sh"
dir="${BACKUP_DIR:-$(sd_env_get BACKUP_DIR /var/backups/servicedesk)}"
max_h="${MAX_AGE_HOURS:-26}"
last=""
for d in $(find "$dir/sets" -mindepth 1 -maxdepth 1 -type d -name 'sd-20*' 2>/dev/null | LC_ALL=C sort -r); do
  [ -f "$d/.complete" ] && { last="$d"; break; }
done
[ -n "$last" ] || die "No existe ningún conjunto de backup completo en $dir/sets" 1
for f in SHA256SUMS manifest.json counts.txt; do [ -f "$last/$f" ] || die "Conjunto incompleto: falta $f en $last" 1; done
( cd "$last" && sha256sum -c --quiet SHA256SUMS ) || die "SHA-256 inválido en $last" 1
age_h=$(( ( $(date +%s) - $(stat -c %Y "$last/.complete") ) / 3600 ))
[ "$age_h" -le "$max_h" ] || die "El último backup completo tiene ${age_h} h (máximo ${max_h} h): $(basename "$last")" 1
st="$(grep '^status=' "$dir/last-status" 2>/dev/null | cut -d= -f2)"
code="$(grep '^code=' "$dir/last-status" 2>/dev/null | cut -d= -f2)"
case "$st" in
  OK) ;;
  NO_OFFSITE) warn "Backup local de hace ${age_h} h SIN copia externa ($(basename "$last"))"; exit 3;;
  *) die "Última ejecución de backup: ${st:-desconocido} [${code:-?}]" 1;;
esac
sd_backup_load
if sd_backup_configured; then
  MAX_AGE_HOURS="$max_h" BACKUP_DIR="$dir" "$SD_DIR/scripts/backup/restic-check.sh" --quick || die "Repositorio externo con problemas (ver last-restic-check)" 1
fi
ok "Backup correcto de hace ${age_h} h: $(basename "$last")"
