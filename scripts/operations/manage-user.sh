#!/usr/bin/env bash
# =============================================================================
# scripts/operations/manage-user.sh — gestión de usuarios de ServiceDesk UTA
#
# Roles oficiales (Fase R): user | technician | dtic | admin
#   technician → área TECHNICIANS · dtic → área DTIC (DTIC NO es administrador)
#   (se aceptan como alias los antiguos tech_n1/tech_n2 → technician, tech_n3/tech_n4 → dtic)
#
#   manage-user.sh bootstrap-admin <correo> ["Nombre"] [--sso-only]
#       Crea el ADMINISTRADOR INICIAL solo si no existe ningún admin. Genera una
#       contraseña TEMPORAL que NO se muestra: se guarda en un archivo 0600
#       (por defecto deploy/server/.initial-admin-secret) para que el operador la
#       lea una vez y lo borre. El primer login obliga a cambiarla.
#   manage-user.sh reset-password <correo>
#       Contraseña temporal nueva (mismo mecanismo), revoca sus sesiones.
#   manage-user.sh set-role <correo> <rol>
#   manage-user.sh set-block <correo> BLOQUE_1|BLOQUE_2|ninguno
#       Fase T: bloque físico de la FISEI, SOLO para técnicos (DTIC no tiene bloque).
#   manage-user.sh create <correo> <rol> "<Nombre Apellido>" [--password]
#       Sin --password → cuenta solo-SSO. Con --password → la pide sin eco
#       (o NEW_USER_PASSWORD en el entorno). Política: ≥12, mayúscula,
#       minúscula, número y símbolo. Nunca se imprime.
#   manage-user.sh list-staff
#
# Variables: SECRET_FILE (ruta del archivo de la contraseña temporal).
# Se ejecuta dentro del contenedor auth-service. Requiere el stack en marcha.
# =============================================================================
set -euo pipefail
SD_LOG_TAG="manage-user"
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"

cmd="${1:-}"; shift || true
AUTH_C="${AUTH_CONTAINER:-$(sd_compose ps -q auth-service 2>/dev/null | head -n1)}"
[ -n "$AUTH_C" ] || die "auth-service no está en ejecución"

normalize_role() {
  case "$1" in
    user|technician|dtic|admin) echo "$1";;
    tech_n1|tech_n2) echo technician;;
    tech_n3|tech_n4) echo dtic;;
    *) die "Rol inválido '$1' (user|technician|dtic|admin)";;
  esac
}

# Escribe la contraseña temporal (stdin) en un archivo 0600 sin mostrarla.
store_secret() {
  local file="${SECRET_FILE:-$(dirname "$SD_ENV_FILE")/.initial-admin-secret}" secret
  secret="$(cat)"
  [ -n "$secret" ] || die "No se recibió la contraseña temporal"
  ( umask 077; printf '%s\n' "$secret" > "$file" )
  chmod 600 "$file" 2>/dev/null || true
  ok "Contraseña temporal guardada en $file (permisos 600). NO se muestra en pantalla."
  echo "   Léela una sola vez:   sudo cat '$file'"
  echo "   Luego bórrala:        sudo shred -u '$file'   (o rm -f)"
  echo "   El primer inicio de sesión obligará a cambiarla."
}

run_node() { docker exec -i -e SD_ARGS -e NEW_USER_PASSWORD "$AUTH_C" node -e "$1"; }

JS_COMMON='
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();
const ROLES = ["user","technician","dtic","admin"];
const args = JSON.parse(process.env.SD_ARGS || "{}");
const domain = (process.env.ALLOWED_DOMAIN || "uta.edu.ec").toLowerCase();
const strong = (p) => p.length >= 12 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
function fail(m){ console.error("ERROR: " + m); process.exit(2); }
'
json_args() { python3 -c 'import json,sys;print(json.dumps(dict(zip(sys.argv[1::2],sys.argv[2::2]))))' "$@" 2>/dev/null \
  || node -e 'const a=process.argv.slice(1);const o={};for(let i=0;i<a.length;i+=2)o[a[i]]=a[i+1];console.log(JSON.stringify(o))' "$@"; }

case "$cmd" in
  bootstrap-admin)
    [ $# -ge 1 ] || die 'Uso: manage-user.sh bootstrap-admin <correo> ["Nombre"] [--sso-only]'
    email="$1"; name="${2:-Administrador ServiceDesk}"; extra=()
    for a in "$@"; do [ "$a" = "--sso-only" ] && extra+=(--sso-only); done
    [ "$name" = "--sso-only" ] && name="Administrador ServiceDesk"
    set +e
    out="$(docker exec -i "$AUTH_C" node dist/maintenance/bootstrapAdmin.js create --email "$email" --name "$name" "${extra[@]}")"
    rc=$?
    set -e
    case "$rc" in
      0) if [ -n "$out" ]; then printf '%s' "$out" | store_secret; else ok "Administrador solo-SSO creado: entra con Microsoft."; fi;;
      3) warn "Ya existe un administrador: el bootstrap no crea otro."; exit 3;;
      *) die "bootstrap-admin falló (código $rc)";;
    esac
    unset out
    ;;
  reset-password)
    [ $# -eq 1 ] || die "Uso: manage-user.sh reset-password <correo>"
    out="$(docker exec -i "$AUTH_C" node dist/maintenance/bootstrapAdmin.js reset --email "$1")" || die "reset-password falló"
    SECRET_FILE="${SECRET_FILE:-$(dirname "$SD_ENV_FILE")/.reset-password-secret}"
    printf '%s' "$out" | store_secret
    unset out
    ;;
  set-role)
    [ $# -eq 2 ] || die "Uso: manage-user.sh set-role <correo> <rol>"
    export SD_ARGS; SD_ARGS="$(json_args email "$1" role "$(normalize_role "$2")")"
    run_node "$JS_COMMON"'
(async () => {
  const email = args.email.trim().toLowerCase();
  if (!ROLES.includes(args.role)) fail("rol inválido (" + ROLES.join("|") + ")");
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u) fail("usuario no encontrado: debe iniciar sesión una vez por SSO o crearse con create");
  // Fase T: el bloque (BLOQUE_1/2) solo existe para technician; al cambiar de rol se borra.
  await prisma.user.update({ where: { email }, data: { role: args.role, ...(args.role === "technician" ? {} : { block: null }) } });
  await prisma.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
  console.log("OK rol " + u.role + " -> " + args.role + " para " + email + " (sesiones revocadas: debe volver a iniciar sesión)");
})().catch(e => fail(e.message)).finally(() => prisma.$disconnect());'
    ;;
  set-block)
    [ $# -eq 2 ] || die "Uso: manage-user.sh set-block <correo> BLOQUE_1|BLOQUE_2|ninguno"
    case "$2" in BLOQUE_1|BLOQUE_2) blk="$2";; ninguno|NONE|none) blk="";; *) die "Bloque inválido: $2";; esac
    export SD_ARGS; SD_ARGS="$(json_args email "$1" block "$blk")"
    run_node "$JS_COMMON"'
(async () => {
  const email = args.email.trim().toLowerCase();
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u) fail("usuario no encontrado");
  if (u.role !== "technician") fail("solo los técnicos (rol technician) se clasifican por bloque; rol actual: " + u.role);
  await prisma.user.update({ where: { email }, data: { block: args.block || null } });
  console.log("OK bloque de " + email + " → " + (args.block || "sin bloque"));
})().catch(e => fail(e.message)).finally(() => prisma.$disconnect());'
    ;;
  create)
    [ $# -ge 3 ] || die 'Uso: manage-user.sh create <correo> <rol> "<Nombre>" [--password]'
    email="$1"; role="$(normalize_role "$2")"; name="$3"; withpw="${4:-}"
    if [ "$withpw" = "--password" ] && [ -z "${NEW_USER_PASSWORD:-}" ]; then
      read -r -s -p "Contraseña para $email: " NEW_USER_PASSWORD; echo
      read -r -s -p "Repite la contraseña: " pw2; echo
      [ "$NEW_USER_PASSWORD" = "$pw2" ] || die "Las contraseñas no coinciden"
    fi
    [ "$withpw" = "--password" ] || NEW_USER_PASSWORD=""
    export NEW_USER_PASSWORD SD_ARGS
    SD_ARGS="$(json_args email "$email" role "$role" name "$name")"
    run_node "$JS_COMMON"'
(async () => {
  const email = args.email.trim().toLowerCase();
  if (!email.endsWith("@" + domain)) fail("el correo debe ser @" + domain);
  if (!ROLES.includes(args.role)) fail("rol inválido (" + ROLES.join("|") + ")");
  const pw = process.env.NEW_USER_PASSWORD || "";
  if (pw && !strong(pw)) fail("la contraseña no cumple la política (>=12, mayúscula, minúscula, número, símbolo)");
  if (await prisma.user.findUnique({ where: { email } })) fail("ya existe: usa set-role para cambiar su rol");
  await prisma.user.create({ data: { email, name: args.name.trim(), role: args.role, passwordHash: pw ? bcrypt.hashSync(pw, 12) : null } });
  console.log("OK creado " + email + " rol=" + args.role + (pw ? " (con contraseña local)" : " (solo SSO)"));
})().catch(e => fail(e.message)).finally(() => prisma.$disconnect());'
    ;;
  list-staff)
    run_node "$JS_COMMON"'
(async () => {
  const rows = await prisma.user.findMany({ where: { role: { not: "user" } }, select: { name: true, role: true }, orderBy: [{ role: "asc" }, { name: "asc" }] });
  const label = { admin: "Administrador", technician: "Técnico (Técnicos)", dtic: "DTIC" };
  for (const r of rows) console.log((label[r.role] || r.role).padEnd(20) + " " + r.name);
  console.log("total=" + rows.length);
})().catch(e => fail(e.message)).finally(() => prisma.$disconnect());'
    ;;
  *) sed -n '2,25p' "$0"; exit 1;;
esac
