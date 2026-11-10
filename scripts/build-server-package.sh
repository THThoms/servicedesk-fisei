#!/usr/bin/env bash
# =============================================================================
# scripts/build-server-package.sh — genera el paquete de instalación del servidor
#
#   scripts/build-server-package.sh [VERSION]
#
# Salida (carpeta release/, excluida de Git):
#   release/servicedesk-uta-server-<VERSION>.tar.gz
#   release/servicedesk-uta-server-<VERSION>.tar.gz.sha256
#   release/servicedesk-uta-server-<VERSION>.MANIFEST.md   (también dentro del tar)
#   release/servicedesk-uta-server-<VERSION>.FILES.txt     (también dentro del tar)
#
# Incluye solo lo necesario para construir y operar en el servidor: fuentes de
# los 5 componentes, Dockerfiles, deploy/, scripts/ de servidor, .env.example y
# documentación vigente. EXCLUYE: .env reales, secretos, node_modules, dist,
# build, Android/APK, backups, uploads, .git, archivo PostgreSQL, historial,
# auditorías de seguridad, pruebas, cuentas demo y herramientas de laboratorio.
#
# Verificaciones antes de empaquetar (aborta si fallan):
#   · ningún .env real, clave privada, keystore ni google-services.json
#   · ningún VALOR secreto de los .env locales aparece en el contenido
#   · ninguna referencia de runtime a PostgreSQL en deploy/ y scripts/
#   · ninguna ruta interna, IP pública, contraseña demo ni cuenta institucional real
# =============================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="${1:-$(date -u +%Y.%m.%d)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)}"
NAME="servicedesk-uta-server-$VERSION"
OUT="$ROOT/release"
STAGE="$(mktemp -d)/$NAME"
trap 'rm -rf "$(dirname "$STAGE")"' EXIT
mkdir -p "$OUT" "$STAGE"

INCLUDE=(
  api-gateway auth-service catalog-service ticket-service frontend
  deploy scripts .env.example
  docs/architecture docs/installation docs/operations docs/troubleshooting
)
EXCLUDES=(
  --exclude='node_modules' --exclude='dist' --exclude='build' --exclude='coverage'
  --exclude='*.tsbuildinfo' --exclude='.gradle' --exclude='frontend/android'
  --exclude='uploads/*' --exclude='*.log' --exclude='.DS_Store'
  --exclude='.env' --exclude='.env.*' --exclude='*/.env' --exclude='*/.env.*'
  --exclude='google-services.json' --exclude='*service-account*.json'
  --exclude='*.keystore' --exclude='*.jks' --exclude='*.pem' --exclude='*.key' --exclude='*.pfx'
  --exclude='*.apk' --exclude='*.aab' --exclude='*.bak' --exclude='*.tar.gz'
  --exclude='scripts/legacy' --exclude='.install-state*'
  --exclude='deploy/backup-lab' --exclude='*.pass' --exclude='backup.env' --exclude='scripts/testing/backup-dr-simulation.sh'
  --exclude='*/tests' --exclude='auth-service/prisma/seed.demo*' --exclude='ticket-service/scripts/seedHistoricalTickets.js'
  --exclude='frontend/scripts' --exclude='frontend/capacitor.config.ts'
  --exclude='scripts/testing/lab-copy-migration-test.sh' --exclude='scripts/testing/browser-ui-check.mjs'
  --exclude='scripts/testing/new-server-simulation.sh' --exclude='scripts/testing/dr-validate.mjs'
  --exclude='scripts/init-mssql-lab.sh' --exclude='scripts/init-mssql-lab.sql'
  --exclude='scripts/build-server-package.sh' --exclude='scripts/README.md'
)
PRESENT=()
for p in "${INCLUDE[@]}"; do
  if [ -e "$p" ]; then PRESENT+=("$p"); else echo "  ⚠ no existe (se omite): $p"; fi
done
for req in api-gateway auth-service catalog-service ticket-service frontend deploy scripts .env.example; do
  [ -e "$req" ] || { echo "✘ Falta componente obligatorio: $req"; exit 1; }
done
echo "==> Copiando fuentes a staging"
tar -cf - "${EXCLUDES[@]}" "${PRESENT[@]}" | tar -xf - -C "$STAGE"
echo "$VERSION" > "$STAGE/VERSION"
# La plantilla .env.example sí debe ir (el patrón .env.* la habría excluido).
cp .env.example "$STAGE/.env.example"

echo "==> Verificaciones de seguridad"
bad="$(cd "$STAGE" && find . \( -name '.env' -o -name '.env.*' ! -name '.env.example' -o -name 'google-services.json' \
        -o -name '*.keystore' -o -name '*.jks' -o -name '*.pem' -o -name '*.key' -o -name '*.apk' \) -print)"
[ -z "$bad" ] || { echo "✘ Archivos prohibidos en el paquete:"; echo "$bad"; exit 1; }
grep -rIl -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' "$STAGE" && { echo "✘ Clave privada encontrada"; exit 1; } || true

# Valores secretos de los .env locales (no se imprimen; solo se cuentan).
SECRET_KEYS='PASSWORD|SECRET|PRIVATE_KEY|SMTP_PASS|API_KEY|CLIENT_SECRET|JWT_SECRET'
leaks=0; checked=0
for envf in .env .env.mssql deploy/server/.env; do
  [ -f "$envf" ] || continue
  while IFS= read -r line; do
    key="${line%%=*}"; val="${line#*=}"; val="${val%$'\r'}"; val="${val#\"}"; val="${val%\"}"
    [[ "$key" =~ $SECRET_KEYS ]] || continue
    [ "${#val}" -ge 8 ] || continue
    checked=$((checked + 1))
    if grep -rIqF -- "$val" "$STAGE"; then leaks=$((leaks + 1)); echo "✘ El valor de $key ($envf) aparece en el paquete"; fi
  done < <(grep -E '^[A-Z_]+=' "$envf")
done
[ "$leaks" -eq 0 ] || exit 1
echo "  ✔ $checked valores secretos locales comprobados: 0 apariciones"

# Fase X: nada interno ni de laboratorio en lo que se distribuye.
forbidden="$(cd "$STAGE" && find . \( -path './docs/security*' -o -path './docs/history*' -o -path './archive*' -o -path '*/tests' -o -name 'seed.demo*' -o -name 'schema.pg*' -o -name 'seedHistoricalTickets.js' \) -print)"
[ -z "$forbidden" ] || { echo "✘ Rutas internas en el paquete:"; echo "$forbidden"; exit 1; }
if [ -f auth-service/prisma/seed.demo.ts ]; then
  demo_hits=0
  while IFS= read -r v; do
    # passwordSecurity.ts las lista como contraseñas prohibidas: no son credenciales.
    grep -rIqF --exclude=passwordSecurity.ts -- "$v" "$STAGE" && demo_hits=$((demo_hits + 1))
  done < <(sed -n 's/.*password: "\([^"]*\)".*/\1/p' auth-service/prisma/seed.demo.ts)
  [ "$demo_hits" -eq 0 ] || { echo "✘ $demo_hits contraseñas demo aparecen en el paquete"; exit 1; }
  # Personas y correos de las cuentas demo (las genéricas de prueba no identifican a nadie).
  people_hits=0
  while IFS= read -r v; do
    [ -n "$v" ] || continue
    grep -rIqF -- "$v" "$STAGE" && people_hits=$((people_hits + 1))
  done < <( { sed -n 's/.*name: "\([^"]*\)".*/\1/p' auth-service/prisma/seed.demo.ts | grep -vE 'Prueba|UTA' | sed 's/ (.*//'; \
              grep -oE '[a-z0-9._-]+@uta\.edu\.ec' auth-service/prisma/seed.demo.ts | grep -vE '^(admin|docente|estudiante)@'; } )
  [ "$people_hits" -eq 0 ] || { echo "✘ $people_hits datos de personas de las cuentas demo aparecen en el paquete"; exit 1; }
fi
ips="$(grep -rIoE '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "$STAGE" --exclude=package-lock.json | grep -vE ':(127\.|10\.|0\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|255\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)' || true)"
[ -z "$ips" ] || { echo "✘ Direcciones IP públicas en el paquete (archivo, sin valor):"; echo "$ips" | cut -d: -f1 | sort -u; exit 1; }
accounts="$(grep -rIlE '\b[a-z]+[0-9]{3,}@uta\.edu\.ec\b' "$STAGE" || true)"
[ -z "$accounts" ] || { echo "✘ Cuentas institucionales con formato real en el paquete:"; echo "$accounts"; exit 1; }
echo "  ✔ sin auditorías, pruebas, cuentas demo, IP públicas ni cuentas reales"

pg="$(grep -rIniE --exclude=build-server-package.sh 'postgres|5432|pg_dump' "$STAGE/deploy" "$STAGE/scripts" | grep -viE '^[^:]+:[0-9]+:\s*#|PostgreSQL (fue|está) retirado|no (usa|requiere|instala) PostgreSQL|sin PostgreSQL|PostgreSQL retirado' || true)"
[ -z "$pg" ] || { echo "✘ Referencias de runtime a PostgreSQL:"; echo "$pg"; exit 1; }
echo "  ✔ deploy/ y scripts/ sin dependencias de PostgreSQL"

# Fin de línea: lo que se ejecuta o se lee en Linux debe ir con LF. Un paquete
# generado desde una copia de Windows con core.autocrlf=true llevaría CRLF (bash\r).
# Se cuenta el CR con tr y su código octal: un CR escrito en el script se pierde
# dentro de $( ) en Git Bash y el patrón quedaría vacío.
crlf="$(cd "$STAGE" && find . -type f \( -name '*.sh' -o -name '*.mjs' -o -name '*.sql' -o -name 'Dockerfile*' \
        -o -name '.env.example' -o -path './deploy/*' -o -path './scripts/*' \) ! -name '*.bat' ! -name '*.cmd' -print |
        while IFS= read -r f; do [ "$(tr -cd '\015' < "$f" | wc -c)" -eq 0 ] || echo "$f"; done)"
[ -z "$crlf" ] || { echo "✘ Archivos con fin de línea de Windows (CRLF) en el paquete:"; echo "$crlf"
                    echo "  Genera el paquete desde un clon con core.autocrlf=false."; exit 1; }
echo "  ✔ scripts y configuración del servidor con fin de línea LF"
chmod +x "$STAGE"/scripts/*.sh "$STAGE"/scripts/*/*.sh "$STAGE"/deploy/server/mssql-init/init.sh 2>/dev/null || true

echo "==> Manifest"
GIT_REV="$(git rev-parse HEAD 2>/dev/null || echo 'sin git')"
DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
( cd "$STAGE" && find . -type f ! -name FILES.txt | LC_ALL=C sort | sed 's#^\./##' ) > "$STAGE/FILES.txt"
NFILES="$(wc -l < "$STAGE/FILES.txt" | tr -d ' ')"
cat > "$STAGE/MANIFEST.md" <<EOF
# ServiceDesk UTA — paquete de servidor \`$NAME\`

| Campo | Valor |
|---|---|
| Versión | \`$VERSION\` |
| Fecha (UTC) | $(date -u +%FT%TZ) |
| Commit base | \`$GIT_REV\` (archivos sin commitear al empaquetar: $DIRTY) |
| Archivos | $NFILES (lista completa en \`FILES.txt\`) |
| Motor de base de datos | SQL Server 2022 (único). PostgreSQL retirado: no se incluye. |

## Contenido
| Ruta | Para qué |
|---|---|
| \`auth-service/\`, \`catalog-service/\`, \`ticket-service/\` | Fuentes + \`Dockerfile.mssql\` + schemas Prisma (\`provider = "sqlserver"\`) |
| \`api-gateway/\`, \`frontend/\` | Fuentes + Dockerfile (la app Android no va en este paquete) |
| \`deploy/server/compose.yaml\` | Compose de producción (6 servicios + init) |
| \`deploy/server/mssql-init/\` | Bootstrap idempotente de bases y logins |
| \`deploy/nginx/\` | Plantillas nginx del host (TLS y arranque ACME) |
| \`deploy/systemd/\` | Timers de backup, verificación, retención, restore drill y alertas |
| \`deploy/backup/\` | Plantilla de /etc/servicedesk/backup.env (Restic → B2/S3) |
| \`scripts/install-server.sh\` | Instalador (\`--mode clean\` / \`--mode restore\`) |
| \`scripts/backup-mssql.sh\`, \`scripts/restore-mssql.sh\` | Backup y restauración |
| \`scripts/backup/\` | Restic: init, backup, check, retención, restauración, claves, restore drill |
| \`scripts/operations/\` | Smoke, gestión de usuarios, verificación de backups, alertas |
| \`scripts/testing/smoke-e2e.mjs\` | Prueba E2E funcional (requiere Node 20+, opcional) |
| \`.env.example\` | Plantilla única de configuración (sin valores) |
| \`docs/\` | Arquitectura, instalación, operación y solución de problemas |

## Qué NO contiene
Ningún \`.env\` real, contraseña, JWT, clave FCM, service account de Firebase,
credencial SMTP o Cloudinary, certificado TLS, APK, \`node_modules\`, backups,
imágenes de usuarios, datos personales, \`.git\` ni archivos de PostgreSQL. Tampoco
auditorías de seguridad, historial de fases, pruebas automatizadas, cuentas demo ni
herramientas de laboratorio.

## Verificar e instalar
\`\`\`bash
sha256sum -c $NAME.tar.gz.sha256
sudo mkdir -p /opt/servicedesk && sudo tar -xzf $NAME.tar.gz -C /opt/servicedesk --strip-components=1
cd /opt/servicedesk && less docs/installation/INSTALACION_SERVIDOR_NUEVO.md
\`\`\`
Backup: \`docs/operations/BACKUPS_MSSQL.md\` · Restore y rollback: \`docs/operations/RESTAURACION_Y_ROLLBACK.md\`
EOF
( cd "$STAGE" && find . -type f ! -name FILES.txt | LC_ALL=C sort | sed 's#^\./##' ) > "$STAGE/FILES.txt"

echo "==> Empaquetando"
TARBALL="$OUT/$NAME.tar.gz"
MTIME="$(git log -1 --format=%cI 2>/dev/null || date -u +%FT%TZ)"
( cd "$(dirname "$STAGE")" && tar --sort=name --mtime="$MTIME" --owner=0 --group=0 --numeric-owner -cf - "$NAME" | gzip -n -9 > "$TARBALL" )
( cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
cp "$STAGE/MANIFEST.md" "$OUT/$NAME.MANIFEST.md"
cp "$STAGE/FILES.txt" "$OUT/$NAME.FILES.txt"
echo "✔ $TARBALL ($(du -h "$TARBALL" | cut -f1), $NFILES archivos)"
echo "✔ $(cat "$OUT/$NAME.tar.gz.sha256")"
