#!/usr/bin/env bash
# =============================================================================
# ServiceDesk UTA — funciones comunes de backup externo (Restic sobre S3).
# Se incluye DESPUÉS de lib/common.sh:   . "$SD_DIR/scripts/lib/backup.sh"
#
# Dos secretos DISTINTOS, ambos fuera del repositorio y fuera de deploy/server/.env:
#   · Clave de cifrado de Restic  → archivo $RESTIC_PASSWORD_FILE (600, root)
#   · Credenciales S3 (B2 / MinIO) → AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
#     en $SD_BACKUP_ENV (por defecto /etc/servicedesk/backup.env, 600, root)
#
# Variables de $SD_BACKUP_ENV (plantilla: deploy/backup/backup.env.example):
#   RESTIC_REPOSITORY        s3:https://<endpoint>/<bucket>/<prefijo>  (o se compone
#                            con B2_S3_ENDPOINT + B2_BUCKET + RESTIC_REPOSITORY_PREFIX)
#   RESTIC_PASSWORD_FILE     ruta del archivo con la clave de cifrado
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   Application Key limitada al bucket
#   B2_S3_ENDPOINT / B2_BUCKET / B2_REGION       (sin valores por defecto inventados)
#   RESTIC_CACERT            CA propia (solo laboratorio con TLS autofirmado)
#   RESTIC_IMAGE             imagen oficial fijada (restic/restic:0.18.0)
#   RESTIC_DOCKER_NETWORK    red Docker desde la que se alcanza el S3 (bridge)
#   RESTIC_SNAPSHOT_HOST     nombre lógico estable del servidor en los snapshots
#   RESTIC_ALLOW_HTTP        true SOLO en laboratorio (por defecto exige https)
#   RESTIC_KEEP_DAILY/WEEKLY/MONTHLY   14 / 8 / 12
#
# Restic se ejecuta SIEMPRE en un contenedor efímero de la imagen fijada: el
# mismo binario en el servidor, en la restauración y en las pruebas. Los
# secretos llegan al contenedor por nombre de variable (-e NOMBRE) y por un
# archivo montado de solo lectura: nunca aparecen en la línea de comandos.
# =============================================================================

SD_BACKUP_ENV="${SD_BACKUP_ENV:-/etc/servicedesk/backup.env}"
command -v cygpath >/dev/null 2>&1 && SD_BACKUP_ENV="$(cygpath -m "$SD_BACKUP_ENV")"
export MSYS_NO_PATHCONV=1   # Git Bash: no reescribir rutas /run/... de los argumentos

# Ruta utilizable por docker.exe (Windows) o la misma ruta (Linux).
sd_hostpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# Lee UNA clave de $SD_BACKUP_ENV sin evaluar el archivo.
sd_benv_get() { SD_ENV_FILE="$SD_BACKUP_ENV" sd_env_get "$@"; }

# Carga la configuración de backup en variables EXPORTADAS (sin imprimir nada).
# Una variable ya presente en el entorno tiene prioridad (útil en pruebas).
sd_backup_load() {
  local k
  for k in RESTIC_REPOSITORY RESTIC_PASSWORD_FILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY \
           B2_S3_ENDPOINT B2_BUCKET B2_REGION RESTIC_REPOSITORY_PREFIX RESTIC_CACERT \
           RESTIC_IMAGE RESTIC_DOCKER_NETWORK RESTIC_SNAPSHOT_HOST RESTIC_ALLOW_HTTP \
           RESTIC_KEEP_DAILY RESTIC_KEEP_WEEKLY RESTIC_KEEP_MONTHLY RESTIC_CHECK_SUBSET \
           RESTIC_CACHE_VOLUME BACKUP_HEARTBEAT_URL; do
    if [ -z "${!k:-}" ]; then export "$k=$(sd_benv_get "$k")"; else export "$k"; fi
  done
  : "${RESTIC_IMAGE:=restic/restic:0.18.0}"
  : "${RESTIC_DOCKER_NETWORK:=bridge}"
  : "${RESTIC_SNAPSHOT_HOST:=servicedesk}"
  : "${RESTIC_ALLOW_HTTP:=false}"
  : "${RESTIC_KEEP_DAILY:=14}"; : "${RESTIC_KEEP_WEEKLY:=8}"; : "${RESTIC_KEEP_MONTHLY:=12}"
  : "${RESTIC_CHECK_SUBSET:=5%}"
  : "${RESTIC_CACHE_VOLUME:=servicedesk-restic-cache}"
  if [ -z "$RESTIC_REPOSITORY" ] && [ -n "$B2_S3_ENDPOINT" ] && [ -n "$B2_BUCKET" ]; then
    local ep="$B2_S3_ENDPOINT"; case "$ep" in http://*|https://*) ;; *) ep="https://$ep";; esac
    RESTIC_REPOSITORY="s3:${ep%/}/$B2_BUCKET/${RESTIC_REPOSITORY_PREFIX:-servicedesk}"
  fi
  export RESTIC_REPOSITORY
  # La región solo se pasa si se configuró explícitamente (no se inventa ninguna).
  if [ -n "$B2_REGION" ]; then export AWS_DEFAULT_REGION="$B2_REGION"; fi
  export RESTIC_PROGRESS_FPS=0.016
}

# ¿Hay un repositorio externo configurado? (no valida que funcione)
sd_backup_configured() { [ -n "${RESTIC_REPOSITORY:-}" ] && [ -n "${RESTIC_PASSWORD_FILE:-}" ]; }

# Valida la configuración sin mostrar valores. Devuelve 0 o muere con un código.
sd_backup_validate() {
  local missing=""
  for k in RESTIC_REPOSITORY RESTIC_PASSWORD_FILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
    [ -n "${!k:-}" ] || missing+=" $k"
  done
  [ -z "$missing" ] || { SD_ERR_CODE=E_CONFIG; die "Configuración de backup externo incompleta (faltan:$missing) en $SD_BACKUP_ENV" 2; }
  case "$RESTIC_REPOSITORY" in
    s3:https://*) ;;
    s3:http://*) [ "$RESTIC_ALLOW_HTTP" = true ] || { SD_ERR_CODE=E_CONFIG; die "El repositorio usa http:// sin TLS. Solo se permite en laboratorio (RESTIC_ALLOW_HTTP=true)" 2; } ;;
    *) SD_ERR_CODE=E_CONFIG; die "RESTIC_REPOSITORY debe ser s3:https://<endpoint>/<bucket>/<prefijo>" 2;;
  esac
  [ -f "$RESTIC_PASSWORD_FILE" ] || { SD_ERR_CODE=E_CONFIG; die "No existe el archivo de clave Restic indicado en RESTIC_PASSWORD_FILE" 2; }
  [ -s "$RESTIC_PASSWORD_FILE" ] || { SD_ERR_CODE=E_CONFIG; die "El archivo de clave Restic está vacío" 2; }
  if ! command -v cygpath >/dev/null 2>&1; then   # Linux: permisos estrictos
    local m; m="$(stat -c %a "$RESTIC_PASSWORD_FILE" 2>/dev/null || echo 600)"
    case "$m" in 600|400) ;; *) SD_ERR_CODE=E_CONFIG; die "El archivo de clave Restic tiene permisos $m (se exige 600 o 400)" 2;; esac
    m="$(stat -c %a "$SD_BACKUP_ENV" 2>/dev/null || echo 600)"
    case "$m" in 600|400) ;; *) SD_ERR_CODE=E_CONFIG; die "$SD_BACKUP_ENV tiene permisos $m (se exige 600 o 400)" 2;; esac
  fi
  [ -z "${RESTIC_CACERT:-}" ] || [ -f "$RESTIC_CACERT" ] || { SD_ERR_CODE=E_CONFIG; die "RESTIC_CACERT apunta a un archivo inexistente" 2; }
}

# Ejecuta restic en un contenedor efímero.
#   SD_RESTIC_MOUNTS=( -v origen:destino:ro ... )  montajes adicionales (array)
#   SD_RESTIC_PASSWORD_FILE=<ruta>                 clave alternativa (rotación / custodios)
#   SD_RESTIC_ENTRYPOINT=sh                        (solo pruebas) ejecutar un script en el contenedor
# stdout = salida de restic; stderr se guarda en $SD_RESTIC_ERR y se reenvía.
SD_RESTIC_ERR=""
sd_restic() {
  local pass="${SD_RESTIC_PASSWORD_FILE:-$RESTIC_PASSWORD_FILE}" ca=() rc had_e=0
  case "$-" in *e*) had_e=1;; esac
  [ -n "${SD_RESTIC_ERR:-}" ] || SD_RESTIC_ERR="$(mktemp)"
  if [ -n "${RESTIC_CACERT:-}" ]; then ca=(-v "$(sd_hostpath "$RESTIC_CACERT"):/run/secrets/restic-ca.crt:ro" -e RESTIC_CACERT=/run/secrets/restic-ca.crt); fi
  local ep=(); [ -n "${SD_RESTIC_ENTRYPOINT:-}" ] && ep=(--entrypoint "$SD_RESTIC_ENTRYPOINT")
  local name="sd-restic-$$-$RANDOM" to=(); [ -n "${SD_RESTIC_TIMEOUT:-}" ] && to=(timeout --foreground "$SD_RESTIC_TIMEOUT")
  set +e
  "${to[@]}" docker run --rm -i --name "$name" --label servicedesk.restic=1 --network "$RESTIC_DOCKER_NETWORK" \
    --security-opt no-new-privileges --cap-drop ALL --cap-add DAC_READ_SEARCH --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE \
    -e RESTIC_REPOSITORY -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
    -e RESTIC_PASSWORD_FILE=/run/secrets/restic-pass -e RESTIC_CACHE_DIR=/cache -e RESTIC_PROGRESS_FPS \
    -v "$(sd_hostpath "$pass"):/run/secrets/restic-pass:ro" "${ca[@]}" \
    -v "$RESTIC_CACHE_VOLUME:/cache" \
    "${SD_RESTIC_MOUNTS[@]}" "${ep[@]}" \
    "$RESTIC_IMAGE" "$@" 2> >(tee "$SD_RESTIC_ERR" >&2)
  rc=$?
  wait 2>/dev/null || true
  if [ "$rc" -eq 124 ]; then   # límite de tiempo: el contenedor no debe quedar vivo
    docker rm -f "$name" >/dev/null 2>&1 || true
    echo "sd_restic: límite de ${SD_RESTIC_TIMEOUT}s superado" >> "$SD_RESTIC_ERR"
  fi
  [ "$had_e" = 1 ] && set -e
  return $rc
}
SD_RESTIC_MOUNTS=()

# Comprobación previa acotada en el tiempo (restic reintenta los errores del
# backend durante muchos minutos): el repositorio existe, las credenciales S3
# valen y la clave Restic lo abre. Devuelve el código de salida de restic.
sd_restic_preflight() {
  local rc=0
  SD_RESTIC_TIMEOUT="${RESTIC_PREFLIGHT_TIMEOUT:-90}" sd_restic cat config >/dev/null 2>&1 || rc=$?
  return $rc
}

# Traduce el resultado de restic a un código de error estable para alertas.
# Códigos de salida de restic ≥ 0.17: 10 repo inexistente · 11 bloqueo · 12 clave incorrecta.
sd_restic_classify() {
  local rc="$1" e=""; [ -f "${SD_RESTIC_ERR:-/nonexistent}" ] && e="$(cat "$SD_RESTIC_ERR")"
  case "$rc" in
    0) echo OK; return;;
    10) echo E_REPO_NOT_INIT; return;;
    11) echo E_REPO_LOCKED; return;;
    12) echo E_REPO_PASSWORD; return;;
  esac
  case "$e" in
    *AccessDenied*|*InvalidAccessKeyId*|*SignatureDoesNotMatch*|*"signature we calculated does not match"*|*"Access Key Id you provided does not exist"*|*"403 Forbidden"*|*"Access Denied"*|*Unauthorized*|*InvalidToken*) echo E_REPO_CREDENTIALS;;
    *x509*|*certificate*) echo E_REPO_TLS;;
    *"no such host"*|*"connection refused"*|*"i/o timeout"*|*"dial tcp"*|*"network is unreachable"*|*"context deadline exceeded"*|*"límite de"*) echo E_REPO_UNREACHABLE;;
    *"no space left"*) echo E_NO_SPACE;;
    *NoSuchBucket*|*"bucket does not exist"*) echo E_REPO_NOT_INIT;;
    *) echo E_RESTIC;;
  esac
}

sd_restic_explain() {
  case "$1" in
    E_REPO_NOT_INIT) echo "el repositorio no existe o no está inicializado (scripts/backup/restic-init.sh)";;
    E_REPO_LOCKED) echo "el repositorio está bloqueado por otra operación";;
    E_REPO_PASSWORD) echo "la clave de cifrado Restic no abre el repositorio";;
    E_REPO_CREDENTIALS) echo "credenciales S3 inválidas o sin permisos sobre el bucket";;
    E_REPO_TLS) echo "error TLS/certificado al conectar con el almacenamiento";;
    E_REPO_UNREACHABLE) echo "el almacenamiento externo no es accesible (red/DNS/endpoint)";;
    E_NO_SPACE) echo "falta de espacio en disco";;
    *) echo "error de restic (ver journal)";;
  esac
}

# Estado legible por máquinas: key=value, SIN secretos.
#   sd_status_write <archivo> <status> <code> <detail> [backup_id]
sd_status_write() {
  local f="$1" tmp; tmp="$(mktemp "$(dirname "$f")/.status.XXXXXX")"
  printf 'status=%s\ncode=%s\nbackup_id=%s\nfinished=%s\nhost=%s\ndetail=%s\n' \
    "$2" "$3" "${5:-}" "$(date -u +%FT%TZ)" "$(hostname)" "$4" > "$tmp"
  chmod 600 "$tmp" 2>/dev/null || true
  mv -f "$tmp" "$f"
}

# Latido externo opcional (healthchecks.io, Uptime Kuma push, …): si el servidor
# muere o el backup deja de ejecutarse, el servicio EXTERNO avisa por su cuenta.
sd_heartbeat() { # sd_heartbeat ok|fail
  [ -n "${BACKUP_HEARTBEAT_URL:-}" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  local u="$BACKUP_HEARTBEAT_URL"; [ "$1" = fail ] && u="${u%/}/fail"
  curl -fsS -m 10 --retry 2 -o /dev/null "$u" 2>/dev/null || warn "No se pudo enviar el latido externo"
}

# ----------------------------------------------------------------------------
# Conteos y relaciones (mismo SQL en el backup y en el restore drill).
#   sd_counts_sql <auth_db> <catalog_db> <ticket_db>    → filas  tabla=N
#   sd_relations_sql <auth_db> <catalog_db> <ticket_db> → filas  fk_*=N / xref_*=N
# fk_*   : referencias dentro de una misma base (con FOREIGN KEY): deben ser 0.
# xref_* : referencias ENTRE bases (sin FOREIGN KEY posible): se comparan con el
#          valor registrado en el origen; una restauración correcta no las aumenta.
# ----------------------------------------------------------------------------
SD_COUNT_TABLES="A:users A:sessions A:auth_logs C:services C:routing_rules C:locations C:knowledge_articles C:knowledge_keywords T:tickets T:ticket_events T:attachments T:device_tokens T:email_outbox"

sd_counts_sql() {
  local A="$1" C="$2" T="$3" spec db tbl sql=""
  for spec in $SD_COUNT_TABLES; do
    case "${spec%%:*}" in A) db="$A";; C) db="$C";; T) db="$T";; esac
    tbl="${spec#*:}"
    [ -n "$sql" ] && sql+=$'\nUNION ALL '
    sql+="SELECT '$tbl=' + CAST((SELECT COUNT_BIG(*) FROM [$db].dbo.[$tbl]) AS varchar(20))"
  done
  printf '%s;\n' "$sql"
}

sd_relations_sql() {
  local A="$1" C="$2" T="$3"
  cat <<SQL
SELECT 'fk_events_without_ticket=' + CAST((SELECT COUNT_BIG(*) FROM [$T].dbo.ticket_events e WHERE NOT EXISTS (SELECT 1 FROM [$T].dbo.tickets t WHERE t.id = e.ticket_id)) AS varchar(20))
UNION ALL SELECT 'fk_attachments_without_ticket=' + CAST((SELECT COUNT_BIG(*) FROM [$T].dbo.attachments a WHERE NOT EXISTS (SELECT 1 FROM [$T].dbo.tickets t WHERE t.id = a.ticket_id)) AS varchar(20))
UNION ALL SELECT 'fk_outbox_without_ticket=' + CAST((SELECT COUNT_BIG(*) FROM [$T].dbo.email_outbox o WHERE o.ticket_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [$T].dbo.tickets t WHERE t.id = o.ticket_id)) AS varchar(20))
UNION ALL SELECT 'fk_keywords_without_article=' + CAST((SELECT COUNT_BIG(*) FROM [$C].dbo.knowledge_keywords k WHERE NOT EXISTS (SELECT 1 FROM [$C].dbo.knowledge_articles a WHERE a.id = k.article_id)) AS varchar(20))
UNION ALL SELECT 'fk_rules_without_service=' + CAST((SELECT COUNT_BIG(*) FROM [$C].dbo.routing_rules r WHERE NOT EXISTS (SELECT 1 FROM [$C].dbo.services s WHERE s.id = r.service_id)) AS varchar(20))
UNION ALL SELECT 'fk_sessions_without_user=' + CAST((SELECT COUNT_BIG(*) FROM [$A].dbo.sessions s WHERE NOT EXISTS (SELECT 1 FROM [$A].dbo.users u WHERE u.id = s.user_id)) AS varchar(20))
UNION ALL SELECT 'xref_ticket_user_missing=' + CAST((SELECT COUNT_BIG(*) FROM [$T].dbo.tickets t WHERE NOT EXISTS (SELECT 1 FROM [$A].dbo.users u WHERE u.id = t.user_id)) AS varchar(20))
UNION ALL SELECT 'xref_ticket_technician_missing=' + CAST((SELECT COUNT_BIG(*) FROM [$T].dbo.tickets t WHERE t.assigned_technician_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [$A].dbo.users u WHERE u.id = t.assigned_technician_id)) AS varchar(20))
UNION ALL SELECT 'xref_ticket_service_missing=' + CAST((SELECT COUNT_BIG(*) FROM [$T].dbo.tickets t WHERE NOT EXISTS (SELECT 1 FROM [$C].dbo.services s WHERE s.id = t.service_id)) AS varchar(20))
UNION ALL SELECT 'xref_ticket_article_missing=' + CAST((SELECT COUNT_BIG(*) FROM [$T].dbo.tickets t WHERE t.knowledge_article_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [$C].dbo.knowledge_articles a WHERE a.id = t.knowledge_article_id)) AS varchar(20))
UNION ALL SELECT 'xref_event_performer_missing=' + CAST((SELECT COUNT_BIG(*) FROM [$T].dbo.ticket_events e WHERE NOT EXISTS (SELECT 1 FROM [$A].dbo.users u WHERE u.id = e.performed_by)) AS varchar(20))
UNION ALL SELECT 'xref_device_user_missing=' + CAST((SELECT COUNT_BIG(*) FROM [$T].dbo.device_tokens d WHERE NOT EXISTS (SELECT 1 FROM [$A].dbo.users u WHERE u.id = d.user_id)) AS varchar(20))
UNION ALL SELECT 'xref_article_service_missing=' + CAST((SELECT COUNT_BIG(*) FROM [$C].dbo.knowledge_articles a WHERE a.service_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [$C].dbo.services s WHERE s.id = a.service_id)) AS varchar(20))
UNION ALL SELECT 'xref_article_author_missing=' + CAST((SELECT COUNT_BIG(*) FROM [$C].dbo.knowledge_articles a WHERE a.created_by_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [$A].dbo.users u WHERE u.id = a.created_by_user_id)) AS varchar(20));
SQL
}

# Archivo físico de cada adjunto local:  provider|nombre  (solo el nombre de
# archivo, nunca datos del ticket). Los externos (cloudinary) se listan aparte.
sd_attachments_sql() {
  printf "SELECT storage_provider + '|' + COALESCE(file_path, REPLACE(image_url, '/uploads/', ''), '') FROM [%s].dbo.attachments;\n" "$1"
}

# Escapa un valor para JSON (los valores aquí son controlados: nombres, números).
sd_json_str() { local s="${1//\/\\}"; s="${s//\"/\\\"}"; s="${s//$'\t'/ }"; s="${s//$'\n'/ }"; printf '"%s"' "$s"; }
