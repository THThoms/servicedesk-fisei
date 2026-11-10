#!/usr/bin/env bash
# =============================================================================
# scripts/testing/new-server-simulation.sh — simula un SERVIDOR NUEVO en local
#
# Verifica de punta a punta que el paquete de instalación funciona sin depender
# de esta carpeta, del VPS, de sus volúmenes, redes, .env ni certificados:
#
#   1. genera el paquete (build-server-package.sh) y lo EXTRAE en un directorio
#      temporal vacío — la instalación se hace desde esa copia;
#   2. MODO A (limpio) en el proyecto Docker aislado "sdsimclean", con secretos
#      nuevos generados por el instalador y SQL Server DEVELOPER como servidor
#      de PRUEBAS (SERVER_PURPOSE=pruebas, Fase T);
#   3b. arquitectura (Fase T): imágenes fijadas, volúmenes SQL separados y sin
#      root, redes aisladas, puertos solo en loopback, readiness, caída y
#      recuperación de SQL Server, política de reinicio, server-health.sh;
#   3. nginx de prueba con TLS autofirmado usando deploy/nginx/*.template;
#   4. smoke post-instalación (curl) directo y a través de nginx;
#   5. usuarios de prueba con manage-user.sh + E2E funcional (smoke-e2e.mjs);
#   6. backup (backup-mssql.sh) + verificación (check-backup.sh);
#   7. reinicio y down/up (sin -v) → persistencia;
#   8. MODO B (restauración) en OTRO proyecto "sdsimrestore", con credenciales
#      DISTINTAS y SQL Server EXPRESS (cambio de edición solo por configuración)
#      desde el backup del paso 6 → conteos, login, imágenes;
#   9. guardas: reinstalar limpio encima / restaurar sin --replace → rechazado.
#
#   scripts/testing/new-server-simulation.sh            # ejecuta todo
#   scripts/testing/new-server-simulation.sh --cleanup  # borra SOLO los proyectos de prueba
#   FROM_PACKAGE=release/<paquete>.tar.gz scripts/testing/new-server-simulation.sh
#       instala desde ese paquete, sin generar otro a partir del repositorio
#
# Requiere Docker, bash, curl, openssl, tar, sha256sum y Node 20+ (para el E2E).
# NO toca el laboratorio (servicedesk-microservices) ni ningún servidor remoto.
# =============================================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash (Windows): no reescribir rutas /var/opt/...
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${SIM_WORK:-${TMPDIR:-/tmp}/servicedesk-sim}"
P_CLEAN=sdsimclean; P_RESTORE=sdsimrestore
GW1=28080; FE1=23000; TLS1=28443; GW2=38080; FE2=33000

if [ "${1:-}" = "--cleanup" ]; then
  for p in $P_CLEAN $P_RESTORE; do
    docker rm -f "${p}-nginx-test" >/dev/null 2>&1 || true
    ids="$(docker ps -aq --filter "label=com.docker.compose.project=$p")"; [ -n "$ids" ] && docker rm -f $ids >/dev/null
    for v in $(docker volume ls -q --filter "label=com.docker.compose.project=$p"); do docker volume rm "$v" >/dev/null; done
    for n in $(docker network ls -q --filter "label=com.docker.compose.project=$p"); do docker network rm "$n" >/dev/null; done
    echo "proyecto de prueba $p eliminado"
  done
  rm -f "$ROOT"/release/servicedesk-uta-server-sim-*   # paquetes temporales de esta prueba
  rm -rf "$WORK"; exit 0
fi

hc() { curl -s -o "$WORK/.curl.out" -w '%{http_code}' "$@" || true; }   # código HTTP, portable
step() { printf '\n\033[1m######## %s ########\033[0m\n' "$*"; }
RESULTS=(); res() { RESULTS+=("$1|$2"); }
for p in $P_CLEAN $P_RESTORE; do
  if docker volume ls -q --filter "label=com.docker.compose.project=$p" | grep -q .; then
    echo "Ya existen volúmenes del proyecto de prueba $p. Ejecuta primero: $0 --cleanup"; exit 1
  fi
done
rm -rf "$WORK"; mkdir -p "$WORK"

step "1. Paquete"
if [ -n "${FROM_PACKAGE:-}" ]; then
  PKG="$FROM_PACKAGE"; echo "Paquete indicado: $(basename "$PKG")"
else
  VERSION="sim-$(date -u +%Y%m%d%H%M%S)"
  "$ROOT/scripts/build-server-package.sh" "$VERSION" | tail -n 4
  PKG="$ROOT/release/servicedesk-uta-server-$VERSION.tar.gz"
fi
( cd "$(dirname "$PKG")" && sha256sum -c "$(basename "$PKG").sha256" ) && res "Paquete: SHA-256" OK
mkdir -p "$WORK/clean" "$WORK/restore"
tar -xzf "$PKG" -C "$WORK/clean" --strip-components=1
tar -xzf "$PKG" -C "$WORK/restore" --strip-components=1
find "$WORK/clean" -name '.env' -o -name '.env.mssql' | grep -q . && { echo "✘ el paquete contiene .env"; exit 1; } || res "Paquete: sin .env reales" OK

write_env() { # write_env <dir> <gw> <fe> <public_domain> [MSSQL_PID] [SERVER_PURPOSE]
  local d="$1"; local f="$d/deploy/server/.env"
  cp "$d/.env.example" "$f"
  sed -i -e "s#^PUBLIC_DOMAIN=.*#PUBLIC_DOMAIN=$4#" -e "s#^MSSQL_PID=.*#MSSQL_PID=${5:-Express}#" \
         -e "s#^SERVER_PURPOSE=.*#SERVER_PURPOSE=${6:-produccion}#" \
         -e "s#^GATEWAY_BIND_PORT=.*#GATEWAY_BIND_PORT=$2#" -e "s#^FRONTEND_BIND_PORT=.*#FRONTEND_BIND_PORT=$3#" \
         -e "s#^INITIAL_ADMIN_EMAIL=.*#INITIAL_ADMIN_EMAIL=e2e.admin@uta.edu.ec#" \
         -e "s#^BACKUP_DIR=.*#BACKUP_DIR=$WORK/backups#" "$f"
  printf 'PUBLIC_SCHEME=https\nBACKUP_REQUIRE_OFFSITE=false\nMSSQL_CONTAINER_MEMORY=3g\n' >> "$f"
}
# Fase R: la contraseña del admin ya NO va en el .env. ADMIN_PW es la que el E2E
# fijará al cambiar la contraseña TEMPORAL generada por el bootstrap.
ADMIN_PW="Adm-$(openssl rand -hex 8)_Q7x"; E2E_PW="E2e-$(openssl rand -hex 8)_Q7x"
write_env "$WORK/clean" $GW1 $FE1 "localhost:$TLS1" Developer pruebas

step "2. Guardas del instalador"
if "$WORK/clean/scripts/install-server.sh" --test-mode --yes --project $P_CLEAN >/dev/null 2>&1; then res "Sin --mode → rechazado" FALLO; else res "Sin --mode → rechazado" OK; fi
set +e
# Guardas de edición con un .env APARTE (secretos ficticios válidos: --dry-run no
# genera secretos y, sin ellos, la validación fallaría antes de llegar a la edición).
G="$WORK/guard.env"
guard() { sed -e "s#^MSSQL_PID=.*#MSSQL_PID=${2-Developer}#" -e "s#^SERVER_PURPOSE=.*#SERVER_PURPOSE=$1#" -e "s#^PUBLIC_DOMAIN=.*#PUBLIC_DOMAIN=localhost:$TLS1#"     -e "s#^INITIAL_ADMIN_EMAIL=.*#INITIAL_ADMIN_EMAIL=e2e.admin@uta.edu.ec#" -e "s#^MSSQL_SA_PASSWORD=.*#MSSQL_SA_PASSWORD=Guard-Sa-0001_Xy#"     -e "s#^AUTH_DB_PASSWORD=.*#AUTH_DB_PASSWORD=Guard-Au-0002_Xy#" -e "s#^CATALOG_DB_PASSWORD=.*#CATALOG_DB_PASSWORD=Guard-Ca-0003_Xy#"     -e "s#^TICKET_DB_PASSWORD=.*#TICKET_DB_PASSWORD=Guard-Ti-0004_Xy#" -e "s#^JWT_SECRET=.*#JWT_SECRET=guardguardguardguardguardguardguard12#"     "$WORK/clean/.env.example" > "$G"
  SD_ALLOW_EXTERNAL_ENV=1 SD_ENV_FILE="$G" "$WORK/clean/scripts/install-server.sh" --mode clean --yes --test-mode --dry-run --project sdguard 2>&1; }
out="$(guard produccion)"; rc=$?
[ "$rc" != 0 ] && printf '%s' "$out" | grep -q "BLOQUEADO: MSSQL_PID=Developer no es apto para producción"   && res "Developer con SERVER_PURPOSE=produccion → BLOQUEADO (mensaje verificado)" OK || res "Developer en producción" "FALLO rc=$rc"
out="$(guard pruebas)"; rc=$?
[ "$rc" = 0 ] && printf '%s' "$out" | grep -q "SOLO para desarrollo, evaluación y pruebas"   && res "Developer con SERVER_PURPOSE=pruebas → aceptado con aviso de licencia" OK || res "Developer en pruebas" "FALLO rc=$rc"
out="$(guard pruebas "")"; rc=$?
[ "$rc" != 0 ] && printf '%s' "$out" | grep -q "BLOQUEADO: MSSQL_PID vacío" && res "MSSQL_PID vacío → BLOQUEADO (mensaje verificado)" OK || res "MSSQL_PID vacío" "FALLO rc=$rc"
rm -f "$G"
out="$(SD_ENV_FILE="$WORK/clean/deploy/server/.env" "$WORK/clean/scripts/install-server.sh" --mode clean --yes --test-mode --dry-run 2>&1)"; rc=$?
[ "$rc" != 0 ] && printf '%s' "$out" | grep -q "SD_ENV_FILE está definido" && res "Instalador rechaza un SD_ENV_FILE heredado del entorno" OK || res "Guarda SD_ENV_FILE" "FALLO rc=$rc"
set -e

step "3. MODO A — instalación limpia (proyecto $P_CLEAN)"
set -o pipefail
"$WORK/clean/scripts/install-server.sh" --mode clean --generate-secrets --test-mode --yes --project $P_CLEAN 2>&1 | tee "$WORK/install-clean.log" \
  && res "Instalación limpia + smoke post-instalación" OK || { res "Instalación limpia" FALLO; printf '%s\n' "${RESULTS[@]}"; exit 1; }
SECRET="$WORK/clean/deploy/server/.initial-admin-secret"
[ -s "$SECRET" ] && res "Bootstrap admin: secreto temporal en archivo dedicado" OK || res "Bootstrap admin: secreto temporal" FALLO
ADMIN_TEMP_PW="$(head -n1 "$SECRET" | tr -d '\r\n')"
leak=0
grep -qF -- "$ADMIN_TEMP_PW" "$WORK/install-clean.log" && leak=$((leak+1))
grep -qF -- "$ADMIN_TEMP_PW" "$WORK/clean/deploy/server/.env" && leak=$((leak+1))
grep -q '^INITIAL_ADMIN_PASSWORD=' "$WORK/clean/deploy/server/.env" && leak=$((leak+1))
use_env() { unset SD_ENV_FILE SD_COMPOSE_FILE; SD_DIR="$1"; SD_PROJECT="$2"; . "$1/scripts/lib/common.sh"; }
use_env "$WORK/clean" $P_CLEAN
docker inspect "$(sd_container auth-service 2>/dev/null || sd_compose ps -q auth-service)" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
  | grep -qF -- "$ADMIN_TEMP_PW" && leak=$((leak+1))
[ "$leak" = 0 ] && res "Contraseña temporal NO aparece en logs, .env ni entorno del contenedor" OK || res "Contraseña temporal filtrada" "FALLO ($leak)"
set +e; SD_PROJECT=$P_CLEAN "$WORK/clean/scripts/operations/manage-user.sh" bootstrap-admin otro.admin@uta.edu.ec >/dev/null 2>&1; rc=$?; set -e
[ "$rc" = 3 ] && res "Bootstrap no crea un segundo administrador (exit 3)" OK || res "Bootstrap segundo admin" "FALLO rc=$rc"
ED="$(sd_query "SELECT CAST(SERVERPROPERTY('Edition') AS nvarchar(128));" | tr -d '\r' | head -n1)"; echo "Edición real: $ED"
[[ "$ED" == Developer* ]] && res "Servidor de pruebas con SQL Server Developer" OK || res "Edición Developer" "FALLO ($ED)"

step "3b. Arquitectura (Fase T)"
set +e
latest="$(docker ps --filter "label=com.docker.compose.project=$P_CLEAN" --format '{{.Image}}' | grep -c ':latest' || true)"
mimg="$(docker inspect -f '{{.Config.Image}}' "$(sd_container mssql)")"
[ "$latest" = 0 ] && [[ "$mimg" == *2022-CU27-GDR1-ubuntu-22.04@sha256:* ]] && res "Imágenes fijadas: SQL Server CU27-GDR1 por digest, sin :latest" OK || res "Imágenes fijadas" "FALLO ($mimg)"
nv="$(docker exec "$(sd_container auth-service)" node --version)"; ngv="$(docker exec "$(sd_container frontend)" nginx -v 2>&1 | sed 's#.*/##')"
[ "$nv" = v22.23.4 ] && [ "$ngv" = 1.28.3 ] && res "Runtime Node $nv (LTS) y nginx $ngv" OK || res "Runtime" "FALLO ($nv / $ngv)"
vols="$(docker volume ls -q --filter "label=com.docker.compose.project=$P_CLEAN" | sed "s#^${P_CLEAN}_##" | sort | tr '\n' ' ')"
[ "$vols" = "mssql-backup mssql-data mssql-system mssql-tlog ticket-uploads " ] && res "Volúmenes independientes: $vols" OK || res "Volúmenes" "FALLO ($vols)"
uid="$(docker exec "$(sd_container mssql)" id -u)"
own="$(docker exec "$(sd_container mssql)" stat -c '%u:%a' /var/opt/mssql /var/opt/mssql/data /var/opt/mssql/tlog /var/opt/mssql/backup | sort -u | tr '\n' ' ')"
[ "$uid" = 10001 ] && [ "$own" = "10001:770 " ] && res "SQL Server sin root (uid 10001) · volúmenes 10001/770" OK || res "Propietarios SQL" "FALLO (uid=$uid $own)"
files="$(sd_query "SELECT CONCAT(type_desc COLLATE DATABASE_DEFAULT, ':', LEFT(physical_name, LEN(physical_name) - CHARINDEX('/', REVERSE(physical_name))) COLLATE DATABASE_DEFAULT) FROM sys.master_files WHERE database_id IN (DB_ID('auth_db'), DB_ID('catalog_db'), DB_ID('ticket_db'));" | tr -d '\r' | sort -u | tr '\n' ' ')"
[ "$files" = "LOG:/var/opt/mssql/tlog ROWS:/var/opt/mssql/data " ] && res "Datos (.mdf) en data/ y logs (.ldf) en tlog/" OK || res "Ubicación de archivos SQL" "FALLO ($files)"
pubp="$(docker ps --filter "label=com.docker.compose.project=$P_CLEAN" --format '{{.Ports}}' | tr ',' '\n' | grep -E '\->' | grep -vc '127\.0\.0\.1:' || true)"
[ "$pubp" = 0 ] && res "Puertos publicados solo en 127.0.0.1 (1433 sin publicar)" OK || res "Puertos expuestos" "FALLO ($pubp)"
docker exec "$(sd_container frontend)" wget -q -T 3 -O /dev/null http://auth-service:3001/health 2>/dev/null && res "frontend aislado de los microservicios" FALLO || res "Red edge: el frontend NO alcanza los microservicios" OK
docker exec "$(sd_container frontend)" wget -q -T 3 -O /dev/null http://mssql:1433 2>/dev/null && res "frontend aislado de SQL" FALLO || res "Red edge: el frontend NO alcanza SQL Server" OK
docker exec "$(sd_container api-gateway)" wget -q -T 3 -O /dev/null http://mssql:1433 2>/dev/null && res "gateway aislado de SQL" FALLO || res "Red app: el gateway NO alcanza SQL Server" OK
o="$(docker run --rm --network "${P_CLEAN}_data" --entrypoint sh restic/restic:0.18.0 -c 'wget -q -T 5 -O /dev/null https://www.microsoft.com 2>/dev/null && echo SALE || echo NO_SALE')"
[ "$o" = NO_SALE ] && res "Red data interna: SQL Server sin salida a Internet" OK || res "Red data" "FALLO ($o)"
r="$(hc "http://127.0.0.1:$GW1/health/ready")"; [ "$r" = 200 ] && res "Readiness del gateway (3 servicios + bases) → 200" OK || res "Readiness" "FALLO $r"
# `docker compose stop mssql` detendría también a los servicios que dependen de él: la
# caída real es la del motor solo, con los microservicios vivos.
mcid="$(sd_container mssql)"; docker stop "$mcid" >/dev/null
r=""; for i in $(seq 1 20); do r="$(hc "http://127.0.0.1:$GW1/health/ready")"; [ "$r" = 503 ] && break; sleep 3; done
[ "$r" = 503 ] && res "SQL Server caído → readiness 503 (no un falso healthy)" OK || res "Detección de caída" "FALLO $r"
h=""; for i in $(seq 1 60); do h="$(docker inspect -f '{{.State.Health.Status}}' "$(sd_container auth-service)")"; [ "$h" = unhealthy ] && break; sleep 5; done
[ "$h" = unhealthy ] && res "Healthcheck Docker de auth-service → unhealthy con la base caída" OK || res "Healthcheck unhealthy" "FALLO ($h)"
docker start "$mcid" >/dev/null
sd_wait_healthy 600 && [ "$(hc "http://127.0.0.1:$GW1/health/ready")" = 200 ] && res "Recuperación automática: SQL vuelve → 6/6 healthy y readiness 200" OK || res "Recuperación" FALLO
# `docker kill` cuenta como parada manual y Docker NO aplicaría la política de reinicio:
# una muerte real del proceso se simula con SIGKILL desde el espacio de PID del host.
acid="$(sd_container auth-service)"; rc0="$(docker inspect -f '{{.RestartCount}}' "$acid")"
docker run --rm --pid=host --entrypoint kill nginx:1.28.3-alpine -9 "$(docker inspect -f '{{.State.Pid}}' "$acid")" >/dev/null
sleep 5; sd_wait_healthy 300 >/dev/null; rc1="$(docker inspect -f '{{.RestartCount}}' "$acid")"
[ "$rc1" -gt "$rc0" ] && [ "$(hc "http://127.0.0.1:$GW1/health/ready")" = 200 ] && res "Proceso muerto → reinicio automático (restart policy) y healthy" OK || res "Restart policy" "FALLO ($rc0→$rc1)"
SD_PROJECT=$P_CLEAN BACKUP_DIR="$WORK/backups" "$WORK/clean/scripts/operations/server-health.sh" > "$WORK/server-health.log" 2>&1; rc=$?
sed 's/\x1b\[[0-9;]*m//g' "$WORK/server-health.log" | grep -E '\[(FALLO|AVISO)\]|Resumen' | head -n 12
leakh=0; for k in MSSQL_SA_PASSWORD AUTH_DB_PASSWORD JWT_SECRET; do s="$(sed -n "s/^$k=//p" "$WORK/clean/deploy/server/.env")"; [ -n "$s" ] && grep -qF -- "$s" "$WORK/server-health.log" && leakh=1; done
[ "$rc" = 0 ] && [ "$leakh" = 0 ] && res "server-health.sh: sin fallos y sin secretos en la salida" OK || res "server-health.sh" "FALLO rc=$rc leak=$leakh"
set -e

step "4. nginx de prueba (plantilla real + TLS autofirmado)"
mkdir -p "$WORK/nginx/certs"
openssl req -x509 -nodes -newkey rsa:2048 -days 2 -subj "/CN=localhost" \
  -keyout "$WORK/nginx/certs/privkey.pem" -out "$WORK/nginx/certs/fullchain.pem" >/dev/null 2>&1
sed -e "s#__SERVER_NAME__#localhost#g" -e "s#__UPSTREAM_GATEWAY__#api-gateway:8080#g" \
    -e "s#__UPSTREAM_FRONTEND__#frontend:80#g" -e "s#__CERT_DIR__#/etc/nginx/certs#g" \
    "$WORK/clean/deploy/nginx/servicedesk.conf.template" > "$WORK/nginx/servicedesk.conf"
NGINX_DIR="$WORK/nginx"; command -v cygpath >/dev/null && NGINX_DIR="$(cygpath -m "$WORK/nginx")"
docker run -d --name "${P_CLEAN}-nginx-test" --network "${P_CLEAN}_edge" -p "127.0.0.1:$TLS1:443" \
  -v "$NGINX_DIR/servicedesk.conf:/etc/nginx/conf.d/default.conf:ro" -v "$NGINX_DIR/certs:/etc/nginx/certs:ro" \
  nginx:1.28.3-alpine >/dev/null
sleep 3
docker exec "${P_CLEAN}-nginx-test" nginx -t >/dev/null 2>&1 && res "nginx -t con la plantilla" OK || res "nginx -t con la plantilla" FALLO
SD_PROJECT=$P_CLEAN SMOKE_BASE_URL="https://localhost:$TLS1" SMOKE_INSECURE=1 "$WORK/clean/scripts/operations/smoke-server.sh" \
  && res "Smoke a través de nginx/TLS" OK || res "Smoke a través de nginx/TLS" FALLO
c="$(hc -k "https://localhost:$TLS1/uploads/x.jpg")"; [ "$c" = 404 ] && res "nginx: /uploads/ bloqueado (404)" OK || res "nginx: /uploads/ bloqueado" "FALLO $c"
c="$(hc "http://127.0.0.1:$TLS1/")"; res "nginx: solo HTTPS en el puerto TLS (HTTP plano → $c)" OK
hsts="$(curl -skI "https://localhost:$TLS1/" | grep -ci strict-transport-security || true)"; [ "$hsts" -ge 1 ] && res "nginx: cabecera HSTS" OK || res "nginx: cabecera HSTS" FALLO
# Redirect URI de Azure: debe llegar a auth-service (302 a /login con el error), nunca a la SPA (200).
cb="$(curl -sk -o "$WORK/.curl.out" -w '%{http_code} %{redirect_url}' "https://localhost:$TLS1/auth/callback?code=x&state=y" || true)"
[[ "$cb" == "302 "*"/login?error="* ]] && res "nginx: /auth/callback llega al backend (no a la SPA)" OK || res "nginx: /auth/callback" "FALLO ($cb)"

step "5. Usuarios de prueba + E2E funcional"
export NEW_USER_PASSWORD="$E2E_PW"
M() { SD_PROJECT=$P_CLEAN "$WORK/clean/scripts/operations/manage-user.sh" "$@"; }
M create e2e.user@uta.edu.ec user "Usuario E2E" --password
M create e2e.user2@uta.edu.ec user "Usuario E2E Dos" --password
M create e2e.tech1@uta.edu.ec technician "Tecnico E2E Uno" --password
M create e2e.tech3@uta.edu.ec dtic "Tecnico DTIC E2E" --password
unset NEW_USER_PASSWORD
M list-staff
E2E_GATEWAY="http://127.0.0.1:$GW1" E2E_FRONTEND="http://127.0.0.1:$FE1" E2E_PASSWORD="$E2E_PW" \
E2E_ADMIN_EMAIL=e2e.admin@uta.edu.ec E2E_ADMIN_PASSWORD="$ADMIN_PW" E2E_ADMIN_TEMP_PASSWORD="$ADMIN_TEMP_PW" \
node "$WORK/clean/scripts/testing/smoke-e2e.mjs" \
  && res "E2E funcional (modo limpio)" OK || res "E2E funcional (modo limpio)" FALLO

counts() { sd_query "SELECT CONCAT('users=', (SELECT COUNT(*) FROM auth_db.dbo.users), ' services=', (SELECT COUNT(*) FROM catalog_db.dbo.services), ' kb=', (SELECT COUNT(*) FROM catalog_db.dbo.knowledge_articles), ' tickets=', (SELECT COUNT(*) FROM ticket_db.dbo.tickets), ' events=', (SELECT COUNT(*) FROM ticket_db.dbo.ticket_events), ' attachments=', (SELECT COUNT(*) FROM ticket_db.dbo.attachments), ' outbox=', (SELECT COUNT(*) FROM ticket_db.dbo.email_outbox), ' devices=', (SELECT COUNT(*) FROM ticket_db.dbo.device_tokens));" | tr -d '\r' | head -n1; }
C0="$(counts)"; echo "Conteos tras E2E: $C0"
demo="$(sd_query "SELECT COUNT(*) FROM auth_db.dbo.users WHERE email IN ('admin@uta.edu.ec','docente@uta.edu.ec','estudiante@uta.edu.ec');" | tr -d '\r' | head -n1)"
[ "$demo" = 0 ] && res "Sin cuentas demo en producción (seed seguro)" OK || res "Sin cuentas demo" "FALLO ($demo)"
idx="$(sd_query "SELECT COUNT(*) FROM auth_db.sys.indexes WHERE name='users_ms_oid_key_filtered';" | tr -d '\r' | head -n1)"
[ "$idx" = 1 ] && res "Filtered index ms_oid" OK || res "Filtered index ms_oid" FALLO
plain="$(sd_query "SELECT CONCAT(COUNT(*), '/', SUM(CASE WHEN LEN(token) = 64 AND token NOT LIKE '%.%' THEN 1 ELSE 0 END)) FROM auth_db.dbo.sessions;" | tr -d '\r' | head -n1)"
[ "${plain%%/*}" -gt 0 ] && [ "${plain%%/*}" = "${plain##*/}" ] && res "Sesiones guardadas solo como SHA-256 ($plain)" OK || res "Sesiones con hash" "FALLO ($plain)"
legacyroles="$(sd_query "SELECT COUNT(*) FROM auth_db.dbo.users WHERE role LIKE 'tech[_]n%';" | tr -d '\r' | head -n1)"
roles="$(sd_query "SELECT STRING_AGG(CONCAT(role, '=', n), ' ') FROM (SELECT role, COUNT(*) n FROM auth_db.dbo.users GROUP BY role) x;" | tr -d '\r' | head -n1)"
[ "$legacyroles" = 0 ] && res "Solo roles oficiales en auth_db ($roles)" OK || res "Roles oficiales" "FALLO ($roles)"
closed="$(sd_query "SELECT COUNT(*) FROM ticket_db.dbo.tickets WHERE status = 'cerrado';" | tr -d '\r' | head -n1)"
[ "$closed" -ge 1 ] && res "Ticket validado por el usuario queda CERRADO" OK || res "Estado cerrado" "FALLO ($closed)"
set +e
nacc="$(sd_query "SELECT COUNT(*) FROM ticket_db.dbo.solution_acceptances;" | tr -d '\r' | head -n1)"
[ "${nacc:-0}" -ge 2 ] && res "Constancias de aceptación digital guardadas en ticket_db ($nacc)" OK || res "Constancias en BD" "FALLO ($nacc)"
up="$(sd_query "UPDATE ticket_db.dbo.solution_acceptances SET reason = N'manipulado';" 2>&1)"; urc=$?
dl="$(sd_query "DELETE FROM ticket_db.dbo.solution_acceptances;" 2>&1)"; drc=$?
after="$(sd_query "SELECT COUNT(*) FROM ticket_db.dbo.solution_acceptances WHERE reason = N'manipulado';" | tr -d '\r' | head -n1)"
left="$(sd_query "SELECT COUNT(*) FROM ticket_db.dbo.solution_acceptances;" | tr -d '\r' | head -n1)"
[ "$urc" != 0 ] && [ "$drc" != 0 ] && [ "$after" = 0 ] && [ "$left" = "$nacc" ] && printf '%s' "$up" | grep -q "inmutable" \
  && res "Constancias inmutables en SQL Server (UPDATE/DELETE rechazados por trigger, incluso como sa)" OK || res "Inmutabilidad de constancias" "FALLO (u=$urc d=$drc)"
tv="$(sd_query "SELECT CONCAT(version, '|', LEN(sha256)) FROM ticket_db.dbo.acceptance_terms;" | tr -d '\r' | head -n1)"
[ "$tv" = "1.0|64" ] && res "Términos v1.0 publicados con SHA-256" OK || res "Términos publicados" "FALLO ($tv)"
blk="$(sd_query "SELECT COUNT(*) FROM auth_db.dbo.users WHERE fisei_block IS NOT NULL AND role <> 'technician';" | tr -d '\r' | head -n1)"
[ "$blk" = 0 ] && res "Ningún usuario que no sea técnico tiene bloque" OK || res "Bloques solo técnicos" "FALLO ($blk)"
set -e
rec="$(sd_query "SELECT COUNT(*) FROM sys.databases WHERE name IN ('auth_db','catalog_db','ticket_db') AND recovery_model_desc='SIMPLE';" | tr -d '\r' | head -n1)"
[ "$rec" = 3 ] && res "3 bases en RECOVERY SIMPLE" OK || res "RECOVERY SIMPLE" "FALLO ($rec)"

step "6. Backup"
export SD_BACKUP_ENV="$WORK/sin-backup-externo.env"   # este paso prueba el modo local; Restic → backup-dr-simulation.sh
SD_PROJECT=$P_CLEAN "$WORK/clean/scripts/backup-mssql.sh" && res "backup-mssql.sh (VERIFYONLY + SHA-256)" OK || res "backup-mssql.sh" FALLO
SD_PROJECT=$P_CLEAN "$WORK/clean/scripts/operations/check-backup.sh" && res "check-backup.sh" OK || res "check-backup.sh" FALLO
BK="$(find "$WORK/backups/sets" -mindepth 1 -maxdepth 1 -type d -name 'sd-20*' | sort | tail -n1)"; ls -la "$BK" "$BK/db"
set +e; SD_PROJECT=$P_CLEAN BACKUP_REQUIRE_OFFSITE=true "$WORK/clean/scripts/backup-mssql.sh" >/dev/null 2>&1; rc=$?; set -e
[ "$rc" = 3 ] && res "Sin copia externa → código 3 (alerta)" OK || res "Sin copia externa → código 3" "FALLO rc=$rc"

step "7. Persistencia: restart y down/up (sin -v)"
sd_compose restart >/dev/null; sd_wait_healthy 600 && res "restart → 6/6 healthy" OK || res "restart" FALLO
C1="$(counts)"; [ "$C1" = "$C0" ] && res "Datos tras restart" OK || res "Datos tras restart" "FALLO $C1"
sd_compose down >/dev/null; RUN_SEED=false sd_compose up -d >/dev/null; sd_wait_healthy 900 && res "down/up → 6/6 healthy" OK || res "down/up" FALLO
C2="$(counts)"; [ "$C2" = "$C0" ] && res "Datos tras down/up" OK || res "Datos tras down/up" "FALLO $C2"
tok="$(curl -s -H 'Content-Type: application/json' -d "{\"correo\":\"e2e.user@uta.edu.ec\",\"password\":\"$E2E_PW\"}" "http://127.0.0.1:$GW1/api/auth/login" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
url="$( (curl -s -H "Authorization: Bearer $tok" "http://127.0.0.1:$GW1/api/tickets/my" | grep -o '"id":"[0-9a-f-]\{36\}"' | head -n1 | cut -d'"' -f4) || true)"
au="$( (curl -s -H "Authorization: Bearer $tok" "http://127.0.0.1:$GW1/api/tickets/history/$url" | grep -o '/api/tickets/[0-9a-f-]*/attachments/[0-9a-f-]*' | head -n1) || true)"
[ -n "$au" ] || echo "AVISO: no se encontró ningún adjunto para la prueba de persistencia (¿falló el E2E?)"
c="$(hc -H "Authorization: Bearer $tok" "http://127.0.0.1:$GW1$au")"
[ "$c" = 200 ] && res "Imagen servida tras down/up (volumen persistente)" OK || res "Imagen tras down/up" "FALLO $c"
unset tok

step "8. MODO B — restauración en otro proyecto ($P_RESTORE) con credenciales nuevas"
write_env "$WORK/restore" $GW2 $FE2 "localhost:$GW2" Express produccion
sed -i "s#^INITIAL_ADMIN_EMAIL=.*#INITIAL_ADMIN_EMAIL=#" "$WORK/restore/deploy/server/.env"
"$WORK/restore/scripts/install-server.sh" --mode restore --from "$BK" --generate-secrets --test-mode --yes --project $P_RESTORE \
  && res "Instalación en modo restauración" OK || res "Instalación en modo restauración" FALLO
diffpw=0; for k in MSSQL_SA_PASSWORD AUTH_DB_PASSWORD JWT_SECRET; do
  a="$(grep "^$k=" "$WORK/clean/deploy/server/.env" | sha256sum)"; b="$(grep "^$k=" "$WORK/restore/deploy/server/.env" | sha256sum)"; [ "$a" != "$b" ] && diffpw=$((diffpw+1)); done
[ "$diffpw" = 3 ] && res "Credenciales independientes en el servidor restaurado" OK || res "Credenciales independientes" FALLO
use_env "$WORK/restore" $P_RESTORE
C3="$(counts)"; echo "Conteos restaurados: $C3"
[ "${C3%% outbox*}" = "${C0%% outbox*}" ] && res "Conteos restaurados = origen" OK || res "Conteos restaurados" "FALLO"
tok="$(curl -s -H 'Content-Type: application/json' -d "{\"correo\":\"e2e.user@uta.edu.ec\",\"password\":\"$E2E_PW\"}" "http://127.0.0.1:$GW2/api/auth/login" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
[ -n "$tok" ] && res "Login de usuario restaurado (JWT nuevo)" OK || res "Login restaurado" FALLO
c="$(hc -H "Authorization: Bearer $tok" "http://127.0.0.1:$GW2$au")"
[ "$c" = 200 ] && res "Imagen restaurada servida por endpoint autenticado" OK || res "Imagen restaurada" "FALLO $c"
unset tok
tokadm="$(curl -s -H 'Content-Type: application/json' -d "{\"correo\":\"e2e.admin@uta.edu.ec\",\"password\":\"$ADMIN_PW\"}" "http://127.0.0.1:$GW2/api/auth/login" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
[ -n "$tokadm" ] && res "Admin restaurado entra con su contraseña ya cambiada" OK || res "Admin restaurado" FALLO
unset tokadm

step "9. Guardas contra mezcla de modos"
if "$WORK/clean/scripts/install-server.sh" --mode clean --test-mode --yes --project $P_CLEAN >/dev/null 2>&1; then res "Reinstalar limpio encima → rechazado" FALLO; else res "Reinstalar limpio encima → rechazado" OK; fi
rm -f "$WORK/restore/deploy/server/.install-state.$P_RESTORE"
if "$WORK/restore/scripts/install-server.sh" --mode restore --from "$BK" --test-mode --yes --project $P_RESTORE >/dev/null 2>&1; then res "Restaurar sobre datos sin --replace → rechazado" FALLO; else res "Restaurar sobre datos sin --replace → rechazado" OK; fi
printf 'mode=restore\nproject=%s\n' $P_RESTORE > "$WORK/restore/deploy/server/.install-state.$P_RESTORE"

step "RESUMEN"
okc=0; fc=0
for r in "${RESULTS[@]}"; do n="${r%%|*}"; s="${r#*|}"; [ "$s" = OK ] && okc=$((okc+1)) || fc=$((fc+1)); printf '  %-62s %s\n' "$n" "$s"; done
echo "SIMULACIÓN: $okc OK · $fc fallos"
echo "Proyectos de prueba: $P_CLEAN (gw $GW1, fe $FE1, nginx $TLS1) · $P_RESTORE (gw $GW2, fe $FE2)"
echo "Limpieza: $0 --cleanup"
[ "$fc" -eq 0 ]
