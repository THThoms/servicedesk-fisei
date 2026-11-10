#!/usr/bin/env bash
# =============================================================================
# scripts/install-server.sh — Instalador de ServiceDesk UTA (SQL Server 2022)
#
# Ejecutar como root DESDE la raíz del paquete extraído (p. ej. /opt/servicedesk):
#
#   MODO A — instalación limpia (sin datos previos):
#     sudo scripts/install-server.sh --mode clean
#
#   MODO B — restauración desde backups .bak de otra instalación:
#     sudo scripts/install-server.sh --mode restore --from /ruta/backup/<STAMP>
#
# Otras opciones:
#   --env FILE           .env a usar (por defecto deploy/server/.env)
#   --generate-secrets   rellena contraseñas/JWT VACÍOS con valores aleatorios
#                        fuertes (no los imprime; quedan en el .env, chmod 600)
#   --dry-run            valida y muestra los pasos sin ejecutar nada
#   --yes                no hace preguntas de confirmación
#   --replace            (solo restore) permite sobrescribir bases existentes
#   --skip-nginx         no configura nginx del host
#   --skip-systemd       no instala los timers de backup
#   --nginx-tls          SOLO (re)genera la config nginx con TLS tras emitir el
#                        certificado, y recarga nginx
#   --project NAME       nombre del proyecto compose (por defecto: servicedesk)
#   --skip-firewall      no configura UFW (22/80/443)
#   --skip-ssh-hardening no instala el endurecimiento de SSH
#   --skip-docker-daemon no instala /etc/docker/daemon.json
#   --ssh-port N         puerto SSH a permitir en UFW (por defecto 22)
#   --test-mode          SOLO SIMULACIÓN LOCAL: omite comprobaciones de root/SO/
#                        arquitectura, nginx, systemd, firewall, SSH y daemon
#
# Servidor de PRUEBAS (Fase T): SERVER_PURPOSE=pruebas en el .env permite
# MSSQL_PID=Developer (solo desarrollo, evaluación y pruebas; NUNCA producción).
# Con SERVER_PURPOSE=produccion (por defecto) Developer y Evaluation se bloquean.
#
# Reglas: no imprime secretos · no borra volúmenes · no ejecuta seeds sobre una
# base restaurada · no mezcla los modos · no modifica otras instalaciones.
# =============================================================================
set -euo pipefail
SD_LOG_TAG="install"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE=""; FROM=""; DRY=0; YES=0; GEN=0; REPLACE=0; SKIP_NGINX=0; SKIP_SYSTEMD=0; NGINX_TLS_ONLY=0; TEST=0
SKIP_FW=0; SKIP_SSH=0; SKIP_DAEMON=0; SSH_PORT=22
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2;;
    --from) FROM="$2"; shift 2;;
    --env) export SD_ENV_FILE="$2"; shift 2;;
    --project) export SD_PROJECT="$2"; shift 2;;
    --generate-secrets) GEN=1; shift;;
    --dry-run) DRY=1; shift;;
    --yes) YES=1; shift;;
    --replace) REPLACE=1; shift;;
    --skip-nginx) SKIP_NGINX=1; shift;;
    --skip-systemd) SKIP_SYSTEMD=1; shift;;
    --nginx-tls) NGINX_TLS_ONLY=1; shift;;
    --skip-firewall) SKIP_FW=1; shift;;
    --skip-ssh-hardening) SKIP_SSH=1; shift;;
    --skip-docker-daemon) SKIP_DAEMON=1; shift;;
    --ssh-port) SSH_PORT="$2"; shift 2;;
    --test-mode) TEST=1; SKIP_NGINX=1; SKIP_SYSTEMD=1; SKIP_FW=1; SKIP_SSH=1; SKIP_DAEMON=1; shift;;
    -h|--help) sed -n '2,37p' "$0"; exit 0;;
    *) echo "Opción desconocida: $1" >&2; exit 1;;
  esac
done
# Un SD_ENV_FILE heredado del entorno (p. ej. de otra instalación o del
# laboratorio) haría que el instalador validara y modificara un .env ajeno.
if [ -n "${SD_ENV_FILE:-}" ] && [ "${SD_ALLOW_EXTERNAL_ENV:-0}" != 1 ]; then
  echo "  ✘ SD_ENV_FILE está definido en el entorno: el instalador solo usa deploy/server/.env de SU instalación." >&2
  echo "    Ejecuta 'unset SD_ENV_FILE' (o SD_ALLOW_EXTERNAL_ENV=1 si es intencionado)." >&2
  exit 1
fi
. "$SCRIPT_DIR/lib/common.sh"
STATE_FILE="$(dirname "$SD_ENV_FILE")/.install-state${SD_PROJECT:+.$SD_PROJECT}"

run() { if [ "$DRY" = 1 ]; then printf '   [dry-run] %s\n' "$*"; else "$@"; fi; }
confirm() {
  [ "$YES" = 1 ] || [ "$DRY" = 1 ] && return 0
  read -r -p "$1 [escribe SI]: " a; [ "$a" = "SI" ] || die "Cancelado por el operador"
}
section() { printf '\n%s== %s ==%s\n' "$C_B" "$*" "$C_0"; }
ERRORS=0; err() { printf '%s  ✘ %s%s\n' "$C_R" "$*" "$C_0" >&2; ERRORS=$((ERRORS + 1)); }

# ----------------------------------------------------------------- nginx
render_nginx() {
  local domain port_gw port_fe cert tpl dest
  domain="$(sd_env_get PUBLIC_DOMAIN)"; domain="${domain%%:*}"
  port_gw="$(sd_env_get GATEWAY_BIND_PORT 8080)"; port_fe="$(sd_env_get FRONTEND_BIND_PORT 3000)"
  cert="/etc/letsencrypt/live/$domain"
  dest="/etc/nginx/sites-available/servicedesk.conf"
  command -v nginx >/dev/null 2>&1 || { warn "nginx no instalado: omitido (ver INSTALACION_SERVIDOR_NUEVO.md §nginx)"; return 0; }
  if [ -f "$cert/fullchain.pem" ]; then tpl="$SD_DIR/deploy/nginx/servicedesk.conf.template"
  else tpl="$SD_DIR/deploy/nginx/servicedesk-bootstrap-http.conf.template"
       warn "No hay certificado en $cert: se instala la config de ARRANQUE (solo ACME)."; fi
  [ -f "$dest" ] && run cp -a "$dest" "$dest.bak.$(date +%Y%m%d%H%M%S)"
  if [ "$DRY" = 1 ]; then echo "   [dry-run] render $(basename "$tpl") → $dest"; return 0; fi
  sed -e "s#__SERVER_NAME__#$domain#g" -e "s#__UPSTREAM_GATEWAY__#127.0.0.1:$port_gw#g" \
      -e "s#__UPSTREAM_FRONTEND__#127.0.0.1:$port_fe#g" -e "s#__CERT_DIR__#$cert#g" "$tpl" > "$dest"
  mkdir -p /var/www/certbot
  ln -sf "$dest" /etc/nginx/sites-enabled/servicedesk.conf
  nginx -t && systemctl reload nginx
  ok "nginx configurado ($(basename "$tpl"))"
  # Hook: recarga nginx automáticamente cuando certbot renueva el certificado.
  install -D -m 0755 "$SD_DIR/deploy/certbot/servicedesk-reload-nginx.sh" \
    /etc/letsencrypt/renewal-hooks/deploy/servicedesk-reload-nginx.sh
  systemctl is-enabled certbot.timer >/dev/null 2>&1 && ok "certbot.timer activo (renovación automática)" \
    || warn "certbot.timer no está habilitado: sudo systemctl enable --now certbot.timer"
  [ -f "$cert/fullchain.pem" ] || echo "   Siguiente: certbot certonly --webroot -w /var/www/certbot -d $domain && $0 --nginx-tls"
}
if [ "$NGINX_TLS_ONLY" = 1 ]; then section "nginx TLS"; render_nginx; exit 0; fi

[ "$MODE" = clean ] || [ "$MODE" = restore ] || die "Debes elegir --mode clean (instalación limpia) o --mode restore (restauración). No hay modo por defecto."
if [ "$MODE" = restore ]; then [ -n "$FROM" ] && [ -d "$FROM" ] || die "--mode restore exige --from <directorio con los .bak>"; fi
[ "$MODE" = clean ] && [ -n "$FROM" ] && die "--from solo se usa con --mode restore (no se mezclan modos)"

echo "${C_B}ServiceDesk UTA · instalador · modo=$MODE · proyecto=$SD_PROJECT${C_0}"
[ "$DRY" = 1 ] && echo "${C_Y}DRY-RUN: no se ejecutará ningún cambio.${C_0}"
[ "$TEST" = 1 ] && echo "${C_Y}TEST-MODE: solo para entornos de prueba.${C_0}"

# ----------------------------------------------------------------- 1. preflight
section "1. Preflight del servidor"
if [ "$TEST" = 0 ]; then
  [ "$(id -u)" = 0 ] || die "Ejecuta como root (sudo)."
  . /etc/os-release 2>/dev/null || true
  [ "${ID:-}" = ubuntu ] && [ "${VERSION_ID:-}" = "24.04" ] && ok "Ubuntu 24.04 LTS" || warn "SO ${PRETTY_NAME:-desconocido}: la referencia es Ubuntu Server 24.04 LTS"
  [ "$(uname -m)" = x86_64 ] && ok "arquitectura x86_64" || die "Arquitectura $(uname -m): la imagen de SQL Server 2022 solo existe para x86_64/amd64"
  mem_mb=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1024 ))
  [ "$mem_mb" -ge 3500 ] || die "RAM ${mem_mb} MB: mínimo 4 GB (SQL Server exige ≥2 GB solo para el motor)"
  [ "$mem_mb" -ge 7500 ] && ok "RAM ${mem_mb} MB" || warn "RAM ${mem_mb} MB: se recomiendan 8 GB"
  cpus="$(nproc)"; [ "$cpus" -ge 2 ] && ok "$cpus vCPU" || die "Se requieren al menos 2 vCPU"
fi
sd_require_cmd docker
docker info >/dev/null 2>&1 || die "Docker Engine no responde"
dv="$(docker version --format '{{.Server.Version}}')"; ok "Docker $dv"
# Docker < 28 con userland-proxy=false podía dejar alcanzables desde la LAN los
# puertos publicados en 127.0.0.1 (route_localnet). Docker 28 lo bloquea.
[ "${dv%%.*}" -ge 28 ] 2>/dev/null || warn "Docker $dv: se recomienda Docker Engine ≥ 28 (protección de puertos publicados en 127.0.0.1)"
cv="$(docker compose version --short 2>/dev/null || true)"; [ -n "$cv" ] || die "Falta Docker Compose v2 (docker compose)"
ok "Docker Compose $cv"
root_dir="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
free_gb="$(df -Pk "$root_dir" 2>/dev/null | awk 'NR==2{print int($4/1048576)}' || echo 0)"
if [ "$TEST" = 0 ]; then [ "${free_gb:-0}" -ge 20 ] && ok "Disco libre en $root_dir: ${free_gb} GB" || die "Disco libre ${free_gb} GB en $root_dir: mínimo 20 GB"; fi

# ----------------------------------------------------------------- 2. .env
section "2. Configuración ($SD_ENV_FILE)"
if [ ! -f "$SD_ENV_FILE" ]; then
  [ "$GEN" = 1 ] || die "No existe $SD_ENV_FILE. Copia la plantilla: cp $SD_DIR/.env.example $SD_ENV_FILE  (y edítala, o usa --generate-secrets)"
  run cp "$SD_DIR/.env.example" "$SD_ENV_FILE"
fi
[ "$DRY" = 1 ] || chmod 600 "$SD_ENV_FILE"

rand() { LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1"; }
gen_pw() { local r; r="$(rand 30)"; printf '%s-%s_%sQ7x' "${r:0:10}" "${r:10:10}" "${r:20:10}"; }
set_env() { # set_env KEY VALUE  (VALUE solo [A-Za-z0-9_-], sin imprimir)
  if grep -qE "^${1}=" "$SD_ENV_FILE"; then sed -i "s#^${1}=.*#${1}=${2}#" "$SD_ENV_FILE"; else printf '%s=%s\n' "$1" "$2" >> "$SD_ENV_FILE"; fi
}
if [ "$GEN" = 1 ]; then
  for k in MSSQL_SA_PASSWORD AUTH_DB_PASSWORD CATALOG_DB_PASSWORD TICKET_DB_PASSWORD; do
    if [ -z "$(sd_env_get "$k")" ]; then run set_env "$k" "$(gen_pw)"; ok "$k: GENERADA"; fi
  done
  if [ -z "$(sd_env_get JWT_SECRET)" ]; then run set_env JWT_SECRET "$(rand 64)"; ok "JWT_SECRET: GENERADA"; fi
fi

printf '   %-28s %s\n' VARIABLE ESTADO
for k in PUBLIC_DOMAIN MSSQL_PID MSSQL_SA_PASSWORD AUTH_DB_PASSWORD CATALOG_DB_PASSWORD TICKET_DB_PASSWORD JWT_SECRET \
         MICROSOFT_CLIENT_ID MICROSOFT_TENANT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_REDIRECT_URI ADMIN_EMAILS \
         INITIAL_ADMIN_EMAIL EMAIL_SEND_MODE SMTP_HOST SMTP_USER SMTP_PASS STORAGE_MODE \
         FCM_MODE FCM_PROJECT_ID FCM_CLIENT_EMAIL FCM_PRIVATE_KEY BACKUP_DIR BACKUP_REQUIRE_OFFSITE BACKUP_ALERT_EMAIL BACKUP_ALERT_WEBHOOK_URL; do
  printf '   %-28s %s\n' "$k" "$(sd_env_state "$k")"
done

strong_pw() { # ≥12, mayús, minús, dígito, símbolo permitido; sin caracteres que rompan DSN/sqlcmd
  local p="$1"
  [ "${#p}" -ge 12 ] && [[ "$p" =~ [A-Z] ]] && [[ "$p" =~ [a-z] ]] && [[ "$p" =~ [0-9] ]] && [[ "$p" =~ [^A-Za-z0-9] ]] \
    && ! [[ "$p" =~ [\;\'\"\$\`\\\{\}\ \#\&\|\<\>] ]]
}
for k in PUBLIC_DOMAIN MSSQL_PID MSSQL_SA_PASSWORD AUTH_DB_PASSWORD CATALOG_DB_PASSWORD TICKET_DB_PASSWORD JWT_SECRET; do
  [ -n "$(sd_env_get "$k")" ] || err "$k es obligatoria y está vacía"
done
for k in MSSQL_SA_PASSWORD AUTH_DB_PASSWORD CATALOG_DB_PASSWORD TICKET_DB_PASSWORD; do
  v="$(sd_env_get "$k")"; [ -z "$v" ] || strong_pw "$v" || err "$k no cumple la política (≥12, mayúscula, minúscula, número, símbolo; sin ; ' \" \$ \` \\ { } # & | < > espacios)"
done
pw_set="$(for k in MSSQL_SA_PASSWORD AUTH_DB_PASSWORD CATALOG_DB_PASSWORD TICKET_DB_PASSWORD; do sd_env_get "$k"; echo; done | grep -v '^$' | sort | uniq -d | wc -l)"
[ "$pw_set" -eq 0 ] || err "Las contraseñas de sa y de los 3 logins deben ser DIFERENTES entre sí"
jwt="$(sd_env_get JWT_SECRET)"
[ -z "$jwt" ] || [ "${#jwt}" -ge 32 ] || err "JWT_SECRET debe tener ≥32 caracteres"
for o in MSSQL_SA_PASSWORD AUTH_DB_PASSWORD CATALOG_DB_PASSWORD TICKET_DB_PASSWORD; do
  if [ -n "$jwt" ] && [ "$jwt" = "$(sd_env_get "$o")" ]; then err "JWT_SECRET no puede coincidir con $o"; fi
done

# Propósito del servidor y edición de SQL Server (BLOQUEANTE)
purpose="$(sd_env_get SERVER_PURPOSE produccion)"
case "$purpose" in
  produccion) ok "SERVER_PURPOSE=produccion";;
  pruebas) warn "SERVER_PURPOSE=pruebas: servidor de PRUEBAS. No usar con datos ni usuarios reales de producción.";;
  *) err "SERVER_PURPOSE='$purpose' no válido (pruebas|produccion)";;
esac
pid="$(sd_env_get MSSQL_PID)"
case "$pid" in
  "") err "BLOQUEADO: MSSQL_PID vacío. Define la edición/licencia de SQL Server para el uso previsto (ver CONFIGURACION_PRODUCCION.md)";;
  Express|Standard|Enterprise|EnterpriseCore) ok "Edición SQL Server solicitada: $pid";;
  Developer)
    if [ "$purpose" = pruebas ]; then
      warn "MSSQL_PID=Developer: licencia SOLO para desarrollo, evaluación y pruebas. Para producción cambia MSSQL_PID (Express/Standard/clave) y SERVER_PURPOSE=produccion."
    else err "BLOQUEADO: MSSQL_PID=Developer no es apto para producción. Para un servidor de pruebas define SERVER_PURPOSE=pruebas."; fi;;
  Evaluation)
    if [ "$TEST" = 1 ]; then warn "MSSQL_PID=Evaluation aceptado SOLO por --test-mode"
    else err "BLOQUEADO: MSSQL_PID=Evaluation caduca a los 180 días"; fi;;
  ?????-?????-?????-?????-?????) ok "Edición SQL Server: clave de producto (valor no mostrado)";;
  *) err "MSSQL_PID='$pid' no reconocido (Express|Standard|Enterprise|EnterpriseCore|clave XXXXX-XXXXX-XXXXX-XXXXX-XXXXX)";;
esac

domain="$(sd_env_get PUBLIC_DOMAIN)"
[[ "$domain" == *servicedesk.example.edu.ec* ]] && err "PUBLIC_DOMAIN conserva el valor de ejemplo"
[[ "$domain" =~ ^https?:// ]] && err "PUBLIC_DOMAIN va SIN protocolo (solo el dominio)"

sso_n=0; for k in MICROSOFT_CLIENT_ID MICROSOFT_TENANT_ID MICROSOFT_CLIENT_SECRET MICROSOFT_REDIRECT_URI; do [ -n "$(sd_env_get $k)" ] && sso_n=$((sso_n + 1)); done
case "$sso_n" in
  0) warn "Microsoft SSO NO configurado: solo login local (cuentas creadas con manage-user.sh)";;
  4) # Válidas: https://<dominio>/auth/callback (convención del VPS, la registrada
     # en Azure) o https://<dominio>/api/auth/microsoft/callback. nginx enruta ambas.
     ru="$(sd_env_get MICROSOFT_REDIRECT_URI)"
     case "$ru" in
       "https://${domain}/auth/callback"|"https://${domain}/api/auth/microsoft/callback") ok "SSO configurado (redirect $ru)";;
       *) warn "MICROSOFT_REDIRECT_URI='$ru' no es https://${domain}/auth/callback: debe coincidir EXACTAMENTE con una Redirect URI registrada en Azure";;
     esac;;
  *) err "Microsoft SSO a medias: define las 4 variables MICROSOFT_* o ninguna";;
esac
if [ "$(sd_env_get EMAIL_SEND_MODE log)" = smtp ]; then
  for k in SMTP_HOST SMTP_USER SMTP_PASS; do [ -n "$(sd_env_get $k)" ] || err "EMAIL_SEND_MODE=smtp exige $k"; done
fi
if [ "$(sd_env_get FCM_MODE off)" = firebase ]; then
  for k in FCM_PROJECT_ID FCM_CLIENT_EMAIL FCM_PRIVATE_KEY; do [ -n "$(sd_env_get $k)" ] || err "FCM_MODE=firebase exige $k"; done
fi
[ "$(sd_env_get STORAGE_MODE local)" = cloudinary ] && warn "STORAGE_MODE=cloudinary: el paquete 'cloudinary' NO está instalado → el servicio usará almacenamiento local"
if [ "$MODE" = clean ]; then
  ia="$(sd_env_get INITIAL_ADMIN_EMAIL)"
  [ -n "$ia" ] || err "Modo limpio: define INITIAL_ADMIN_EMAIL (administrador inicial)"
  if [ "$(sd_env_get INITIAL_ADMIN_SSO_ONLY false)" = true ] && [ "$sso_n" != 4 ]; then
    err "INITIAL_ADMIN_SSO_ONLY=true exige Microsoft SSO configurado (si no, nadie podría entrar)"
  fi
fi
[ -n "$(sd_env_get BACKUP_OFFSITE_RSYNC_TARGET)" ] && warn "BACKUP_OFFSITE_RSYNC_TARGET ya no se usa (Fase S): la copia externa es Restic cifrado → /etc/servicedesk/backup.env"
BENV="${SD_BACKUP_ENV:-/etc/servicedesk/backup.env}"
if [ ! -f "$BENV" ] || [ -z "$(SD_ENV_FILE="$BENV" sd_env_get RESTIC_REPOSITORY)$(SD_ENV_FILE="$BENV" sd_env_get B2_BUCKET)" ]; then
  warn "Backup externo cifrado SIN configurar ($BENV): los backups terminarán con código 3 (alerta) hasta completar docs/operations/CONFIGURACION_BACKBLAZE.md"
fi
if [ -n "$(sd_env_get INITIAL_ADMIN_PASSWORD)" ]; then
  err "INITIAL_ADMIN_PASSWORD ya no se usa (Fase R): bórrala del .env; el admin inicial recibe una contraseña temporal generada"
fi
[ "$ERRORS" -eq 0 ] || die "Configuración con $ERRORS error(es). Corrige $SD_ENV_FILE y vuelve a ejecutar."
ok "Configuración válida"
[ "$TEST" = 1 ] || confirm "¿Confirmas que dispones de la licencia de SQL Server '$pid' para este servidor?"

# ----------------------------------------------------------------- 3. guardas de modo
section "3. Verificación del modo de instalación"
vol="${SD_PROJECT}_mssql-data"
if [ -f "$STATE_FILE" ]; then
  prev="$(grep '^mode=' "$STATE_FILE" | cut -d= -f2)"
  die "Este directorio ya tiene una instalación (modo=$prev, ver $STATE_FILE). Para actualizar usa 'docker compose up -d --build'; no se reinstala encima."
fi
if docker volume inspect "$vol" >/dev/null 2>&1; then
  if [ "$MODE" = clean ]; then
    die "Ya existe el volumen $vol con datos. Una instalación LIMPIA no se hace sobre datos existentes (usa otro servidor/proyecto, o --mode restore --replace)."
  fi
  [ "$REPLACE" = 1 ] || die "Ya existe el volumen $vol. Restaurar encima exige --replace (destructivo)."
  warn "Se restaurará sobre el volumen existente $vol (--replace)"
else
  ok "No hay datos previos del proyecto '$SD_PROJECT' en este Docker"
fi

# ----------------------------------------------------------------- 3b. host
section "3b. Endurecimiento del host"
if [ "$SKIP_DAEMON" = 0 ]; then
  if [ -f /etc/docker/daemon.json ]; then
    if cmp -s /etc/docker/daemon.json "$SD_DIR/deploy/docker/daemon.json"; then ok "daemon.json de Docker ya configurado"
    else warn "/etc/docker/daemon.json ya existe y es distinto: NO se sobrescribe (revisa deploy/docker/daemon.json)"; fi
  else
    run install -D -m 0644 "$SD_DIR/deploy/docker/daemon.json" /etc/docker/daemon.json
    run systemctl restart docker
    ok "Docker: rotación de logs, live-restore, userland-proxy off, no-new-privileges"
  fi
fi
if [ "$SKIP_FW" = 0 ]; then
  if command -v ufw >/dev/null 2>&1; then
    confirm "Se configurará UFW: denegar entrantes salvo SSH ($SSH_PORT), 80 y 443. ¿Continuar?"
    run ufw default deny incoming
    run ufw default allow outgoing
    run ufw allow "$SSH_PORT/tcp"
    run ufw allow 80/tcp
    run ufw allow 443/tcp
    run ufw --force enable
    ok "UFW activo (SSH $SSH_PORT, 80, 443). Docker solo publica en 127.0.0.1."
  else
    warn "ufw no instalado: sudo apt install ufw (y vuelve a ejecutar, o configura el firewall del proveedor)"
  fi
fi
if [ "$SKIP_SSH" = 0 ]; then
  # Solo se desactivan las contraseñas si hay una vía de entrada por CLAVE ya
  # verificable: preferentemente una cuenta administrativa NO root (grupo sudo).
  admin_user="${SUDO_USER:-root}"
  admin_home="$(getent passwd "$admin_user" | cut -d: -f6)"
  admin_ok=0
  if [ "$admin_user" != root ] && id -nG "$admin_user" 2>/dev/null | grep -qwE 'sudo|admin' && [ -s "$admin_home/.ssh/authorized_keys" ]; then
    admin_ok=1; ok "Cuenta administrativa '$admin_user' (grupo sudo) con clave SSH autorizada"
  elif [ -s /root/.ssh/authorized_keys ]; then
    admin_ok=1; warn "Solo root tiene clave SSH: crea una cuenta administrativa no root con clave (ver SEGURIDAD_SERVIDOR.md §2)"
  fi
  if [ "$admin_ok" = 1 ]; then
    confirm "Se desactivará el acceso SSH por contraseña (solo claves). Comprueba que puedes entrar con tu clave. ¿Continuar?"
    run install -D -m 0644 "$SD_DIR/deploy/ssh/99-servicedesk-hardening.conf" /etc/ssh/sshd_config.d/99-servicedesk-hardening.conf
    if [ "$DRY" = 0 ]; then
      if sshd -t; then systemctl reload ssh 2>/dev/null || systemctl reload sshd; ok "SSH endurecido (sin contraseña, sin root por contraseña)"
      else rm -f /etc/ssh/sshd_config.d/99-servicedesk-hardening.conf; die "sshd -t falló: se retiró el cambio, SSH queda como estaba"; fi
    fi
  else
    warn "No hay ninguna clave SSH autorizada: NO se desactiva el acceso por contraseña (evita quedarte fuera). Autoriza tu clave y aplica deploy/ssh/99-servicedesk-hardening.conf a mano (SEGURIDAD_SERVIDOR.md §2)."
  fi
fi
if [ "$TEST" = 0 ]; then
  run install -D -m 0644 "$SD_DIR/deploy/logrotate/servicedesk" /etc/logrotate.d/servicedesk
  ok "logrotate de logs del host instalado"
fi

# ----------------------------------------------------------------- 4. build
section "4. Construcción de imágenes"
run sd_compose pull mssql
run sd_compose build

# ----------------------------------------------------------------- 5. SQL Server
section "5. SQL Server"
run sd_compose up -d mssql
if [ "$DRY" = 0 ]; then
  for i in $(seq 1 60); do
    st="$(docker inspect -f '{{.State.Health.Status}}' "$(sd_container mssql)" 2>/dev/null || echo starting)"
    [ "$st" = healthy ] && break; [ "$i" = 60 ] && die "SQL Server no llegó a healthy"; sleep 5
  done
  edition="$(sd_query "SELECT CAST(SERVERPROPERTY('Edition') AS nvarchar(128));" | tr -d '\r' | head -n1)"
  version="$(sd_query "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(32));" | tr -d '\r' | head -n1)"
  ok "SQL Server en marcha: $edition · $version"
  case "$pid" in Express|Standard|Enterprise|Developer|Evaluation)
    [[ "$edition" == *"$pid"* ]] || die "La edición real ('$edition') no coincide con MSSQL_PID=$pid";; esac
fi

# ----------------------------------------------------------------- 6. datos
section "6. Datos (modo $MODE)"
if [ "$MODE" = clean ]; then
  run sd_compose run --rm --no-deps mssql-init
else
  args=(--from "$FROM" --with-uploads); [ "$REPLACE" = 1 ] && args+=(--replace); [ "$YES" = 1 ] && args+=(--yes)
  run "$SD_DIR/scripts/restore-mssql.sh" "${args[@]}"
fi

# ----------------------------------------------------------------- 7. servicios
section "7. Microservicios, gateway y frontend"
if [ "$MODE" = clean ]; then
  run env RUN_SEED=true docker compose -p "$SD_PROJECT" -f "$SD_COMPOSE_FILE" --env-file "$SD_ENV_FILE" up -d
else
  run env RUN_SEED=false docker compose -p "$SD_PROJECT" -f "$SD_COMPOSE_FILE" --env-file "$SD_ENV_FILE" up -d
fi
if [ "$DRY" = 0 ]; then
  sd_wait_healthy 900 || { sd_compose ps; die "Servicios sin healthy. Revisa: docker compose logs"; }
  ok "6/6 servicios healthy"
  if [ "$MODE" = clean ]; then
    log "Recreando servicios con RUN_SEED=false (el seed solo corre en el primer arranque)"
    env RUN_SEED=false docker compose -p "$SD_PROJECT" -f "$SD_COMPOSE_FILE" --env-file "$SD_ENV_FILE" up -d auth-service catalog-service ticket-service >/dev/null
    sd_wait_healthy 600 || die "Servicios sin healthy tras recrear"
    ok "servicios recreados sin seed"
  fi
fi

# ----------------------------------------------------------------- 7b. admin
if [ "$MODE" = clean ]; then
  section "7b. Administrador inicial (bootstrap seguro)"
  ia="$(sd_env_get INITIAL_ADMIN_EMAIL)"; in="$(sd_env_get INITIAL_ADMIN_NAME "Administrador ServiceDesk")"
  args=(bootstrap-admin "$ia" "$in"); [ "$(sd_env_get INITIAL_ADMIN_SSO_ONLY false)" = true ] && args+=(--sso-only)
  if [ "$DRY" = 1 ]; then echo "   [dry-run] scripts/operations/manage-user.sh ${args[*]}"
  else
    set +e; "$SD_DIR/scripts/operations/manage-user.sh" "${args[@]}"; rc=$?; set -e
    [ "$rc" = 0 ] || [ "$rc" = 3 ] || die "No se pudo crear el administrador inicial"
  fi
fi

# ----------------------------------------------------------------- 8. smoke
section "8. Smoke test"
run "$SD_DIR/scripts/operations/smoke-server.sh"

# ----------------------------------------------------------------- 9. nginx / systemd
if [ "$SKIP_NGINX" = 0 ]; then section "9. nginx"; render_nginx; fi
if [ "$SKIP_SYSTEMD" = 0 ]; then
  section "10. Backups automáticos cifrados (Restic + systemd)"
  # Configuración del backup externo: FUERA de deploy/server/.env (que se respalda
  # dentro del repositorio cifrado). Plantilla vacía si no existe; nunca se sobrescribe.
  run install -d -m 700 /etc/servicedesk
  if [ ! -f /etc/servicedesk/backup.env ]; then
    run install -m 600 "$SD_DIR/deploy/backup/backup.env.example" /etc/servicedesk/backup.env
    warn "Creado /etc/servicedesk/backup.env VACÍO: complétalo (docs/operations/CONFIGURACION_BACKBLAZE.md)"
  else
    run chmod 600 /etc/servicedesk/backup.env; ok "/etc/servicedesk/backup.env existente: se conserva"
  fi
  rimg="$(SD_ENV_FILE=/etc/servicedesk/backup.env sd_env_get RESTIC_IMAGE restic/restic:0.18.0)"
  run docker pull -q "$rimg"
  for u in servicedesk-backup.service servicedesk-backup.timer servicedesk-alert@.service \
           servicedesk-backup-check.service servicedesk-backup-check.timer \
           servicedesk-backup-verify.service servicedesk-backup-verify.timer \
           servicedesk-backup-retention.service servicedesk-backup-retention.timer \
           servicedesk-restore-drill.service servicedesk-restore-drill.timer; do
    if [ "$DRY" = 1 ]; then echo "   [dry-run] instalar /etc/systemd/system/$u"; else
      sed "s#__SD_DIR__#$SD_DIR#g" "$SD_DIR/deploy/systemd/$u" > "/etc/systemd/system/$u"; fi
  done
  run chmod +x "$SD_DIR"/scripts/*.sh "$SD_DIR"/scripts/operations/*.sh "$SD_DIR"/scripts/backup/*.sh
  run systemctl daemon-reload
  run systemctl enable --now servicedesk-backup.timer servicedesk-backup-check.timer \
      servicedesk-backup-verify.timer servicedesk-backup-retention.timer servicedesk-restore-drill.timer
  ok "timers activos (systemctl list-timers 'servicedesk-*')"
  warn "Antes del primer backup: clave Restic + custodia + restic-init (docs/operations/CONFIGURACION_BACKBLAZE.md §6-8)"
fi

if [ "$DRY" = 0 ]; then
  printf 'mode=%s\ndate=%s\nproject=%s\nfrom=%s\npurpose=%s\nmssql_pid=%s\n' "$MODE" "$(date -u +%FT%TZ)" "$SD_PROJECT" "${FROM:-}" "$purpose" "$([ "$pid" = Developer ] || [ "$pid" = Express ] || [ "$pid" = Standard ] || [ "$pid" = Enterprise ] && echo "$pid" || echo clave)" > "$STATE_FILE"
fi

# ----------------------------------------------------------------- 11. verificación final
section "11. Verificación final (salud y backups)"
if [ "$DRY" = 0 ]; then
  "$SD_DIR/scripts/operations/server-health.sh" --brief || warn "server-health.sh informa avisos (revisa la salida)"
  if [ -f "${SD_BACKUP_ENV:-/etc/servicedesk/backup.env}" ] && [ -n "$(SD_ENV_FILE="${SD_BACKUP_ENV:-/etc/servicedesk/backup.env}" sd_env_get RESTIC_REPOSITORY)$(SD_ENV_FILE="${SD_BACKUP_ENV:-/etc/servicedesk/backup.env}" sd_env_get B2_BUCKET)" ]; then
    "$SD_DIR/scripts/backup/restic-test-connection.sh" >/dev/null 2>&1 && ok "repositorio de backups externo accesible" \
      || warn "repositorio de backups externo NO accesible: scripts/backup/restic-test-connection.sh"
  else
    warn "backups externos sin configurar: el primer backup terminará con código 3 (alerta) hasta configurarlos"
  fi
fi
section "Instalación terminada"
echo "  Estado:      docker compose -p $SD_PROJECT -f $SD_COMPOSE_FILE --env-file $SD_ENV_FILE ps"
echo "  Usuarios:    scripts/operations/manage-user.sh set-role <correo> technician|dtic|admin"
[ "$MODE" = clean ] && [ -f "$(dirname "$SD_ENV_FILE")/.initial-admin-secret" ] && \
  echo "  Admin:       contraseña temporal en $(dirname "$SD_ENV_FILE")/.initial-admin-secret (léela y bórrala)"
echo "  Backup ya:   systemctl start servicedesk-backup.service && journalctl -u servicedesk-backup -n 50"
