#!/usr/bin/env bash
# =============================================================================
# deploy/backup-lab/lab.sh — laboratorio S3 (MinIO) aislado para Restic
#
#   LAB_DIR=/ruta/privada deploy/backup-lab/lab.sh up        # crea y configura todo
#   LAB_DIR=...           deploy/backup-lab/lab.sh status
#   LAB_DIR=...           deploy/backup-lab/lab.sh scan <texto>   # busca texto plano en el almacenamiento crudo
#   LAB_DIR=...           deploy/backup-lab/lab.sh down       # para (conserva datos)
#   LAB_DIR=...           deploy/backup-lab/lab.sh destroy    # borra SOLO el laboratorio
#
# 'up' genera en $LAB_DIR (permisos 700, FUERA de Git):
#   minio.env      credenciales root de MinIO (solo laboratorio)
#   restic.pass    clave de cifrado Restic de laboratorio
#   backup.env     configuración para los scripts (SD_BACKUP_ENV=$LAB_DIR/backup.env)
#   certs/         CA autofirmada y certificado de "minio"
# y en MinIO: bucket PRIVADO servicedesk-backups-lab, usuario restic-lab con
# política limitada a ese bucket (equivalente a una Application Key de B2
# restringida), y un bucket ajeno "otro-proyecto" para probar el aislamiento.
# Nunca imprime secretos. No publica puertos. No usa volúmenes de otros proyectos.
# =============================================================================
set -euo pipefail
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DIR="${LAB_DIR:?Define LAB_DIR (directorio privado del laboratorio, fuera del repositorio)}"
P=sdbackuplab; BUCKET=servicedesk-backups-lab
RESTIC_IMAGE="${RESTIC_IMAGE:-restic/restic:0.18.0}"
hp() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
dc() { docker compose -p $P -f "$(hp "$HERE/compose.yaml")" --env-file "$(hp "$LAB_DIR/minio.env")" "$@"; }
rnd() { (set +o pipefail; LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom 2>/dev/null | head -c "$1"); }
mcx() { docker exec -i "$@"; }

case "${1:-}" in
up)
  umask 077; mkdir -p "$LAB_DIR/certs/CAs"; chmod 700 "$LAB_DIR"
  [ -f "$LAB_DIR/minio.env" ] || printf 'MINIO_ROOT_USER=labroot%s\nMINIO_ROOT_PASSWORD=%s\n' "$(rnd 6)" "$(rnd 40)" > "$LAB_DIR/minio.env"
  [ -f "$LAB_DIR/restic.pass" ] || rnd 64 > "$LAB_DIR/restic.pass"
  [ -f "$LAB_DIR/lab-user.secret" ] || rnd 40 > "$LAB_DIR/lab-user.secret"
  if [ ! -f "$LAB_DIR/certs/public.crt" ]; then
    c="$LAB_DIR/certs"
    openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=ServiceDesk Backup Lab CA" \
      -keyout "$c/ca.key" -out "$c/CAs/ca.crt" >/dev/null 2>&1
    openssl req -newkey rsa:2048 -nodes -subj "/CN=minio" -keyout "$c/private.key" -out "$c/server.csr" >/dev/null 2>&1
    printf 'subjectAltName=DNS:minio,DNS:localhost\nextendedKeyUsage=serverAuth\n' > "$c/ext.cnf"
    openssl x509 -req -in "$c/server.csr" -CA "$c/CAs/ca.crt" -CAkey "$c/ca.key" -CAcreateserial -days 30 \
      -extfile "$c/ext.cnf" -out "$c/public.crt" >/dev/null 2>&1
    rm -f "$c/server.csr" "$c/ext.cnf" "$c/ca.key" "$c/CAs/ca.srl" "$c"/*.srl
  fi
  # Certificados → volumen propio (propietario 1001, clave 600): igual en Linux y Windows.
  docker volume inspect ${P}_minio-certs >/dev/null 2>&1 || docker volume create --label com.docker.compose.project=$P ${P}_minio-certs >/dev/null
  tar -C "$LAB_DIR/certs" -cf - public.crt private.key CAs/ca.crt | docker run --rm -i --entrypoint sh -v ${P}_minio-certs:/certs "$RESTIC_IMAGE" \
    -c 'tar -xf - -C /certs && chown -R 1001:0 /certs && chmod 600 /certs/private.key && chmod 644 /certs/public.crt /certs/CAs/ca.crt'
  dc up -d --wait minio >/dev/null
  C="$(dc ps -q minio)"
  # Toda la configuración se hace DENTRO del contenedor con sus propias variables:
  # las credenciales root nunca pasan por la línea de comandos del host.
  LAB_SECRET="$(cat "$LAB_DIR/lab-user.secret")" mcx -e LAB_SECRET -e BUCKET=$BUCKET "$C" sh -s <<'SH' >/dev/null
set -e
export MC_CONFIG_DIR=/tmp/mc; mkdir -p $MC_CONFIG_DIR/certs/CAs; cp /certs/CAs/ca.crt $MC_CONFIG_DIR/certs/CAs/
mc alias set lab https://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing lab/$BUCKET
mc mb --ignore-existing lab/otro-proyecto
mc anonymous set none lab/$BUCKET
cat > /tmp/policy.json <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:GetBucketLocation","s3:ListBucket"],"Resource":["arn:aws:s3:::$BUCKET"]},
 {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":["arn:aws:s3:::$BUCKET/*"]}]}
JSON
mc admin policy create lab servicedesk-restic-only /tmp/policy.json 2>/dev/null || true
mc admin user add lab restic-lab "$LAB_SECRET"
mc admin policy attach lab servicedesk-restic-only --user restic-lab 2>/dev/null || true
rm -f /tmp/policy.json; rm -rf /tmp/mc
SH
  cat > "$LAB_DIR/backup.env" <<ENV
# Generado por deploy/backup-lab/lab.sh — SOLO LABORATORIO
RESTIC_REPOSITORY=s3:https://minio:9000/$BUCKET/servicedesk
RESTIC_PASSWORD_FILE=$LAB_DIR/restic.pass
AWS_ACCESS_KEY_ID=restic-lab
AWS_SECRET_ACCESS_KEY=$(cat "$LAB_DIR/lab-user.secret")
RESTIC_CACERT=$LAB_DIR/certs/CAs/ca.crt
RESTIC_DOCKER_NETWORK=${P}_s3
RESTIC_SNAPSHOT_HOST=servicedesk-lab
RESTIC_CACHE_VOLUME=${P}_restic-cache
ENV
  chmod 600 "$LAB_DIR"/*.env "$LAB_DIR"/*.pass "$LAB_DIR"/*.secret 2>/dev/null || true
  echo "laboratorio listo: bucket privado $BUCKET, usuario restic-lab (política limitada), red interna ${P}_s3"
  echo "usa: SD_BACKUP_ENV=$LAB_DIR/backup.env"
  ;;
status) dc ps; docker network inspect ${P}_s3 -f 'red {{.Name}} internal={{.Internal}}' ;;
scan)
  # Cuenta archivos del almacenamiento CRUDO de MinIO que contienen el texto dado.
  [ -n "${2:-}" ] || { echo "uso: lab.sh scan <texto>"; exit 2; }
  SCAN="$2" docker run --rm -e SCAN --entrypoint sh -v ${P}_minio-data:/d:ro "$RESTIC_IMAGE" -c 'grep -rlF -- "$SCAN" /d 2>/dev/null | wc -l'
  ;;
down) dc down ;;
destroy)
  dc down -v 2>/dev/null || true
  docker volume rm ${P}_minio-certs ${P}_restic-cache >/dev/null 2>&1 || true
  rm -rf "$LAB_DIR"; echo "laboratorio $P eliminado (solo sus volúmenes y $LAB_DIR)"
  ;;
*) sed -n '2,20p' "$0"; exit 2;;
esac
