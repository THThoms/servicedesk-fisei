#!/usr/bin/env bash
# =============================================================================
# scripts/testing/lab-copy-migration-test.sh — Fase T: migración y flujo real
# sobre una COPIA de los datos del laboratorio (el laboratorio solo se lee).
#
#   1. backup del laboratorio (BACKUP DATABASE + imágenes; no modifica datos)
#   2. instalación aislada (proyecto sdlabcopy) en modo RESTORE con el código nuevo:
#      prisma aplica el esquema de la Fase T sobre los datos copiados
#   3. verificación: conteos iguales, sin bloques asignados automáticamente,
#      tablas de aceptación + términos + triggers, adjuntos históricos servidos
#   4. flujo real: foto real → técnico (Bloque 1) resuelve → el usuario acepta
#      DESDE LA INTERFAZ en Chrome real → constancia en SQL Server → reporte
#      por bloque con la validación digital; imágenes renderizadas en Chrome
#
#   scripts/testing/lab-copy-migration-test.sh            # ejecuta
#   scripts/testing/lab-copy-migration-test.sh --cleanup  # borra SOLO sdlabcopy
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v cygpath >/dev/null 2>&1 && ROOT="$(cygpath -m "$ROOT")"
WORK="${SIM_WORK:-${TMPDIR:-/tmp}/servicedesk-labcopy}"; command -v cygpath >/dev/null 2>&1 && WORK="$(cygpath -m "$WORK")"
P=sdlabcopy; GW=58080; FE=53000; TLS=58443
PHOTO="${PHOTO:-C:/Windows/Web/Wallpaper/Windows/img0.jpg}"

if [ "${1:-}" = --cleanup ]; then
  docker rm -f "${P}-nginx" >/dev/null 2>&1 || true
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$P")"; [ -n "$ids" ] && docker rm -f $ids >/dev/null
  for v in $(docker volume ls -q --filter "label=com.docker.compose.project=$P"); do docker volume rm "$v" >/dev/null; done
  for n in $(docker network ls -q --filter "label=com.docker.compose.project=$P"); do docker network rm "$n" >/dev/null; done
  [ -d "$WORK" ] && find "$WORK" -mindepth 1 -delete 2>/dev/null; rmdir "$WORK" 2>/dev/null || true
  echo "proyecto $P eliminado"; exit 0
fi
RESULTS=(); res() { RESULTS+=("$1|$2"); printf '  → %-80s %s\n' "$1" "$2"; }
step() { printf '\n\033[1m######## %s ########\033[0m\n' "$*"; }
docker volume ls -q --filter "label=com.docker.compose.project=$P" | grep -q . && { echo "Ya existe $P: ejecuta --cleanup"; exit 1; }
mkdir -p "$WORK"

step "1. Backup del laboratorio (solo lectura)"
lab() { MSSQL_CONTAINER=sd-mssql-lab TICKET_CONTAINER=sd-ticket-mssql SD_ENV_FILE="$ROOT/.env.mssql" SD_DIR="$ROOT" "$@"; }
# Conteos del laboratorio en un subproceso con SU configuración (sesiones y accesos
# se excluyen: cambian si alguien usa el laboratorio durante la prueba).
lab_counts() { ( export MSSQL_CONTAINER=sd-mssql-lab TICKET_CONTAINER=sd-ticket-mssql SD_ENV_FILE="$ROOT/.env.mssql" SD_DIR="$ROOT"
  . "$ROOT/scripts/lib/common.sh"; . "$ROOT/scripts/lib/backup.sh"
  sd_query "$(sd_counts_sql auth_db catalog_db ticket_db)" | tr -d '\r' | grep -vE '^(sessions|auth_logs)=' | tr '\n' ' ' ); }
SRC0="$(lab_counts)"
[ -n "$SRC0" ] || { echo "No se pudieron leer los conteos del laboratorio: la prueba no puede garantizar que quede intacto"; exit 1; }
echo "Laboratorio antes: $SRC0"
# FROM_SET: conjunto ya existente (p. ej. el backup ANTERIOR a la migración, sin el
# esquema nuevo). Sin él, se hace un backup del laboratorio en este momento.
if [ -n "${FROM_SET:-}" ]; then
  SET="$FROM_SET"
  ( cd "$SET" && sha256sum -c --quiet SHA256SUMS ) && res "Conjunto de origen indicado, SHA-256 correcto ($(basename "$SET"))" OK || { res "Conjunto de origen" FALLO; exit 1; }
else
  lab env SD_BACKUP_ENV="$WORK/no-externo.env" BACKUP_REQUIRE_OFFSITE=false BACKUP_DIR="$WORK/backups" bash "$ROOT/scripts/backup-mssql.sh" > "$WORK/backup.log" 2>&1 \
    && res "Backup del laboratorio (3 bases + imágenes)" OK || { res "Backup del laboratorio" FALLO; tail -5 "$WORK/backup.log"; exit 1; }
  SET="$(find "$WORK/backups/sets" -mindepth 1 -maxdepth 1 -type d -name 'sd-20*' | sort | tail -n1)"
fi
# Valor de referencia: los conteos registrados en el propio conjunto.
SRC_SET="$(grep -E '^[a-z_]+=[0-9]+ [0-9]+$' "$SET/counts.txt" | awk -F'[= ]' '{print $1"="$3}' | tr '\n' ' ')"

step "2. Instalación aislada en modo restauración con el código nuevo"
if [ -n "${FROM_PACKAGE:-}" ]; then
  PKG="$FROM_PACKAGE"; ( cd "$(dirname "$PKG")" && sha256sum -c "$(basename "$PKG").sha256" ) >/dev/null && res "Paquete indicado, SHA-256 correcto ($(basename "$PKG"))" OK || { res "Paquete indicado" FALLO; exit 1; }
else
  V="labcopy-$(date -u +%Y%m%d%H%M%S)"
  "$ROOT/scripts/build-server-package.sh" "$V" >/dev/null && PKG="$ROOT/release/servicedesk-uta-server-$V.tar.gz"
fi
mkdir -p "$WORK/srv" && tar --force-local -xzf "$PKG" -C "$WORK/srv" --strip-components=1
f="$WORK/srv/deploy/server/.env"; cp "$WORK/srv/.env.example" "$f"
sed -i -e "s#^PUBLIC_DOMAIN=.*#PUBLIC_DOMAIN=localhost:$TLS#" -e "s#^MSSQL_PID=.*#MSSQL_PID=Developer#" -e "s#^SERVER_PURPOSE=.*#SERVER_PURPOSE=pruebas#" \
       -e "s#^GATEWAY_BIND_PORT=.*#GATEWAY_BIND_PORT=$GW#" -e "s#^FRONTEND_BIND_PORT=.*#FRONTEND_BIND_PORT=$FE#" -e "s#^INITIAL_ADMIN_EMAIL=.*#INITIAL_ADMIN_EMAIL=#" "$f"
printf 'PUBLIC_SCHEME=https\n' >> "$f"
"$WORK/srv/scripts/install-server.sh" --mode restore --from "$SET" --generate-secrets --test-mode --yes --project $P > "$WORK/install.log" 2>&1 \
  && res "Restauración + esquema Fase T aplicado sobre la copia" OK || { res "Instalación restore" FALLO; tail -8 "$WORK/install.log"; exit 1; }
# nginx real (plantilla del proyecto) delante: interfaz y API en el MISMO origen, como en el servidor.
mkdir -p "$WORK/nginx"; openssl req -x509 -nodes -newkey rsa:2048 -days 2 -subj "/CN=localhost" -keyout "$WORK/nginx/privkey.pem" -out "$WORK/nginx/fullchain.pem" >/dev/null 2>&1
sed -e "s#__SERVER_NAME__#localhost#g" -e "s#__UPSTREAM_GATEWAY__#api-gateway:8080#g" -e "s#__UPSTREAM_FRONTEND__#frontend:80#g" -e "s#__CERT_DIR__#/etc/nginx/certs#g" \
  "$WORK/srv/deploy/nginx/servicedesk.conf.template" > "$WORK/nginx/sd.conf"
docker run -d --name "${P}-nginx" --network "${P}_edge" -p "127.0.0.1:$TLS:443" -v "$WORK/nginx/sd.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$WORK/nginx:/etc/nginx/certs:ro" nginx:1.28.3-alpine >/dev/null; sleep 3
[ "$(curl -sk -o /dev/null -w '%{http_code}' "https://localhost:$TLS/healthz")" = 200 ] && res "nginx (plantilla real) sirve interfaz y API en el mismo origen" OK || res "nginx" FALLO
export SD_DIR="$WORK/srv" SD_PROJECT=$P
unset SD_ENV_FILE MSSQL_CONTAINER TICKET_CONTAINER
. "$WORK/srv/scripts/lib/common.sh"; . "$WORK/srv/scripts/lib/backup.sh"
q() { sd_query "$1" | tr -d '\r' | head -n1; }

step "3. Migración verificada"
DST="$(sd_query "$(sd_counts_sql auth_db catalog_db ticket_db)" | tr -d '\r' | grep -vE '^(sessions|auth_logs)=' | tr '\n' ' ')"
SRCF="$(printf '%s' "$SRC_SET" | tr ' ' '\n' | grep -vE '^(sessions|auth_logs)=' | grep . | tr '\n' ' ')"
[ "$DST" = "$SRCF" ] && res "Ningún dato perdido: conteos de 11 tablas = laboratorio" OK || res "Conteos" "FALLO (origen: $SRCF | copia: $DST)"
[ "$(q "SELECT COUNT(*) FROM auth_db.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='users' AND COLUMN_NAME='fisei_block';")" = 1 ] \
  && [ "$(q "SELECT COUNT(*) FROM auth_db.dbo.users WHERE fisei_block IS NOT NULL;")" = 0 ] \
  && res "Columna de bloque creada y NINGÚN técnico clasificado automáticamente" OK || res "Columna de bloque" FALLO
[ "$(q "SELECT COUNT(*) FROM ticket_db.sys.tables WHERE name IN ('solution_acceptances','acceptance_terms');")" = 2 ] \
  && [ "$(q "SELECT COUNT(*) FROM ticket_db.dbo.acceptance_terms WHERE version = '1.0';")" = 1 ] \
  && [ "$(q "SELECT COUNT(*) FROM ticket_db.sys.triggers WHERE name LIKE 'trg_%immutable';")" = 2 ] \
  && res "Tablas de aceptación, términos v1.0 y triggers de inmutabilidad creados" OK || res "Esquema de aceptación" FALLO
[ "$(q "SELECT COUNT(*) FROM ticket_db.dbo.solution_acceptances;")" = 0 ] && res "Sin constancias inventadas para los tickets históricos (0)" OK || res "Constancias históricas" FALLO

step "4. Cuentas de prueba sobre la copia (contraseñas temporales en archivos 0600)"
mkdir -p "$WORK/sec"; chmod 700 "$WORK/sec"
login_as() { # login_as <email> <archivo-token>  (reset → cambio obligatorio → login)
  local email="$1" out="$2" tmp new
  SECRET_FILE="$WORK/sec/reset" bash "$WORK/srv/scripts/operations/manage-user.sh" reset-password "$email" >/dev/null 2>&1 || return 1
  tmp="$(head -n1 "$WORK/sec/reset" | tr -d '\r\n')"; new="Lc-$(openssl rand -hex 8)_Q7x!"
  local t1; t1="$(curl -s -H 'Content-Type: application/json' -d "{\"correo\":\"$email\",\"password\":\"$tmp\"}" "http://127.0.0.1:$GW/api/auth/login" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  curl -s -o /dev/null -H "Authorization: Bearer $t1" -H 'Content-Type: application/json' -d "{\"currentPassword\":\"$tmp\",\"newPassword\":\"$new\"}" "http://127.0.0.1:$GW/api/auth/change-password"
  curl -s -H 'Content-Type: application/json' -d "{\"correo\":\"$email\",\"password\":\"$new\"}" "http://127.0.0.1:$GW/api/auth/login" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p' > "$out"
  rm -f "$WORK/sec/reset"; [ -s "$out" ]
}
ADM="$(q "SELECT TOP 1 email FROM auth_db.dbo.users WHERE role='admin' ORDER BY created_at;")"
USR="$(q "SELECT TOP 1 email FROM auth_db.dbo.users WHERE role='user' ORDER BY created_at;")"
TEC="$(q "SELECT TOP 1 email FROM auth_db.dbo.users WHERE role='technician' ORDER BY created_at;")"
login_as "$ADM" "$WORK/sec/admin.tok" && login_as "$USR" "$WORK/sec/user.tok" && login_as "$TEC" "$WORK/sec/tech.tok" \
  && res "Admin, usuario y técnico reales de la copia inician sesión" OK || res "Inicio de sesión de cuentas copiadas" FALLO
A="$(cat "$WORK/sec/admin.tok")"; U="$(cat "$WORK/sec/user.tok")"; T="$(cat "$WORK/sec/tech.tok")"
api() { curl -s -H "Authorization: Bearer $1" "${@:2}"; }

step "5. Adjuntos históricos y tickets antiguos"
okh=0; tot=0
for tid in $(sd_query "SELECT DISTINCT LOWER(CAST(ticket_id AS varchar(36))) FROM ticket_db.dbo.attachments;" | tr -d '\r'); do
  for u in $(api "$A" "http://127.0.0.1:$GW/api/tickets/history/$tid" | grep -o '"imageUrl":"[^"]*"' | cut -d'"' -f4); do
    tot=$((tot+1)); api "$A" -o "$WORK/h.bin" "http://127.0.0.1:$GW$u"; head -c 8 "$WORK/h.bin" | od -An -tx1 | tr -d ' \n' | grep -q '^89504e47\|^ffd8ff' && okh=$((okh+1))
  done
done
[ "$tot" -gt 0 ] && [ "$okh" = "$tot" ] && res "Adjuntos históricos servidos con contenido de imagen válido ($okh/$tot)" OK || res "Adjuntos históricos" "FALLO ($okh/$tot)"
old="$(q "SELECT TOP 1 LOWER(CAST(id AS varchar(36))) FROM ticket_db.dbo.tickets WHERE status IN ('cerrado','resuelto');")"
if [ -n "$old" ]; then
  st="$(api "$A" "http://127.0.0.1:$GW/api/tickets/$old/acceptances" | sed -n 's/.*"status":"\([A-Z_]*\)".*/\1/p')"
  [ "$st" = CERRADO_SIN_CONSTANCIA ] && res "Ticket histórico cerrado → CERRADO SIN CONSTANCIA (no se inventa)" OK || res "Ticket histórico" "FALLO ($st)"
fi

step "6. Flujo real con datos copiados + foto real"
TECH_ID="$(api "$A" "http://127.0.0.1:$GW/api/auth/technicians" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).technicians.find(x=>x.email===process.argv[1]);console.log(t?.id??"")})' "$TEC")"
api "$A" -X PATCH -H 'Content-Type: application/json' -d '{"block":"BLOQUE_1"}' "http://127.0.0.1:$GW/api/auth/technicians/$TECH_ID/block" | grep -q '"block":"BLOQUE_1"' \
  && res "Admin asigna Bloque 1 a un técnico real de la copia" OK || res "Asignar bloque" FALLO
SVC="$(api "$U" "http://127.0.0.1:$GW/api/catalog/services" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).services??[];console.log((a.find(x=>x.responsibleArea==="TECHNICIANS")??a[0]).id)})')"
NEW="$(api "$U" -F "serviceId=$SVC" -F "location=Laboratorio 1" -F "detail=Prueba Fase T: la pantalla del laboratorio no muestra imagen (foto real adjunta)" -F "attachments=@$PHOTO;type=image/jpeg" "http://127.0.0.1:$GW/api/tickets")"
TID="$(printf '%s' "$NEW" | sed -n 's/.*"ticket":{"id":"\([^"]*\)".*/\1/p')"; NUM="$(printf '%s' "$NEW" | sed -n 's/.*"number":"\([^"]*\)".*/\1/p')"
[ -n "$TID" ] && res "Usuario crea ticket con una foto real (${PHOTO##*/})" OK || res "Crear ticket con foto" "FALLO ($NEW)"
KB="$(api "$T" "http://127.0.0.1:$GW/api/knowledge/search?q=" | grep -o '"id":"[0-9a-f-]\{36\}"' | head -n1 | cut -d'"' -f4)"
c1="$(api "$T" -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$GW/api/tickets/$TID/accept")"
# El cuerpo va en un archivo UTF-8: curl en Windows recibe sus argumentos en ANSI y rompería los acentos.
printf '{"mode":"existingKnowledge","knowledgeArticleId":"%s","finalNote":"Se reconectó el cable HDMI y se verificó la imagen."}' "$KB" > "$WORK/resolve.json"
c2="$(api "$T" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json; charset=utf-8' --data-binary "@$WORK/resolve.json" "http://127.0.0.1:$GW/api/tickets/$TID/resolve")"
[ "$c1" = 200 ] && [ "$c2" = 200 ] && res "Técnico del Bloque 1 acepta y registra la solución" OK || res "Técnico resuelve" "FALLO ($c1/$c2)"
img="$(api "$T" "http://127.0.0.1:$GW/api/tickets/history/$TID" | grep -o '/api/tickets/[0-9a-f-]*/attachments/[0-9a-f-]*' | head -n1)"
api "$T" -o "$WORK/photo.bin" "http://127.0.0.1:$GW$img"
[ "$(sha256sum < "$WORK/photo.bin" | cut -c1-64)" = "$(sha256sum < "$PHOTO" | cut -c1-64)" ] && res "El técnico descarga la foto idéntica (SHA-256) por el endpoint autenticado" OK || res "Foto íntegra" FALLO
ALLOW_SELF_SIGNED=1 FRONTEND="https://localhost:$TLS" node "$ROOT/scripts/testing/browser-ui-check.mjs" images "$WORK/sec/tech.tok" "/mis-aceptados?openTicket=$TID" 1 | tee "$WORK/ui-tech.json" | head -c 400; echo
grep -q '"ok":true' "$WORK/ui-tech.json" && res "Chrome real: el técnico VE la imagen (decodificada) y el lightbox la amplía" OK || res "Render imágenes (técnico)" FALLO
ALLOW_SELF_SIGNED=1 FRONTEND="https://localhost:$TLS" node "$ROOT/scripts/testing/browser-ui-check.mjs" images "$WORK/sec/admin.tok" "/mis-aceptados?openTicket=$TID" 1 > "$WORK/ui-admin.json"
grep -q '"ok":true' "$WORK/ui-admin.json" && res "Chrome real: el administrador VE la imagen" OK || res "Render imágenes (admin)" "FALLO $(head -c 200 "$WORK/ui-admin.json")"
ALLOW_SELF_SIGNED=1 FRONTEND="https://localhost:$TLS" node "$ROOT/scripts/testing/browser-ui-check.mjs" accept "$WORK/sec/user.tok" "$NUM" | tee "$WORK/ui-accept.json" | head -c 500; echo
CODE="$(sed -n 's/.*"flash":"\(VD-[^"]*\)".*/\1/p' "$WORK/ui-accept.json")"
grep -q '"ok":true' "$WORK/ui-accept.json" && res "Chrome real: el usuario revisa (términos + imágenes), marca la casilla y acepta → $CODE" OK || res "Aceptación por la interfaz" FALLO
row="$(q "SELECT CONCAT(decision,'|',user_email,'|',terms_version,'|',technician_name) FROM ticket_db.dbo.solution_acceptances WHERE code = N'$CODE';")"
[[ "$row" == "ACCEPTED|$USR|1.0|"* ]] && res "Constancia en SQL Server con el código mostrado al usuario" OK || res "Constancia en BD" "FALLO ($row)"
REP="$(api "$A" "http://127.0.0.1:$GW/api/admin/reports/block?block=BLOQUE_1")"
printf '%s' "$REP" | grep -q "\"code\":\"$CODE\"" && res "Reporte Bloque 1 (datos copiados) muestra la aceptación digital real" OK || res "Reporte por bloque" FALLO
[ "$(api "$T" -o /dev/null -w '%{http_code}' "http://127.0.0.1:$GW/api/admin/reports/block?block=BLOQUE_1")" = 403 ] && res "El técnico no puede consultar el reporte administrativo (403)" OK || res "Reporte: técnico" FALLO
ALLOW_SELF_SIGNED=1 FRONTEND="https://localhost:$TLS" node "$ROOT/scripts/testing/browser-ui-check.mjs" blockprint "$WORK/sec/admin.tok" "$CODE" "$WORK/reporte-bloque1" | tee "$WORK/ui-print.json" | head -c 400; echo
grep -q '"ok":true' "$WORK/ui-print.json" && res "Chrome real: reporte Bloque 1 impreso a PDF con encabezado, totales, actividades y validación digital" OK || res "Impresión del reporte por bloque" FALLO
TECH_NAME="$(q "SELECT name FROM auth_db.dbo.users WHERE email = N'$TEC';")" ALLOW_SELF_SIGNED=1 FRONTEND="https://localhost:$TLS" node "$ROOT/scripts/testing/browser-ui-check.mjs" techprint "$WORK/sec/admin.tok" "$CODE" "$WORK/reporte-tecnico" | tee "$WORK/ui-techprint.json" | head -c 400; echo
grep -q '"ok":true' "$WORK/ui-techprint.json" && res "Chrome real: reporte individual del técnico impreso a PDF con solución, laboratorio y validación digital" OK || res "Impresión del reporte de técnico" FALLO
ALLOW_SELF_SIGNED=1 FRONTEND="https://localhost:$TLS" node "$ROOT/scripts/testing/browser-ui-check.mjs" historyprint "$WORK/sec/admin.tok" "$TID" "$NUM" | tee "$WORK/ui-history.json" | head -c 300; echo
grep -q '"ok":true' "$WORK/ui-history.json" && res "Chrome real: historial del ticket impreso sin abrir ventanas" OK || res "Impresión del historial" FALLO

step "6b. Ciclo de rechazo: el usuario rechaza, el técnico vuelve a colocar la solución, el usuario acepta"
NEW2="$(api "$U" -F "serviceId=$SVC" -F "location=Laboratorio 2" -F "detail=Prueba Fase T: ciclo de rechazo con foto real" -F "attachments=@$PHOTO;type=image/jpeg" "http://127.0.0.1:$GW/api/tickets")"
TID2="$(printf '%s' "$NEW2" | sed -n 's/.*"ticket":{"id":"\([^"]*\)".*/\1/p')"; NUM2="$(printf '%s' "$NEW2" | sed -n 's/.*"number":"\([^"]*\)".*/\1/p')"
st2() { q "SELECT status FROM ticket_db.dbo.tickets WHERE id = '$TID2';"; }
c1="$(api "$T" -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$GW/api/tickets/$TID2/accept")"
c2="$(api "$T" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json; charset=utf-8' --data-binary "@$WORK/resolve.json" "http://127.0.0.1:$GW/api/tickets/$TID2/resolve")"
[ "$c1" = 200 ] && [ "$c2" = 200 ] && [ "$(st2)" = pendiente_validacion ] && res "Técnico registra la primera solución → pendiente de validación" OK || res "Primera solución" "FALLO ($c1/$c2/$(st2))"
ALLOW_SELF_SIGNED=1 FRONTEND="https://localhost:$TLS" node "$ROOT/scripts/testing/browser-ui-check.mjs" reject "$WORK/sec/user.tok" "$NUM2" "La falla volvió a presentarse en la siguiente clase" | tee "$WORK/ui-reject.json" | head -c 300; echo
RCODE="$(sed -n 's/.*"flash":"\(VD-[^"]*\)".*/\1/p' "$WORK/ui-reject.json")"
grep -q '"ok":true' "$WORK/ui-reject.json" && [ "$(st2)" = en_proceso ] && res "Chrome real: el usuario rechaza con motivo obligatorio → vuelve a En proceso ($RCODE)" OK || res "Rechazo por la interfaz" "FALLO ($(st2))"
c3="$(api "$A" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"termsAccepted":true,"termsVersion":"1.0"}' "http://127.0.0.1:$GW/api/tickets/$TID2/user-accept")"
c4="$(api "$T" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"termsAccepted":true,"termsVersion":"1.0"}' "http://127.0.0.1:$GW/api/tickets/$TID2/user-accept")"
[ "$c3" = 403 ] && [ "$c4" = 403 ] && res "Ni el administrador ni el técnico pueden aceptar por el usuario (403)" OK || res "Aceptar en nombre del usuario" "FALLO ($c3/$c4)"
c5="$(api "$T" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json; charset=utf-8' --data-binary "@$WORK/resolve.json" "http://127.0.0.1:$GW/api/tickets/$TID2/resolve")"
[ "$c5" = 200 ] && [ "$(st2)" = pendiente_validacion ] && res "El técnico vuelve a colocar la solución → otra vez pendiente del usuario" OK || res "Segunda solución" "FALLO ($c5/$(st2))"
ALLOW_SELF_SIGNED=1 FRONTEND="https://localhost:$TLS" node "$ROOT/scripts/testing/browser-ui-check.mjs" accept "$WORK/sec/user.tok" "$NUM2" | tee "$WORK/ui-accept2.json" | head -c 300; echo
ACODE="$(sed -n 's/.*"flash":"\(VD-[^"]*\)".*/\1/p' "$WORK/ui-accept2.json")"
grep -q '"ok":true' "$WORK/ui-accept2.json" && [ "$(st2)" = cerrado ] && res "Chrome real: el usuario acepta la nueva solución → Cerrado ($ACODE)" OK || res "Aceptación tras rechazo" "FALLO ($(st2))"
rows="$(sd_query "SELECT CONCAT(decision,'|',code) FROM ticket_db.dbo.solution_acceptances WHERE ticket_id = '$TID2' ORDER BY decided_at;" | tr -d '\r' | tr '\n' ' ')"
[ "$rows" = "REJECTED|$RCODE ACCEPTED|$ACODE " ] && res "SQL Server conserva las dos decisiones, sin sobrescribir" OK || res "Decisiones en BD" "FALLO ($rows)"
api "$A" "http://127.0.0.1:$GW/api/admin/reports/block?block=BLOQUE_1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).technicians.flatMap(t=>t.activities).find(x=>x.number===process.argv[1]);const v=a?.validation;const ok=v?.status==="ACEPTADO_DIGITALMENTE"&&v.record?.code===process.argv[2]&&v.history.length===2&&v.history.some(h=>h.code===process.argv[3]&&h.reason);process.exit(ok?0:1)})' "$NUM2" "$ACODE" "$RCODE" \
  && res "El reporte muestra la aceptación final y el rechazo anterior con su motivo" OK || res "Reporte tras el ciclo" FALLO

step "7. Laboratorio intacto"
SRC1="$(lab_counts)"
[ -n "$SRC1" ] && [ "$SRC0" = "$SRC1" ] && res "El laboratorio no cambió (conteos de 11 tablas idénticos)" OK || res "Laboratorio" "FALLO (antes: $SRC0 | después: $SRC1)"

step "RESUMEN"
okc=0; fc=0; for r in "${RESULTS[@]}"; do [ "${r#*|}" = OK ] && okc=$((okc+1)) || fc=$((fc+1)); printf '  %-84s %s\n' "${r%%|*}" "${r#*|}"; done
echo "LAB-COPY: $okc OK · $fc fallos"; [ -n "${FROM_PACKAGE:-}" ] || rm -f "$PKG" "${PKG%.tar.gz}".*; [ "$fc" -eq 0 ]
