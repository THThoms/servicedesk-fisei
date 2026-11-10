#!/usr/bin/env bash
# =============================================================================
# scripts/operations/server-health.sh — estado completo del servidor, sin secretos
#
#   sudo scripts/operations/server-health.sh            # informe completo
#   sudo scripts/operations/server-health.sh --brief    # solo avisos y fallos + resumen
#
# Revisa: CPU/carga, RAM, disco, contenedores (estado, health, reinicios),
# SQL Server (edición, 3 bases ONLINE, tamaños, conexiones, memoria), readiness
# del gateway y del frontend, exposición de puertos (Docker frente a UFW), volumen
# de imágenes, logs, backups (local, Restic, drill), certificado TLS, timers
# systemd, UFW y SSH.
# Salida: 0 sin fallos (puede haber avisos) · 1 algún FALLO.
# Nunca muestra contraseñas, claves, tokens ni el contenido de .env.
# =============================================================================
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
BRIEF=0; [ "${1:-}" = --brief ] && BRIEF=1
FAILS=0; WARNS=0
line() { # line OK|AVISO|FALLO|INFO texto
  case "$1" in
    FALLO) FAILS=$((FAILS + 1)); printf '%s  [FALLO] %s%s\n' "$C_R" "$2" "$C_0";;
    AVISO) WARNS=$((WARNS + 1)); printf '%s  [AVISO] %s%s\n' "$C_Y" "$2" "$C_0";;
    OK)    [ "$BRIEF" = 1 ] || printf '%s  [OK]    %s%s\n' "$C_G" "$2" "$C_0";;
    INFO)  [ "$BRIEF" = 1 ] || printf '          %s\n' "$2";;
  esac
}
hdr() { [ "$BRIEF" = 1 ] || printf '\n%s== %s ==%s\n' "$C_B" "$*" "$C_0"; }
have() { command -v "$1" >/dev/null 2>&1; }
BACKUP_DIR="${BACKUP_DIR:-$(sd_env_get BACKUP_DIR /var/backups/servicedesk)}"
DOMAIN="$(sd_env_get PUBLIC_DOMAIN "")"; GWP="$(sd_env_get GATEWAY_BIND_PORT 8080)"; FEP="$(sd_env_get FRONTEND_BIND_PORT 3000)"

[ "$BRIEF" = 1 ] || echo "${C_B}ServiceDesk UTA · salud del servidor · $(hostname) · $(date -u +%FT%TZ)${C_0}"
purpose="$(sd_env_get SERVER_PURPOSE produccion)"; [ "$purpose" = pruebas ] && line AVISO "Servidor de PRUEBAS (SERVER_PURPOSE=pruebas)"

# ------------------------------------------------------------------ host
hdr "Host"
if [ -r /proc/loadavg ]; then
  read -r l1 l5 _ < /proc/loadavg; n="$(nproc 2>/dev/null || echo 1)"
  awk -v l="$l5" -v n="$n" 'BEGIN{exit !(l > n)}' && line AVISO "Carga media 5 min $l5 con $n vCPU" || line OK "Carga $l1 / $l5 (1/5 min) · $n vCPU"
fi
if [ -r /proc/meminfo ]; then
  tot=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo); av=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  if [ -z "$av" ]; then
    line INFO "RAM: ${tot} MB totales (MemAvailable no disponible en este sistema: no se evalúa)"
  else
  pct=$(( 100 * av / tot ))
  if [ "$pct" -lt 10 ]; then line FALLO "RAM disponible ${av}/${tot} MB (${pct} %)"
  elif [ "$pct" -lt 20 ]; then line AVISO "RAM disponible ${av}/${tot} MB (${pct} %)"
  else line OK "RAM disponible ${av}/${tot} MB (${pct} %)"; fi
  fi
fi
root_dir="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
for d in / "$root_dir" "$BACKUP_DIR"; do
  [ -e "$d" ] || continue
  u="$(df -P -k --output=pcent,avail "$d" 2>/dev/null | awk 'NR==2{gsub("%","",$1); print $1" "int($2/1048576)}')"; [ -n "$u" ] || continue
  set -- $u
  if [ "$1" -ge 90 ]; then line FALLO "Disco $d: ${1} % usado (${2} GB libres)"
  elif [ "$1" -ge 80 ]; then line AVISO "Disco $d: ${1} % usado (${2} GB libres)"
  else line OK "Disco $d: ${1} % usado (${2} GB libres)"; fi
done

# ------------------------------------------------------------------ contenedores
hdr "Contenedores ($SD_PROJECT)"
if ! docker info >/dev/null 2>&1; then line FALLO "Docker no responde"; else
  for svc in mssql auth-service catalog-service ticket-service api-gateway frontend; do
    c="$(sd_container "$svc")"
    if [ -z "$c" ]; then line FALLO "$svc: sin contenedor"; continue; fi
    read -r st hl rc img < <(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}} {{.RestartCount}} {{.Config.Image}}' "$c")
    msg="$svc: $st/$hl · reinicios $rc · ${img##*/}"
    if [ "$st" != running ] || { [ "$hl" != healthy ] && [ "$hl" != - ]; }; then line FALLO "$msg"
    elif [ "$rc" -gt 3 ]; then line AVISO "$msg"
    else line OK "$msg"; fi
  done
  exposed=0
  while read -r name ports; do
    case "$ports" in *0.0.0.0:*|*:::*|*"[::]:"*) exposed=1; line FALLO "$name publica puertos fuera de 127.0.0.1: $ports (Docker se salta UFW)";; esac
  done < <(docker ps --filter "label=com.docker.compose.project=$SD_PROJECT" --format '{{.Names}} {{.Ports}}')
  [ "$exposed" = 0 ] && line OK "Ningún contenedor del proyecto publica puertos fuera de 127.0.0.1"
fi

# ------------------------------------------------------------------ SQL Server
hdr "SQL Server"
if [ -n "$(sd_container mssql)" ]; then
  ed="$(sd_query "SELECT CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) + ' ' + CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(32));" 2>/dev/null | tr -d '\r' | head -n1)"
  [ -n "$ed" ] && line OK "$ed" || line FALLO "SQL Server no responde a consultas"
  case "$ed" in *Developer*) [ "$purpose" = pruebas ] || line FALLO "Edición Developer en un servidor que no es de pruebas";; esac
  read -r A C T <<<"$(sd_db_names)"
  while IFS='|' read -r name state rec mb; do
    [ -n "$name" ] || continue
    [ "$state" = ONLINE ] && line OK "$name ONLINE · recovery $rec · ${mb} MB" || line FALLO "$name en estado $state"
  done < <(sd_query "SELECT d.name, d.state_desc, d.recovery_model_desc, CAST(SUM(CAST(f.size AS bigint)) * 8 / 1024 AS varchar(20)) FROM sys.databases d JOIN sys.master_files f ON f.database_id = d.database_id WHERE d.name IN (N'$A', N'$C', N'$T') GROUP BY d.name, d.state_desc, d.recovery_model_desc ORDER BY d.name;" 2>/dev/null | tr -d '\r')
  n="$(sd_query "SELECT COUNT(*) FROM sys.databases WHERE name IN (N'$A', N'$C', N'$T') AND state = 0;" 2>/dev/null | tr -d '\r' | head -n1)"
  [ "$n" = 3 ] || line FALLO "Bases ONLINE: ${n:-0} de 3"
  cn="$(sd_query "SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1;" 2>/dev/null | tr -d '\r' | head -n1)"
  mem="$(sd_query "SELECT CAST(physical_memory_in_use_kb / 1024 AS varchar(20)) FROM sys.dm_os_process_memory;" 2>/dev/null | tr -d '\r' | head -n1)"
  line INFO "conexiones de usuario: ${cn:-?} · memoria del motor: ${mem:-?} MB · límite $(sd_env_get MSSQL_MEMORY_LIMIT_MB 2048) MB"
  for k in data log backup; do line INFO "ruta $k: $(sd_mssql_path "$k" 2>/dev/null)"; done
else line FALLO "Contenedor mssql no encontrado"; fi

# ------------------------------------------------------------------ aplicación
hdr "Aplicación"
if have curl; then
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 8 "http://127.0.0.1:$GWP/health/ready" || true)"
  [ "$code" = 200 ] && line OK "Gateway listo (/health/ready → 200: los 3 servicios y sus bases)" || line FALLO "Gateway /health/ready → ${code:-sin respuesta}"
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 8 "http://127.0.0.1:$FEP/" || true)"
  [ "$code" = 200 ] && line OK "Frontend → 200" || line FALLO "Frontend → ${code:-sin respuesta}"
  if [ -n "$DOMAIN" ] && [ "$(id -u)" = 0 ] && have nginx; then
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 8 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/healthz" || true)"
    [ "$code" = 200 ] && line OK "nginx → https://$DOMAIN/healthz 200" || line AVISO "nginx https://$DOMAIN/healthz → ${code:-sin respuesta}"
  fi
fi
tc="$(sd_container ticket-service)"
if [ -n "$tc" ]; then
  up="$(docker exec "$tc" sh -c 'find /app/uploads -type f | wc -l; du -sk /app/uploads | cut -f1' 2>/dev/null | tr '\n' ' ')"
  set -- $up; line OK "Volumen de imágenes: ${1:-?} archivos · $(( ${2:-0} / 1024 )) MB"
  docker exec "$tc" sh -c 'test -w /app/uploads' 2>/dev/null || line FALLO "El volumen de imágenes no admite escritura"
fi

# ------------------------------------------------------------------ red y seguridad
hdr "Red y seguridad"
if have ss; then
  pub="$(ss -Htlnp 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|::1)' | sed -E 's/.*:([0-9]+)$/\1/' | sort -un | tr '\n' ' ')"
  extra="$(for p in $pub; do case "$p" in 22|80|443|"$(sd_env_get SSH_PORT 22)") ;; 53) ;; *) printf '%s ' "$p";; esac; done)"
  [ -z "$extra" ] && line OK "Puertos escuchando fuera de loopback: ${pub:-ninguno}" || line FALLO "Puertos inesperados escuchando en interfaces públicas: $extra(¿1433/8080/3000 expuestos?)"
fi
if have ufw && [ "$(id -u)" = 0 ]; then
  ufw status 2>/dev/null | grep -q "Status: active" && line OK "UFW activo" || line AVISO "UFW inactivo"
fi
if [ -f /etc/ssh/sshd_config.d/99-servicedesk-hardening.conf ]; then line OK "SSH endurecido (solo claves)"; elif [ -d /etc/ssh ]; then line AVISO "SSH sin el endurecimiento de ServiceDesk (contraseñas permitidas)"; fi
if [ -n "$DOMAIN" ] && [ -r "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ] && have openssl; then
  end="$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" | cut -d= -f2)"
  days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
  if [ "$days" -lt 7 ]; then line FALLO "Certificado TLS de $DOMAIN caduca en $days días"
  elif [ "$days" -lt 21 ]; then line AVISO "Certificado TLS de $DOMAIN caduca en $days días (¿falla la renovación?)"
  else line OK "Certificado TLS de $DOMAIN: $days días"; fi
elif [ -n "$DOMAIN" ] && [ -d /etc/letsencrypt ]; then line AVISO "No hay certificado para $DOMAIN"; fi

# ------------------------------------------------------------------ backups
hdr "Backups"
st() { grep "^$2=" "$1" 2>/dev/null | cut -d= -f2-; }
if [ -f "$BACKUP_DIR/last-status" ]; then
  s="$(st "$BACKUP_DIR/last-status" status)"; f="$(st "$BACKUP_DIR/last-status" finished)"; c="$(st "$BACKUP_DIR/last-status" code)"
  age=$(( ( $(date -u +%s) - $(date -u -d "$f" +%s 2>/dev/null || echo 0) ) / 3600 ))
  case "$s" in
    OK) [ "$age" -le 26 ] && line OK "Último backup OK hace ${age} h" || line FALLO "Último backup OK pero hace ${age} h";;
    NO_OFFSITE) line AVISO "Último backup (hace ${age} h) SIN copia externa";;
    *) line FALLO "Último backup: $s [$c] hace ${age} h";;
  esac
else line AVISO "Todavía no hay ningún backup ($BACKUP_DIR/last-status)"; fi
for pair in "last-restic-check:revisión del repositorio" "last-retention:retención" "last-drill:restore drill"; do
  f="$BACKUP_DIR/${pair%%:*}"; n="${pair#*:}"
  [ -f "$f" ] || { line INFO "$n: sin ejecuciones todavía"; continue; }
  [ "$(st "$f" status)" = OK ] && line OK "$n: OK ($(st "$f" finished))" || line FALLO "$n: $(st "$f" status) [$(st "$f" code)]"
done
if have systemctl && [ -d /run/systemd/system ]; then
  hdr "Timers systemd"
  for t in servicedesk-backup servicedesk-backup-check servicedesk-backup-verify servicedesk-backup-retention servicedesk-restore-drill; do
    systemctl is-active --quiet "$t.timer" && line OK "$t.timer activo" || line AVISO "$t.timer inactivo"
  done
  failed="$(systemctl list-units --failed --no-legend 'servicedesk-*' 2>/dev/null | awk '{print $1}' | tr '\n' ' ')"
  [ -z "$failed" ] && line OK "Ninguna unidad servicedesk-* en fallo" || line FALLO "Unidades en fallo: $failed"
fi

# ------------------------------------------------------------------ logs
hdr "Logs"
[ -f /etc/logrotate.d/servicedesk ] && line OK "logrotate configurado" || { [ -d /etc/logrotate.d ] && line AVISO "Falta /etc/logrotate.d/servicedesk"; }
[ -f /etc/docker/daemon.json ] && grep -q '"max-size"' /etc/docker/daemon.json && line OK "Rotación de logs de Docker (daemon.json)"
if [ -r /var/log/servicedesk-alerts.log ]; then
  na="$(grep -c "$(date -u +%Y-%m-%d)" /var/log/servicedesk-alerts.log 2>/dev/null || true)"
  [ "${na:-0}" = 0 ] && line OK "Sin alertas hoy" || line AVISO "$na alerta(s) hoy en /var/log/servicedesk-alerts.log"
fi

printf '\n%sResumen: %s fallo(s) · %s aviso(s)%s\n' "$C_B" "$FAILS" "$WARNS" "$C_0"
[ "$FAILS" -eq 0 ]
