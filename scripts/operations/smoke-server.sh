#!/usr/bin/env bash
# =============================================================================
# scripts/operations/smoke-server.sh — smoke test post-instalación (solo curl)
#
#   scripts/operations/smoke-server.sh                 # contra 127.0.0.1 (puertos del .env)
#   SMOKE_BASE_URL=https://dominio scripts/operations/smoke-server.sh   # a través de nginx
#
# Comprueba: gateway, frontend, configuración de auth (bypass deshabilitados),
# endpoints sin contraseña → 404, endpoints protegidos → 401, catálogo, SQL
# Server sin puerto publicado y, si hay credenciales del admin inicial en el
# .env, login local + estadísticas de administrador. No imprime tokens.
# Salida: 0 si todo pasa; 1 si algo falla.
# =============================================================================
set -uo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
sd_require_cmd curl

GW="${SMOKE_BASE_URL:-http://127.0.0.1:$(sd_env_get GATEWAY_BIND_PORT 8080)}"
FE="${SMOKE_BASE_URL:-http://127.0.0.1:$(sd_env_get FRONTEND_BIND_PORT 3000)}"
CURL=(curl -s --max-time 20); [ -n "${SMOKE_INSECURE:-}" ] && CURL+=(-k)
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then ok "$1 ($3)"; pass=$((pass + 1)); else printf '%s  ✘ %s — esperado %s, obtenido %s%s\n' "$C_R" "$1" "$2" "$3" "$C_0"; fail=$((fail + 1)); fi; }
code() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@"; }

health_path=/health; [ -n "${SMOKE_BASE_URL:-}" ] && health_path=/healthz
check "gateway health"                     200 "$(code "$GW$health_path")"
check "frontend sirve la SPA"              200 "$(code "$FE/")"
check "fallback SPA /mis-aceptados"        200 "$(code "$FE/mis-aceptados")"
check "ruta SPA /auth/success"             200 "$(code "$FE/auth/success")"
cfg="$("${CURL[@]}" "$GW/api/auth/config")"
check "auth config: devLoginEnabled=false"          1 "$(grep -c '"devLoginEnabled":false' <<<"$cfg")"
check "auth config: microsoftSimulateEnabled=false" 1 "$(grep -c '"microsoftSimulateEnabled":false' <<<"$cfg")"
check "bypass /api/auth/microsoft-simulate bloqueado" 404 "$(code -X POST -H 'Content-Type: application/json' -d '{"email":"admin@uta.edu.ec"}' "$GW/api/auth/microsoft-simulate")"
check "bypass /api/auth/dev-login bloqueado"          404 "$(code -X POST -H 'Content-Type: application/json' -d '{"email":"admin@uta.edu.ec"}' "$GW/api/auth/dev-login")"
check "endpoint protegido sin JWT → 401"   401 "$(code "$GW/api/tickets/my")"
check "endpoint heredado por nivel → 410"   410 "$(code -X PATCH -H 'Content-Type: application/json' -d '{}' -H 'Authorization: Bearer x' "$GW/api/tickets/00000000-0000-4000-8000-000000000000/status")"
check "canje SSO con código inválido → 400"  400 "$(code -X POST -H 'Content-Type: application/json' -d '{"code":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}' "$GW/api/auth/sso/exchange")"
check "catálogo de servicios"              200 "$(code "$GW/api/catalog/services")"
check "ubicaciones"                        200 "$(code "$GW/api/catalog/locations")"

if [ -z "${SMOKE_BASE_URL:-}" ]; then
  m="$(sd_container mssql)"
  if [ -n "$m" ]; then
    check "SQL Server sin puertos publicados al host" "" "$(docker port "$m" 2>/dev/null | tr -d '\n')"
  fi
fi

# Fase R: ninguna contraseña vive en el .env. El login solo se prueba si el
# operador pasa SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD en el entorno.
ae="${SMOKE_ADMIN_EMAIL:-}"; ap="${SMOKE_ADMIN_PASSWORD:-}"
if [ -n "$ae" ] && [ -n "$ap" ]; then
  body="$(printf '{"correo":"%s","password":"%s"}' "$ae" "$ap")"
  resp="$("${CURL[@]}" -H 'Content-Type: application/json' -d "$body" "$GW/api/auth/login")"
  token="$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' <<<"$resp")"
  check "login local del administrador inicial" yes "$([ -n "$token" ] && echo yes || echo no)"
  if [ -n "$token" ]; then
    check "estadísticas de administrador" 200 "$(code -H "Authorization: Bearer $token" "$GW/api/admin/stats/tickets")"
    check "resumen de técnicos" 200 "$(code -H "Authorization: Bearer $token" "$GW/api/admin/technicians/summary")"
  fi
  unset token resp body
else
  warn "Sin SMOKE_ADMIN_EMAIL/SMOKE_ADMIN_PASSWORD: se omite la prueba de login local"
fi

echo "SMOKE: $pass OK · $fail fallos"
[ "$fail" -eq 0 ]
