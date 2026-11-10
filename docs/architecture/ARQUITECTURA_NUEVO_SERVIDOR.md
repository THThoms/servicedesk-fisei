# Arquitectura del servidor nuevo

Escrito para: el equipo técnico que instala, opera o audita el servidor nuevo de ServiceDesk UTA.

Fuente de verdad: `deploy/server/compose.yaml`, `deploy/nginx/`, `deploy/systemd/` y `scripts/install-server.sh`. La arquitectura de la aplicación (microservicios, roles, flujo de tickets) está en [ARQUITECTURA_SERVICEDESK.md](ARQUITECTURA_SERVICEDESK.md).

## 1. Vista general

```text
Internet
   │  :80 (→ 301 https, ACME)   :443 (TLS)          :22 (SSH, solo clave)
   ▼
┌──────────────────────── HOST Ubuntu 24.04 · UFW: 22/80/443 ────────────────────────┐
│  nginx (host)  /api/* → 127.0.0.1:8080     /* → 127.0.0.1:3000                       │
│                /healthz → gateway /health/ready     /uploads/ → 404                  │
│                                                                                       │
│  ┌─ red "edge" ──────────────────────────────┐                                       │
│  │ frontend :80 (nginx SPA) ← 127.0.0.1:3000 │                                       │
│  │ api-gateway :8080        ← 127.0.0.1:8080 │                                       │
│  └──────────────┬────────────────────────────┘                                       │
│  ┌─ red "app" ──┴──────────────────────────────────────────────┐ (salida a Internet:  │
│  │ api-gateway → auth-service:3001 · catalog-service:3002 ·    │  Microsoft SSO, SMTP,│
│  │               ticket-service:3003                            │  FCM)                │
│  └──────────────┬──────────────────────────────────────────────┘                      │
│  ┌─ red "data" (internal: SIN Internet) ───────────────────────┐                      │
│  │ auth / catalog / ticket ──► mssql:1433 (no publicado)       │                      │
│  └──────────────────────────────────────────────────────────────┘                     │
│  volúmenes: mssql-system · mssql-data · mssql-tlog · mssql-backup · ticket-uploads    │
│  systemd: backup diario → Restic (cifrado) → B2 · verificación 6 h · drill mensual    │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Recorrido de una petición

1. El navegador o la app Android pide `https://<dominio>/api/tickets/my`.
2. **UFW** deja pasar el 443. **nginx del host** termina TLS, añade las cabeceras de seguridad y pasa `/api/` a `127.0.0.1:8080`.
3. Docker entrega la petición a **api-gateway**, en la red `edge`, por el puerto publicado **solo** en loopback.
4. El gateway valida CORS y la reenvía por la red `app` a `ticket-service:3003/tickets/my`, añadiendo `X-Forwarded-For`. Los servicios confían en 2 saltos de proxy.
5. **ticket-service** valida el JWT (firma y sesión, consultando `auth-service/auth/verify` con una caché de 30 s) y consulta **mssql:1433** por la red `data`.
6. Una imagen adjunta se sirve **solo** por `GET /api/tickets/:ticketId/attachments/:attachmentId`, con JWT y comprobación de área. nginx devuelve 404 a `/uploads/`.
7. El resto de rutas (`/`, `/login`, `/auth/success`…) van a `127.0.0.1:3000`, el **frontend**: SPA estática con caché de `/assets/`.

## 3. Contenedores

| Servicio | Imagen [fijada] | Redes | Puerto | Healthcheck (real) | Límites |
|---|---|---|---|---|---|
| mssql-volumes | SQL Server (misma imagen) | ninguna | — | se ejecuta una vez: deja los volúmenes con propietario 10001 y permisos 770 | — |
| mssql | `mssql/server:2022-CU27-GDR1-ubuntu-22.04@sha256:cf8f…1718` | data | no publicado | `sqlcmd SELECT 1` | 3 GiB · 2 CPU |
| mssql-init | misma | data | — | se ejecuta una vez: crea las 3 bases y los 3 logins, aplica RECOVERY SIMPLE y remapea usuarios | — |
| auth-service | `node:22.23.4-slim` | data, app | — | `GET /health/ready`: `SELECT 1` con límite de 3 s | 512 MiB · 1 CPU |
| catalog-service | `node:22.23.4-slim` | data, app | — | ídem | 512 MiB · 1 CPU |
| ticket-service | `node:22.23.4-slim` | data, app | — | ídem + volumen de imágenes escribible | 512 MiB · 1 CPU |
| api-gateway | `node:22.23.4-alpine` | app, edge | 127.0.0.1:8080 | `GET /health/ready`: los 3 servicios listos | 256 MiB · 0,5 CPU |
| frontend | `nginx:1.28.3-alpine` | edge | 127.0.0.1:3000 | `GET http://127.0.0.1/`; con `127.0.0.1`, no `localhost`, para evitar el falso unhealthy por IPv6 del VPS anterior | 128 MiB · 0,5 CPU |

**Orden de arranque:**
1. mssql-volumes (completado).
2. mssql (healthy).
3. mssql-init (completado).
4. auth y catalog (healthy).
5. ticket, que también espera a catalog.
6. gateway, cuando los 3 están healthy.
7. frontend, cuando el gateway está healthy.

**Todos los servicios:**
- `restart: unless-stopped`.
- Logs `json-file` de 20 MB × 5.
- `no-new-privileges` en la aplicación.
- `NODE_ENV=production`, que bloquea dev-login, el login simulado y las cuentas demo.

**Comportamiento probado** (simulación Fase T):
- Si SQL Server cae, `/health/ready` devuelve 503 y los servicios pasan a *unhealthy*.
- Cuando SQL Server vuelve, todo regresa a healthy sin intervención.
- Si un proceso muere, Docker lo reinicia.

## 4. Persistencia

| Volumen | Montaje | Contenido | Propietario |
|---|---|---|---|
| `servicedesk_mssql-system` | `/var/opt/mssql` | Configuración, secrets y errorlog de SQL Server | mssql (10001), 770 |
| `servicedesk_mssql-data` | `/var/opt/mssql/data` | `.mdf` de todas las bases (incluidas master/msdb) | ídem |
| `servicedesk_mssql-tlog` | `/var/opt/mssql/tlog` | `.ldf` (log de transacciones) de las bases de la aplicación | ídem |
| `servicedesk_mssql-backup` | `/var/opt/mssql/backup` | `.bak` temporales de backup y restauración (se borran tras copiarlos) | ídem |
| `servicedesk_ticket-uploads` | `/app/uploads` (ticket-service) | Imágenes adjuntas | node |

Los volúmenes sobreviven a `docker compose up -d --build`, a la recreación de contenedores, al reinicio del host y a la actualización del frontend. **Nunca** se usa `down -v`. Los scripts leen las rutas de SQL Server con `SERVERPROPERTY('InstanceDefault*Path')`, así que funcionan igual con un solo volumen (laboratorio) o con volúmenes separados (servidor).

## 5. Configuración y secretos

| Archivo | Contenido | Permisos | ¿En el backup cifrado? |
|---|---|---|---|
| `deploy/server/.env` | SQL, JWT, SSO, SMTP, FCM, dominio, `SERVER_PURPOSE`, `MSSQL_PID` | 600 | Sí |
| `/etc/servicedesk/backup.env` | Repositorio y credenciales S3 limitadas | 600 | No (custodia) |
| `/etc/servicedesk/restic.pass` | Clave de cifrado de los backups | 600 | No (custodia) |
| `deploy/server/.initial-admin-secret` | Contraseña temporal del primer admin | 600; se borra tras leerla | No |

Los secretos internos los genera el instalador (`--generate-secrets`), distintos entre sí y nunca impresos. **No se reutilizan contraseñas del VPS anterior.** El instalador se niega a usar un `.env` de otra instalación (`SD_ENV_FILE` heredado).

## 6. Servidor de pruebas frente a producción

| | Pruebas (primera instalación) | Producción |
|---|---|---|
| `SERVER_PURPOSE` | `pruebas` | `produccion` (por defecto) |
| `MSSQL_PID` | `Developer`: **solo** desarrollo, evaluación y pruebas | `Express`, `Standard` o la clave de producto. Developer y Evaluation están bloqueados |
| Cambio | Editar las dos variables y recrear `mssql`. Los microservicios no cambian | — |

## 7. Documentos relacionados

- [REQUISITOS_NUEVO_SERVIDOR.md](../installation/REQUISITOS_NUEVO_SERVIDOR.md)
- [CONFIGURACION_RED.md](../installation/CONFIGURACION_RED.md)
- [CONFIGURACION_NGINX.md](../installation/CONFIGURACION_NGINX.md)
- [CONFIGURACION_SQL_SERVER.md](../installation/CONFIGURACION_SQL_SERVER.md)
- [SEGURIDAD_SERVIDOR.md](../installation/SEGURIDAD_SERVIDOR.md)
- [RECUPERACION_SERVIDOR.md](../installation/RECUPERACION_SERVIDOR.md)
- [MONITOREO_SERVIDOR.md](../operations/MONITOREO_SERVIDOR.md)
- [BACKUPS_MSSQL.md](../operations/BACKUPS_MSSQL.md)
