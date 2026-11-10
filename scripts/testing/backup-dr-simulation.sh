#!/usr/bin/env bash
# =============================================================================
# scripts/testing/backup-dr-simulation.sh — Fase S: backups cifrados y
# recuperación ante desastre, de punta a punta, SOLO en local.
#
#   scripts/testing/backup-dr-simulation.sh            # ejecuta todo (~20 min)
#   scripts/testing/backup-dr-simulation.sh --cleanup  # borra SOLO lo creado por la prueba
#
# Origen: el SQL Server y el ticket-service del LABORATORIO (solo lectura:
# BACKUP DATABASE no modifica datos; se comprueba al final). Destino S3: MinIO
# aislado (deploy/backup-lab, red interna sin Internet). Nada sale del equipo.
#
#   1  laboratorio S3 (TLS, bucket privado, usuario limitado)
#   2  conexión e inicialización del repositorio Restic
#   3  diagnóstico de errores (clave, credenciales, endpoint, TLS, permisos…)
#   4  backup completo (3 bases + imágenes + configuración) → snapshot verificado
#   5  segundo backup: deduplicación
#   6  cifrado: el almacenamiento crudo no contiene texto plano (con control positivo)
#   7  retención 14/8/12 sobre 400 snapshots diarios sintéticos + salvaguardas
#   8  manipulación del repositorio: detectada
#   9  custodia: clave del custodio, rotación de la clave del servidor
#   10 restore drill (PASS) y drill con datos alterados (FAIL esperado)
#   11 DESASTRE: el servidor original "desaparece"; servidor nuevo desde el
#      paquete + credenciales S3 + clave del CUSTODIO → bases, imágenes,
#      configuración; login, tickets, historial, imágenes; drill en instancia
#   12 persistencia (reinicios) y backup desde el servidor recuperado
#   13 sin secretos en logs ni manifest; laboratorio de origen intacto
# =============================================================================
set -uo pipefail
export MSYS_NO_PATHCONV=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
command -v cygpath >/dev/null 2>&1 && ROOT="$(cygpath -m "$ROOT")"
WORK="${SIM_WORK:-${TMPDIR:-/tmp}/servicedesk-backup-sim}"
command -v cygpath >/dev/null 2>&1 && WORK="$(cygpath -m "$WORK")"
SRC_MSSQL="${SRC_MSSQL:-sd-mssql-lab}"; SRC_TICKET="${SRC_TICKET:-sd-ticket-mssql}"; SRC_ENV="${SRC_ENV:-$ROOT/.env.mssql}"
P_DR=sddrsim; GW=48080; FE=43000
export LAB_DIR="$WORK/lab"
LAB="$ROOT/deploy/backup-lab/lab.sh"

if [ "${1:-}" = "--cleanup" ]; then
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$P_DR")"; [ -n "$ids" ] && docker rm -f $ids >/dev/null
  for v in $(docker volume ls -q --filter "label=com.docker.compose.project=$P_DR"); do docker volume rm "$v" >/dev/null; done
  for n in $(docker network ls -q --filter "label=com.docker.compose.project=$P_DR"); do docker network rm "$n" >/dev/null; done
  ids="$(docker ps -aq --filter label=servicedesk.restore-drill=1)"; [ -n "$ids" ] && docker rm -f -v $ids >/dev/null
  bash "$LAB" destroy 2>/dev/null || true
  for v in sddrsim-restic-cache servicedesk-restic-cache-sim; do docker volume rm "$v" >/dev/null 2>&1 || true; done
  [ -d "$WORK" ] && find "$WORK" -mindepth 1 -delete 2>/dev/null; rmdir "$WORK" 2>/dev/null || true
  echo "prueba de Fase S eliminada (proyecto $P_DR, laboratorio S3, $WORK)"; exit 0
fi

step() { printf '\n\033[1m######## %s ########\033[0m\n' "$*"; }
RESULTS=(); res() { RESULTS+=("$1|$2"); printf '  → %-66s %s\n' "$1" "$2"; }
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
docker ps --format '{{.Names}}' | grep -qx "$SRC_MSSQL" || { echo "No está en marcha el SQL Server de origen ($SRC_MSSQL)"; exit 1; }
docker ps --format '{{.Names}}' | grep -qx "$SRC_TICKET" || { echo "No está en marcha el ticket-service de origen ($SRC_TICKET)"; exit 1; }
if docker volume ls -q --filter "label=com.docker.compose.project=$P_DR" | grep -q . || docker volume ls -q | grep -q '^sdbackuplab_'; then
  echo "Ya existen recursos de una prueba anterior. Ejecuta primero: $0 --cleanup"; exit 1
fi
mkdir -p "$WORK"; chmod 700 "$WORK"
exec > >(tee "$WORK/sim.log") 2>&1

src() { unset SD_COMPOSE_FILE SD_PROJECT; export SD_DIR="$ROOT" MSSQL_CONTAINER="$SRC_MSSQL" TICKET_CONTAINER="$SRC_TICKET" SD_ENV_FILE="$SRC_ENV"; . "$ROOT/scripts/lib/common.sh"; . "$ROOT/scripts/lib/backup.sh"; }
src
SRC_COUNTS0="$(sd_query "$(sd_counts_sql auth_db catalog_db ticket_db)" | tr -d '\r' | tr '\n' ' ')"
SRC_DBS0="$(sd_query "SELECT name FROM sys.databases ORDER BY name;" | tr -d '\r' | tr '\n' ' ')"
echo "Origen (laboratorio): $SRC_COUNTS0"

# ------------------------------------------------------------------------- 1
step "1. Laboratorio S3 (MinIO)"
bash "$LAB" up | strip | tail -n 2 && res "MinIO: TLS, bucket privado, usuario limitado, red interna" OK || { res "MinIO" FALLO; exit 1; }
export SD_BACKUP_ENV="$LAB_DIR/backup.env" RESTIC_PREFLIGHT_TIMEOUT=45
[ "$(docker network inspect sdbackuplab_s3 -f '{{.Internal}}')" = true ] && res "Red del S3 interna (sin salida a Internet)" OK || res "Red interna" FALLO
o="$(docker run --rm --network sdbackuplab_s3 --entrypoint sh restic/restic:0.18.0 -c 'wget -q -T 5 -O /dev/null https://www.backblaze.com 2>/dev/null && echo SALE || echo NO_SALE')"
[ "$o" = NO_SALE ] && res "Ninguna conexión externa posible desde la red de backup" OK || res "Conexión externa" "FALLO ($o)"

# ------------------------------------------------------------------------- 2
step "2. Conexión e inicialización"
TC="$ROOT/scripts/backup/restic-test-connection.sh"
bash "$TC" >/dev/null 2>&1; [ $? = 10 ] && res "test-connection: accesible pero sin inicializar (10)" OK || res "test-connection inicial" FALLO
bash "$ROOT/scripts/backup/restic-init.sh" | strip | tail -n1 && res "restic-init: repositorio v2 cifrado creado" OK || res "restic-init" FALLO
bash "$ROOT/scripts/backup/restic-init.sh" | strip | grep -q "no se reinicializa" && res "restic-init idempotente (no reinicializa)" OK || res "restic-init idempotente" FALLO
bash "$TC" >/dev/null 2>&1 && res "test-connection: credenciales + clave correctas (0)" OK || res "test-connection" FALLO

# ------------------------------------------------------------------------- 3
step "3. Diagnóstico de errores"
( umask 077; set +o pipefail; LC_ALL=C tr -dc A-Za-z0-9 </dev/urandom 2>/dev/null | head -c 40 > "$WORK/wrong.pass" )
sed 's/^RESTIC_CACERT=.*//' "$SD_BACKUP_ENV" > "$WORK/noca.env"; grep -v '^AWS_SECRET' "$SD_BACKUP_ENV" > "$WORK/inc.env"
neg() { local name="$1" expect="$2"; shift 2; local out; out="$(env "$@" bash "$TC" 2>&1 | strip | tail -n1)"
  case "$out" in *"$expect"*) res "$name → $expect" OK;; *) res "$name" "FALLO ($out)";; esac; }
neg "Clave Restic incorrecta" E_REPO_PASSWORD RESTIC_PASSWORD_FILE="$WORK/wrong.pass"
neg "Secreto S3 incorrecto" E_REPO_CREDENTIALS AWS_SECRET_ACCESS_KEY=incorrecto1234567890123456789012345678
neg "Usuario S3 inexistente" E_REPO_CREDENTIALS AWS_ACCESS_KEY_ID=nadie
neg "Bucket ajeno (mínimo privilegio)" E_REPO_CREDENTIALS RESTIC_REPOSITORY=s3:https://minio:9000/otro-proyecto/servicedesk
neg "Endpoint inexistente" E_REPO_UNREACHABLE RESTIC_REPOSITORY=s3:https://no-existe.invalid:9000/b/servicedesk
neg "Certificado no confiable" E_REPO_TLS SD_BACKUP_ENV="$WORK/noca.env"
neg "Repositorio http:// sin TLS" "sin TLS" RESTIC_REPOSITORY=s3:http://minio:9000/servicedesk-backups-lab/servicedesk
neg "Configuración incompleta" "incompleta" SD_BACKUP_ENV="$WORK/inc.env"
rm -f "$WORK/wrong.pass" "$WORK/noca.env" "$WORK/inc.env"
[ "$(docker ps -q --filter label=servicedesk.restic=1 | wc -l | tr -d ' ')" = 0 ] && res "Sin contenedores restic huérfanos tras los límites de tiempo" OK || res "Contenedores huérfanos" FALLO

# ------------------------------------------------------------------------- 4
step "4. Backup completo → Restic"
export BACKUP_DIR="$WORK/backups"
bash "$ROOT/scripts/backup-mssql.sh" 2>&1 | strip | tee "$WORK/backup1.log" | tail -n 12; rc=${PIPESTATUS[0]}
[ "$rc" = 0 ] && res "backup-mssql.sh → snapshot cifrado verificado (exit 0)" OK || res "backup-mssql.sh" "FALLO rc=$rc"
SET="$(find "$BACKUP_DIR/sets" -mindepth 1 -maxdepth 1 -type d -name 'sd-20*' | sort | tail -n1)"
grep -q 'VERIFYONLY correcto' "$WORK/backup1.log" && [ "$(grep -c 'VERIFYONLY correcto' "$WORK/backup1.log")" = 3 ] && res "3 bases: BACKUP WITH CHECKSUM + RESTORE VERIFYONLY" OK || res "VERIFYONLY x3" FALLO
( cd "$SET" && sha256sum -c --quiet SHA256SUMS ) && res "SHA-256 del conjunto local" OK || res "SHA-256 local" FALLO
node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1]));const ok=m.backupId&&m.databases.length===3&&m.databases.every(d=>d.verifyOnly==="PASSED"&&/^[0-9a-f]{64}$/.test(d.sha256)&&d.sizeBytes>0)&&m.status==="LOCAL_VERIFIED"&&m.uploads.files>0&&m.config.included;process.exit(ok?0:1)' "$SET/manifest.json" \
  && res "manifest.json válido (ID, 3 bases, SHA-256, VERIFYONLY, imágenes, config)" OK || res "manifest.json" FALLO
grep -qiE 'password|secret|eyJ[A-Za-z0-9_-]{10}|sqlserver://|PRIVATE KEY|@uta\.edu' "$SET/manifest.json" "$SET/counts.txt" && res "manifest sin secretos" FALLO || res "manifest/counts sin contraseñas, JWT, cadenas de conexión ni correos" OK
[ ! -e "$SET/config" ] && res "Configuración con secretos NO queda en el disco local" OK || res "config local" FALLO
grep -q '^status=OK' "$BACKUP_DIR/last-status" && res "last-status = OK" OK || res "last-status" FALLO
bash "$ROOT/scripts/operations/check-backup.sh" >/dev/null 2>&1 && res "check-backup.sh (local + repositorio externo)" OK || res "check-backup.sh" FALLO
for m in --quick "" --full; do bash "$ROOT/scripts/backup/restic-check.sh" $m >/dev/null 2>&1 && res "restic-check ${m:-(subconjunto 5 %)}" OK || res "restic-check $m" FALLO; done
SNAP1="$(sed -n 's/^snapshot=//p' "$SET/offsite-status")"

# ------------------------------------------------------------------------- 5
step "5. Segundo backup (deduplicación)"
sleep 2
bash "$ROOT/scripts/backup-mssql.sh" > "$WORK/backup2.log" 2>&1; rc=$?
SET2="$(find "$BACKUP_DIR/sets" -mindepth 1 -maxdepth 1 -type d -name 'sd-20*' | sort | tail -n1)"
a1="$(sed -n 's/^data_added_packed=//p' "$SET/offsite-status")"; a2="$(sed -n 's/^data_added_packed=//p' "$SET2/offsite-status")"
[ "$rc" = 0 ] && [ "$SET2" != "$SET" ] && res "Segundo backup con otro ID (exit 0)" OK || res "Segundo backup" "FALLO rc=$rc"
echo "   subido (comprimido y cifrado): 1.º ${a1:-?} bytes · 2.º ${a2:-?} bytes"
[ -n "$a2" ] && [ -n "$a1" ] && [ $(( a2 * 2 )) -lt "$a1" ] && res "Deduplicación: el 2.º backup sube menos de la mitad que el 1.º" OK || res "Deduplicación" "FALLO (${a2:-?} de ${a1:-?} bytes)"

# ------------------------------------------------------------------------- 6
step "6. Cifrado en reposo"
BID="$(basename "$SET")"; leak=0
for mk in "$BID" LOCAL_VERIFIED fk_events_without_ticket SQL_Latin1_General_CP1_CI_AS IHDR; do
  n="$(bash "$LAB" scan "$mk")"; echo "   '$mk' en el almacenamiento crudo: $n"; [ "$n" = 0 ] || leak=$((leak+1)); done
[ "$leak" = 0 ] && res "Ningún texto plano del backup en el bucket (manifest, conteos, PNG)" OK || res "Texto plano en el bucket" FALLO
MK="CONTROL-POSITIVO-$RANDOM$RANDOM"; C="$(docker compose -p sdbackuplab ps -q minio)"
docker exec -i -e MK="$MK" "$C" sh -s <<'SH' >/dev/null
export MC_CONFIG_DIR=/tmp/mcpos; mkdir -p $MC_CONFIG_DIR/certs/CAs; cp /certs/CAs/ca.crt $MC_CONFIG_DIR/certs/CAs/
mc alias set lab https://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; echo "$MK" | mc pipe lab/otro-proyecto/claro.txt
SH
[ "$(bash "$LAB" scan "$MK")" -ge 1 ] && res "Control positivo: un objeto en claro SÍ se detecta" OK || res "Control positivo" FALLO

# ------------------------------------------------------------------------- 7
step "7. Retención 14 diarios · 8 semanales · 12 mensuales"
F="$WORK/fakeset"; mkdir -p "$F/db"; for d in auth_db catalog_db ticket_db; do echo sintetico > "$F/db/$d-x.bak"; done
echo '{"backupId":"sintetico"}' > "$F/manifest.json"; ( cd "$F" && sha256sum db/* manifest.json > SHA256SUMS )
RT="s3:https://minio:9000/servicedesk-backups-lab/retencion-sintetica"
RESTIC_REPOSITORY="$RT" bash "$ROOT/scripts/backup/restic-init.sh" >/dev/null 2>&1
( export RESTIC_REPOSITORY="$RT"; sd_backup_load; SD_RESTIC_MOUNTS=(-v "$(sd_hostpath "$F"):/servicedesk-backup:ro")
  SD_RESTIC_ENTRYPOINT=sh sd_restic -c 'now=$(date -u +%s); i=399; while [ $i -ge 0 ]; do e=$((now - i*86400)); d=$(date -u -d @$e "+%Y-%m-%d %H:%M:%S"); restic backup -q /servicedesk-backup --host servicedesk-lab --tag servicedesk --time "$d" >/dev/null || exit 1; i=$((i-1)); done' )
RESTIC_REPOSITORY="$RT" MAX_AGE_HOURS=-1 bash "$ROOT/scripts/backup/restic-retention.sh" --prune >/dev/null 2>&1 \
  && res "Salvaguarda: sin snapshot reciente NO se aplica" FALLO || res "Salvaguarda: sin snapshot reciente NO se aplica retención" OK
RESTIC_REPOSITORY="$RT" bash "$ROOT/scripts/backup/restic-retention.sh" --prune 2>&1 | strip | tail -n1
( export RESTIC_REPOSITORY="$RT"; sd_backup_load; sd_restic snapshots --json 2>/dev/null ) > "$WORK/ret.json"
node -e '
const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).map(x=>new Date(x.time)).sort((a,b)=>b-a);
const now=new Date(), day=d=>d.toISOString().slice(0,10), mon=d=>d.toISOString().slice(0,7);
const wk=d=>{const t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));t.setUTCDate(t.getUTCDate()-((t.getUTCDay()+6)%7)+3);const f=new Date(Date.UTC(t.getUTCFullYear(),0,4));return t.getUTCFullYear()+"-"+Math.round((t-f)/6048e5);};
const D=new Set(s.map(day)),W=new Set(s.map(wk)),M=new Set(s.map(mon));let a=1,b=1,c=1;
for(let i=0;i<14;i++) if(!D.has(day(new Date(now-i*864e5)))) a=0;
for(let i=0;i<8;i++) if(!W.has(wk(new Date(now-i*6048e5)))) b=0;
for(let i=0;i<12;i++) if(!M.has(mon(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,15))))) c=0;
const old=s.filter(d=>now-d>366*864e5).length;
console.log(`   400 → ${s.length} snapshots · 14 días:${a} · 8 semanas:${b} · 12 meses:${c} · >12 meses:${old}`);
process.exit(a&&b&&c&&old===0&&s.length<=34?0:1);' "$WORK/ret.json" && res "Retención 14/8/12 correcta (días, semanas y meses cubiertos; nada > 12 meses)" OK || res "Retención" FALLO
mkdir -p "$WORK/incompleto"; echo x > "$WORK/incompleto/nota.txt"
( export RESTIC_REPOSITORY="$RT"; sd_backup_load; SD_RESTIC_MOUNTS=(-v "$(sd_hostpath "$WORK/incompleto"):/servicedesk-backup:ro"); sd_restic backup -q /servicedesk-backup --host servicedesk-lab --tag servicedesk >/dev/null )
RESTIC_REPOSITORY="$RT" bash "$ROOT/scripts/backup/restic-retention.sh" --prune >/dev/null 2>&1 \
  && res "Salvaguarda: último snapshot incompleto" FALLO || res "Salvaguarda: último snapshot incompleto → NO se aplica retención" OK

# ------------------------------------------------------------------------- 8
step "8. Manipulación del repositorio"
TT="s3:https://minio:9000/servicedesk-backups-lab/manipulacion"
RESTIC_REPOSITORY="$TT" bash "$ROOT/scripts/backup/restic-init.sh" >/dev/null 2>&1
( export RESTIC_REPOSITORY="$TT"; sd_backup_load; SD_RESTIC_MOUNTS=(-v "$(sd_hostpath "$F"):/servicedesk-backup:ro"); sd_restic backup -q /servicedesk-backup --host servicedesk-lab --tag servicedesk >/dev/null )
docker exec -i "$C" sh -s <<'SH' >/dev/null
export MC_CONFIG_DIR=/tmp/mcpos
for o in $(mc ls --recursive lab/servicedesk-backups-lab/manipulacion/data/ | awk '{print $NF}'); do head -c 300 /dev/urandom | mc pipe "lab/servicedesk-backups-lab/manipulacion/data/$o"; done
SH
( export RESTIC_REPOSITORY="$TT"; sd_backup_load; sd_restic check --read-data >/dev/null 2>&1 ) && res "restic check detecta manipulación" FALLO || res "restic check --read-data detecta paquetes alterados" OK
RESTIC_REPOSITORY="$TT" RESTIC_CACHE_VOLUME=sdbackuplab_cache-manip bash "$ROOT/scripts/backup/restic-restore.sh" --snapshot latest --target "$WORK/manip-restore" >/dev/null 2>&1 \
  && res "Restauración de datos alterados" FALLO || res "Restauración de datos alterados → rechazada (--verify)" OK
docker volume rm sdbackuplab_cache-manip >/dev/null 2>&1

# ------------------------------------------------------------------------- 9
step "9. Custodia de la clave"
( umask 077; set +o pipefail; LC_ALL=C tr -dc A-Za-z0-9 </dev/urandom 2>/dev/null | head -c 48 > "$WORK/custodio.pass" )
cp -p "$LAB_DIR/restic.pass" "$WORK/server-old.pass"
K="$ROOT/scripts/backup/restic-keys.sh"
bash "$K" add --new-password-file "$WORK/custodio.pass" --user custodio-recuperacion >/dev/null 2>&1 && res "Clave independiente del custodio añadida" OK || res "Clave custodio" FALLO
bash "$K" rotate-server-key >/dev/null 2>&1 && res "Rotación de la clave del servidor" OK || res "Rotación" FALLO
bash "$K" verify --password-file "$WORK/server-old.pass" >/dev/null 2>&1 && res "Clave anterior revocada" FALLO || res "Clave anterior del servidor revocada (ya no abre)" OK
bash "$K" verify --password-file "$WORK/custodio.pass" >/dev/null 2>&1 && res "La clave del custodio sigue abriendo el repositorio" OK || res "Clave custodio tras rotación" FALLO
rm -f "$WORK/server-old.pass"

# ------------------------------------------------------------------------- 10
step "10. Restore drill"
bash "$ROOT/scripts/backup/restore-drill.sh" --mode ephemeral 2>&1 | strip | tail -n 9; rc=${PIPESTATUS[0]}
R="$(ls -t "$BACKUP_DIR"/drills/drill-*.json | head -n1)"
[ "$rc" = 0 ] && node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));process.exit(r.result==="PASS"&&r.checkdb==="PASSED"&&Object.values(r.counts).every(c=>c.ok)&&Object.values(r.relations).every(c=>c.ok)&&r.images.restoredFiles>0?0:1)' "$R" \
  && res "Drill (SQL Server efímero aislado): CHECKDB, 13 conteos, 14 relaciones, imágenes" OK || res "Drill" "FALLO rc=$rc"
[ "$(docker ps -aq --filter label=servicedesk.restore-drill=1 | wc -l | tr -d ' ')" = 0 ] && [ -z "$(ls -A "$BACKUP_DIR/drill" 2>/dev/null)" ] \
  && res "Drill limpia su contenedor y sus archivos temporales" OK || res "Limpieza del drill" FALLO
N="$WORK/negset"; U="$WORK/neguploads"; mkdir -p "$N" "$U"; cp -r "$SET2/." "$N/"; rm -f "$N/offsite-status"
docker exec "$SRC_TICKET" tar cf - -C /app/uploads . | tar xf - -C "$U"
victim="$(sd_query "SELECT TOP 1 file_path FROM ticket_db.dbo.attachments WHERE storage_provider = 'local' ORDER BY created_at;" | tr -d '\r' | head -n1)"
rm -f "$U/$victim"; grep -v " ./$victim\$" "$N/uploads.sha256" > "$N/u" && mv "$N/u" "$N/uploads.sha256"
sed -i -E 's/^(users)=([0-9]+) ([0-9]+)$/\1=999 999/' "$N/counts.txt"
( cd "$N" && find db -name '*.bak' -exec sha256sum {} + | LC_ALL=C sort -k2 > SHA256SUMS && sha256sum manifest.json counts.txt uploads.sha256 >> SHA256SUMS )
NR="s3:https://minio:9000/servicedesk-backups-lab/drill-negativo"
RESTIC_REPOSITORY="$NR" bash "$ROOT/scripts/backup/restic-init.sh" >/dev/null 2>&1
RESTIC_REPOSITORY="$NR" bash "$ROOT/scripts/backup/restic-backup.sh" --set "$N" --uploads "bind||$U" >/dev/null 2>&1
RESTIC_REPOSITORY="$NR" BACKUP_DIR="$WORK/backups-neg" bash "$ROOT/scripts/backup/restore-drill.sh" > "$WORK/drillneg.log" 2>&1; rc=$?
grep -q "conteo users" "$WORK/drillneg.log" && grep -q "sin archivo tras restaurar" "$WORK/drillneg.log" && [ "$rc" = 1 ] \
  && res "Drill con conteo falso e imagen ausente → FAIL (detecta ambos)" OK || res "Drill negativo" "FALLO rc=$rc"

# ------------------------------------------------------------------------- 11
step "11. DESASTRE: recuperación en un servidor nuevo"
echo "   El servidor nuevo solo dispone de: paquete de instalación, credenciales S3 y la clave del CUSTODIO."
VERSION="dr-$(date -u +%Y%m%d%H%M%S)"
"$ROOT/scripts/build-server-package.sh" "$VERSION" >/dev/null && PKG="$ROOT/release/servicedesk-uta-server-$VERSION.tar.gz"
mkdir -p "$WORK/dr" && [ -f "${PKG:-/nonexistent}" ] && tar --force-local -xzf "$PKG" -C "$WORK/dr" --strip-components=1 && [ -x "$WORK/dr/scripts/install-server.sh" ] \
  && res "Paquete extraído en un directorio vacío" OK || { res "Paquete" FALLO; step RESUMEN; printf '%s\n' "${RESULTS[@]}"; exit 1; }
[ -d "$WORK/dr/scripts/backup" ] && [ ! -e "$WORK/dr/deploy/backup-lab" ] && ! find "$WORK/dr" -name '*.pass' | grep -q . && res "Paquete sin laboratorio ni archivos de clave" OK || res "Paquete limpio" FALLO
# A partir de aquí, NADA del laboratorio de origen en el entorno (contenedores, .env).
unset MSSQL_CONTAINER TICKET_CONTAINER SD_ENV_FILE SD_COMPOSE_FILE SD_PROJECT; export SD_DIR="$WORK/dr"
mkdir -p "$WORK/dr-secrets"; chmod 700 "$WORK/dr-secrets"
sed -e "s#^RESTIC_PASSWORD_FILE=.*#RESTIC_PASSWORD_FILE=$WORK/custodio.pass#" -e "s#^RESTIC_CACHE_VOLUME=.*#RESTIC_CACHE_VOLUME=sddrsim-restic-cache#" "$LAB_DIR/backup.env" > "$WORK/dr-secrets/backup.env"
export SD_BACKUP_ENV="$WORK/dr-secrets/backup.env"
t0=$(date +%s)
bash "$WORK/dr/scripts/backup/restic-restore.sh" --snapshot latest --target "$WORK/dr-files" 2>&1 | strip | tail -n 5; rc=${PIPESTATUS[0]}
[ "$rc" = 0 ] && res "Snapshot cifrado recuperado con la clave del custodio (SHA-256 verificado)" OK || res "restic-restore" "FALLO rc=$rc"
cmp -s "$WORK/dr-files/manifest.json" "$SET2/manifest.json" && res "Recuperado el último backup (manifest idéntico)" OK || res "Snapshot recuperado" FALLO
[ "$(sha256sum < "$WORK/dr-files/config/server.env")" = "$(sha256sum < "$SRC_ENV")" ] && res "Configuración con secretos recuperada íntegra (sin mostrarla)" OK || res "Configuración" FALLO
f="$WORK/dr/deploy/server/.env"; cp "$WORK/dr/.env.example" "$f"
sed -i -e "s#^PUBLIC_DOMAIN=.*#PUBLIC_DOMAIN=localhost:$GW#" -e "s#^MSSQL_PID=.*#MSSQL_PID=Express#" -e "s#^GATEWAY_BIND_PORT=.*#GATEWAY_BIND_PORT=$GW#" \
       -e "s#^FRONTEND_BIND_PORT=.*#FRONTEND_BIND_PORT=$FE#" -e "s#^INITIAL_ADMIN_EMAIL=.*#INITIAL_ADMIN_EMAIL=#" -e "s#^BACKUP_DIR=.*#BACKUP_DIR=$WORK/dr-backups#" "$f"
printf 'PUBLIC_SCHEME=https\nMSSQL_CONTAINER_MEMORY=3g\n' >> "$f"
"$WORK/dr/scripts/install-server.sh" --mode restore --from "$WORK/dr-files" --generate-secrets --test-mode --yes --project $P_DR > "$WORK/dr-install.log" 2>&1; rc=$?
tail -n 4 "$WORK/dr-install.log" | strip
[ "$rc" = 0 ] && res "Instalación en modo restauración (3 bases + imágenes, credenciales nuevas)" OK || res "Instalación DR" "FALLO rc=$rc"
echo "   RTO de la simulación (descarga + instalación + restauración): $(( $(date +%s) - t0 )) s"
dr() { unset MSSQL_CONTAINER TICKET_CONTAINER SD_ENV_FILE SD_COMPOSE_FILE; export SD_DIR="$WORK/dr" SD_PROJECT=$P_DR BACKUP_DIR="$WORK/dr-backups"; . "$WORK/dr/scripts/lib/common.sh"; . "$WORK/dr/scripts/lib/backup.sh"; }
dr
DR_COUNTS="$(sd_query "$(sd_counts_sql auth_db catalog_db ticket_db)" | tr -d '\r' | tr '\n' ' ')"
exp="$(grep -E '^[a-z_]+=[0-9]+ [0-9]+$' "$WORK/dr-files/counts.txt" | awk -F'[= ]' '{print $1"="$3}' | tr '\n' ' ')"
echo "   restaurado: $DR_COUNTS"
okc=1; [ -n "$exp" ] && [ -n "$DR_COUNTS" ] || okc=0; for kv in $exp; do case " $DR_COUNTS " in *" $kv "*) ;; *) [ "${kv%%=*}" = sessions ] || [ "${kv%%=*}" = auth_logs ] || okc=0;; esac; done
[ "$okc" = 1 ] && res "Conteos de las 13 tablas = backup (sesiones/logs pueden crecer al usarse)" OK || res "Conteos DR" FALLO
rel="$(sd_query "$(sd_relations_sql auth_db catalog_db ticket_db)" | tr -d '\r' | grep '^fk_' | grep -vc '=0$')"
[ -n "$DR_COUNTS" ] && [ "$rel" = 0 ] && res "Relaciones dentro de cada base íntegras" OK || res "Relaciones DR" FALLO
n_up="$(docker exec "$(sd_container ticket-service)" sh -c 'find /app/uploads -type f | wc -l' | tr -d ' ')"
[ -n "$n_up" ] && [ "$n_up" -gt 0 ] && [ "$n_up" = "$(grep -c . "$WORK/dr-files/uploads.sha256")" ] && res "Imágenes en el volumen nuevo: $n_up" OK || res "Imágenes DR" FALLO
admin_email_file="$WORK/dr-secrets/admin.email"
( umask 077; sd_query "SELECT TOP 1 email FROM auth_db.dbo.users WHERE role = 'admin' AND password_hash IS NOT NULL ORDER BY created_at;" | tr -d '\r' | head -n1 > "$admin_email_file" )
[ -s "$admin_email_file" ] || ( umask 077; sd_query "SELECT TOP 1 email FROM auth_db.dbo.users WHERE role = 'admin' ORDER BY created_at;" | tr -d '\r' | head -n1 > "$admin_email_file" )
SECRET_FILE="$WORK/dr-secrets/reset.secret" bash "$WORK/dr/scripts/operations/manage-user.sh" reset-password "$(cat "$admin_email_file")" >/dev/null 2>&1 \
  && res "manage-user reset-password en el servidor recuperado (secreto en archivo 0600)" OK || res "reset-password" FALLO
( umask 077; set +o pipefail; printf 'Dr-%s_Q7x!' "$(LC_ALL=C tr -dc A-Za-z0-9 </dev/urandom 2>/dev/null | head -c 16)" > "$WORK/dr-secrets/new.pw" )
TID="$(sd_query "SELECT TOP 1 CAST(a.ticket_id AS varchar(36)) FROM ticket_db.dbo.attachments a WHERE a.storage_provider = 'local' AND EXISTS (SELECT 1 FROM ticket_db.dbo.ticket_events e WHERE e.ticket_id = a.ticket_id) GROUP BY a.ticket_id ORDER BY COUNT(*) DESC;" | tr -d '\r' | head -n1)"
TT="$(sd_query "SELECT COUNT(*) FROM ticket_db.dbo.tickets;" | tr -d '\r' | head -n1)"
out="$(BASE="http://127.0.0.1:$GW" ADMIN_EMAIL_FILE="$admin_email_file" TEMP_PW_FILE="$WORK/dr-secrets/reset.secret" NEW_PW_FILE="$WORK/dr-secrets/new.pw" \
  TICKET_ID="$TID" EXPECT_TICKETS="$TT" SUMS_FILE="$WORK/dr-files/uploads.sha256" node "$ROOT/scripts/testing/dr-validate.mjs")"; rc=$?
echo "   $out"
[ "$rc" = 0 ] && res "Servidor recuperado: login, cambio de contraseña, tickets, historial, imágenes (SHA-256), 401 sin token" OK || res "Validación funcional DR" FALLO
DR_BEFORE="$(sd_query "$(sd_counts_sql auth_db catalog_db ticket_db)" | tr -d '\r' | grep -vE '^(sessions|auth_logs)=' | tr '\n' ' ')"
bash "$WORK/dr/scripts/backup/restore-drill.sh" --mode instance > "$WORK/drill-instance.log" 2>&1; rc=$?
tail -n 2 "$WORK/drill-instance.log" | strip
DR_AFTER="$(sd_query "$(sd_counts_sql auth_db catalog_db ticket_db)" | tr -d '\r' | grep -vE '^(sessions|auth_logs)=' | tr '\n' ' ')"
left="$(sd_query "SELECT COUNT(*) FROM sys.databases WHERE name LIKE '%restore_verify';" | tr -d '\r' | head -n1)"
[ "$rc" = 0 ] && [ -n "$DR_BEFORE" ] && [ "$DR_BEFORE" = "$DR_AFTER" ] && [ "$left" = 0 ] \
  && res "Drill en modo instancia: PASS, bases principales intactas, *_restore_verify eliminadas" OK || res "Drill instancia" "FALLO rc=$rc left=$left"

# ------------------------------------------------------------------------- 12
step "12. Persistencia y continuidad"
sd_compose restart >/dev/null 2>&1; sd_wait_healthy 300 >/dev/null 2>&1
R2="$(sd_query "$(sd_counts_sql auth_db catalog_db ticket_db)" | tr -d '\r' | grep -vE '^(sessions|auth_logs)=' | tr '\n' ' ')"
[ -n "$R2" ] && [ "$R2" = "$DR_AFTER" ] && res "Reinicio del servidor recuperado: datos idénticos" OK || res "Persistencia DR" FALLO
docker compose -p sdbackuplab restart minio >/dev/null 2>&1; sleep 5
bash "$WORK/dr/scripts/backup/restic-check.sh" --quick >/dev/null 2>&1 && res "Reinicio de MinIO: repositorio y snapshots persisten" OK || res "Persistencia MinIO" FALLO
bash "$WORK/dr/scripts/backup-mssql.sh" > "$WORK/backup-dr.log" 2>&1; rc=$?
[ "$rc" = 0 ] && res "El servidor recuperado hace su propio backup cifrado al mismo repositorio" OK || res "Backup desde DR" "FALLO rc=$rc"

# ------------------------------------------------------------------------- 13
step "13. Secretos y origen"
leaks=0
for sf in "$LAB_DIR/restic.pass" "$WORK/custodio.pass" "$LAB_DIR/lab-user.secret" "$WORK/dr-secrets/new.pw" "$WORK/dr-secrets/reset.secret"; do
  [ -s "$sf" ] || continue; s="$(head -n1 "$sf" | tr -d '\r\n')"
  for lf in "$WORK"/*.log "$WORK"/backups/last-* "$WORK"/backups/drills/*.json "$WORK"/dr-backups/last-* "$WORK"/dr-backups/drills/*.json "$SET2/manifest.json"; do grep -qF -- "$s" "$lf" 2>/dev/null && leaks=$((leaks+1)); done
done
for k in MINIO_ROOT_PASSWORD; do s="$(sed -n "s/^$k=//p" "$LAB_DIR/minio.env")"; grep -qF -- "$s" "$WORK"/*.log && leaks=$((leaks+1)); done
for k in MSSQL_SA_PASSWORD JWT_SECRET; do s="$(sed -n "s/^$k=//p" "$WORK/dr/deploy/server/.env")"; [ -n "$s" ] && grep -qF -- "$s" "$WORK"/*.log && leaks=$((leaks+1)); done
[ "$leaks" = 0 ] && res "Claves, credenciales S3 y contraseñas ausentes de logs, estados, informes y manifest" OK || res "Secretos filtrados" "FALLO ($leaks)"
src
SRC_COUNTS1="$(sd_query "$(sd_counts_sql auth_db catalog_db ticket_db)" | tr -d '\r' | tr '\n' ' ')"
SRC_DBS1="$(sd_query "SELECT name FROM sys.databases ORDER BY name;" | tr -d '\r' | tr '\n' ' ')"
[ "$SRC_COUNTS0" = "$SRC_COUNTS1" ] && [ "$SRC_DBS0" = "$SRC_DBS1" ] && res "Laboratorio de origen intacto (conteos y lista de bases)" OK || res "Origen modificado" FALLO

step "RESUMEN"
okc=0; fc=0
for r in "${RESULTS[@]}"; do n="${r%%|*}"; s="${r#*|}"; [ "$s" = OK ] && okc=$((okc+1)) || fc=$((fc+1)); printf '  %-84s %s\n' "$n" "$s"; done
echo "FASE S — SIMULACIÓN: $okc OK · $fc fallos"
echo "Recursos de prueba: proyecto $P_DR (gw $GW) · laboratorio sdbackuplab · $WORK · paquete $PKG"
echo "Limpieza: $0 --cleanup"
[ "$fc" -eq 0 ]
