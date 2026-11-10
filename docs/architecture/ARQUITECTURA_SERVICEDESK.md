# Arquitectura de ServiceDesk UTA

Escrito para: desarrolladores y operadores que necesitan entender el sistema sin contexto previo.
Vigente desde 2026-11.

## 1. Qué es

Mesa de ayuda institucional de la FISEI (Universidad Técnica de Ambato). Los
usuarios registran tickets, los técnicos los atienden por **área**
(`TECHNICIANS` o `DTIC`) y los administradores supervisan. Se usa desde el
navegador y desde la app Android (Capacitor), que es el mismo frontend empaquetado.

## 2. Componentes

```text
 Navegador / APK Android (WebView Capacitor, bundle offline)
          │ HTTPS
          ▼
 nginx del HOST (TLS, cabeceras, límite de login)          ← deploy/nginx/
   ├─ /api/*   ─────────────┐
   └─ resto (SPA) ──┐       │
                    ▼       ▼
             frontend    api-gateway  (127.0.0.1 únicamente)
             (nginx)     (Express + http-proxy-middleware)
                            │ red "app"
          ┌─────────────────┼──────────────────┐
          ▼                 ▼                  ▼
    auth-service     catalog-service     ticket-service ── volumen ticket-uploads
          │ red "data" (internal: sin salida a Internet)
          ▼
    SQL Server 2022 ── auth_db · catalog_db · ticket_db
```

| Servicio | Puerto interno | Responsabilidad | Base |
|---|---:|---|---|
| frontend | 80 | React 18 + Vite + Tailwind (SPA) | — |
| api-gateway | 8080 | Único punto de entrada HTTP; CORS; proxy a servicios | — |
| auth-service | 3001 | Login local (bcrypt), Microsoft Entra ID SSO, JWT, sesiones, auditoría de acceso | `auth_db` |
| catalog-service | 3002 | Servicios, reglas de enrutamiento, ubicaciones, base de conocimiento | `catalog_db` |
| ticket-service | 3003 | Tickets, asignación, reescalamiento, validación, historial, adjuntos, EmailOutbox, FCM, estadísticas | `ticket_db` |
| mssql | 1433 (no publicado) | SQL Server 2022 | 3 bases |

Rutas del gateway: `/api/auth/*` y `/auth/*` → auth · `/api/catalog/*`,
`/api/knowledge/*` → catalog · `/api/tickets/*`, `/api/routing/*`,
`/api/admin/*`, `/api/notifications/*` → ticket · `/health`.

## 3. Datos (SQL Server 2022, motor único)

- Una instancia, **tres bases aisladas**. Cada servicio tiene su propio login,
  que es `db_owner` **solo** de su base (Prisma `db push` necesita DDL). `sa` solo
  se usa para el bootstrap (`deploy/server/mssql-init/`) y los backups.
- Prisma 5 con `provider = "sqlserver"`. Cada servicio tiene `prisma/schema.prisma`
  y `prisma/schema.mssql.prisma`, **idénticos**: el `Dockerfile.mssql` copia el
  segundo sobre el primero, así que cualquier cambio debe hacerse en ambos.
- Tipos: UUID como `UniqueIdentifier`, textos `NVarChar(n)`. Los "enums" son
  constantes de dominio (`src/domain/enums.ts`) sobre columnas `NVarChar`.
- `auth_db.users`: índice único **filtrado** `users_ms_oid_key_filtered`
  (`ms_oid IS NOT NULL`), creado por el entrypoint de auth-service.
- `catalog_db`: `services`, `routing_rules`, `locations`, `knowledge_articles`,
  `knowledge_keywords` (relación, sustituye al `String[]` de PostgreSQL).
- `ticket_db`: `tickets`, `ticket_events` (historial, nunca se sobrescribe),
  `attachments`, `email_outbox`, `device_tokens`.
- Recuperación `SIMPLE` + backup completo diario (RPO 24 h).

## 4. Roles (Fase R)

| Rol | Área | Puede |
|---|---|---|
| `admin` | Técnicos y DTIC | Todo: estadísticas, historial general, asignación directa, catálogo, KB, ubicaciones |
| `technician` | **TECHNICIANS** | Ver/aceptar/atender tickets de su área; consultar la KB |
| `dtic` | **DTIC** | Ver/aceptar/atender tickets de su área; consultar la KB. **No es administrador** |
| `user` | — | Crear tickets y ver/validar **solo los suyos** |

- La autorización se decide en el **backend** con una regla única (`ticket-service/src/services/areaService.ts` → `ticketAccess`): un técnico solo accede a tickets de **su área** o al ticket que tiene asignado; el propietario accede al suyo (solo eventos públicos); nadie más.
- Los roles anteriores `tech_n1/tech_n2` → `technician` y `tech_n3/tech_n4` → `dtic` se migran al arrancar auth-service (mismos IDs) y se normalizan en los JWT antiguos. Los niveles N1–N4 ya no autorizan nada.

## 5. Flujo de un ticket

```text
abierto ─aceptar→ en_proceso ─resolver→ pendiente_validacion
   ▲                  │  ▲                    │
   │      reescalar   │  │ rechazo (motivo    ├─ propietario acepta → CERRADO
   └─ (libera técnico,┘  │ obligatorio, mismo │
       área destino)     └── técnico) ────────┘
```

- El área se decide con las reglas de enrutamiento del servicio.
- `PUT /tickets/:id/escalate` con `targetArea` libera siempre al técnico anterior.
- La asignación directa a un técnico es solo de administrador: `POST /admin/tickets/:id/assign`.
- Solo el **propietario** valida la solución (`user-accept` / `user-reject`).
  Al aceptar, el estado pasa a **`cerrado`** (Fase R), con el evento `USER_ACCEPTED`
  (`pendiente_validacion → cerrado`). Los tickets cerrados antes de la Fase R quedaron
  en `resuelto`: se conservan así (estado final heredado), sin reescribir el historial.
- No existe ningún endpoint para cambiar el estado directamente: los endpoints del
  modelo por nivel (`GET /tickets`, `GET /tickets/level`, `PUT /tickets/escalate`,
  `PATCH /tickets/:id/status`, `POST /routing/*`) responden **410 Gone**.
- Cada acción deja un `TicketEvent`: CREATED, ACCEPTED, CONTRIBUTED, ESCALATED,
  RESOLVED, USER_REJECTED_RESOLUTION, USER_ACCEPTED.

## 6. Imágenes adjuntas

- Hasta 5 imágenes JPG, PNG o WebP de 5 MB por ticket. El cliente las **comprime**
  antes de subir (lado mayor ≤ 1920 px, JPEG 0.8; PNG si hay transparencia) y rechaza
  HEIC con un mensaje claro. El backend valida el **tipo real por sus bytes** (no el MIME
  declarado), guarda el tipo detectado y corrige la extensión. Se guardan como archivos en el
  volumen `ticket-uploads`; la base guarda solo la referencia. Nunca Base64.
- Se sirven **solo** por `GET /api/tickets/:ticketId/attachments/:attachmentId`
  (JWT + propietario/técnico/admin + `attachment.ticketId` coincidente +
  Content-Type real + `nosniff`). El historial serializa esa ruta.
- El frontend (web y Android) usa `AuthenticatedImage`: `fetch` con JWT → Blob → `URL.createObjectURL`.
- `/uploads/*` nunca se usa desde el navegador; nginx lo responde con 404.
- `STORAGE_MODE=cloudinary` existe en el código, pero el paquete `cloudinary` no
  está instalado: el modo efectivo es `local`.

## 7. Autenticación

- **Login local** (`POST /auth/login`) con bcrypt (12 rondas), tiempo de respuesta igual exista o no la cuenta, y **limitación de intentos** por IP (20/15 min) y por cuenta (5 fallos → enfriamiento progresivo 1, 2, 4… hasta 15 min; nunca bloqueo permanente). Respuesta 429 con `Retry-After`.
- **Microsoft Entra ID**: `/auth/microsoft` → `/api/auth/microsoft/callback`, que redirige con un **código opaco de un solo uso** (`?code=`, 60 s), **nunca con el JWT**. El cliente lo canjea con `POST /api/auth/sso/exchange` y recibe el JWT en el cuerpo. En Android vuelve por `ec.uta.servicedesk://auth/success?code=…`.
- **Sesiones**: la tabla `sessions` guarda solo el **SHA-256 del JWT**. auth-service valida firma + sesión (no revocada, no expirada); **ticket y catalog consultan la sesión** en `POST /auth/verify` (caché 30 s, falla cerrado), así que el logout y las revocaciones son efectivos en todos los servicios. Las sesiones caducadas/revocadas se purgan a los 7 días.
- **Contraseña temporal**: el administrador inicial (y los resets) reciben una contraseña temporal; su token lleva `pwdChange` y solo sirve para `POST /auth/change-password`.
- **JWT** compartido (`JWT_SECRET`) firmado por auth-service.
- **Mecanismos de laboratorio** (`/auth/dev-login`, `/auth/microsoft-simulate`,
  cuentas demo del seed): opt-in por variable y **bloqueados en código cuando
  `NODE_ENV=production`** (Fase P). En producción responden 404.

## 8. Notificaciones

- Correo: patrón *outbox* (`email_outbox`: pending/sent/failed) con nodemailer.
  `EMAIL_SEND_MODE=log|smtp`.
- Push: Firebase Cloud Messaging con `firebase-admin` (`FCM_MODE=off|log|firebase`).
  Los tokens de dispositivo viven en `device_tokens`; las credenciales, solo en backend.

## 9. Entornos

| Entorno | Archivo | SQL Server | Notas |
|---|---|---|---|
| Desarrollo / laboratorio | `compose.yaml` + `.env.mssql` | Developer | Puertos 14330/18080/13000 en 127.0.0.1; dev-login y cuentas demo |
| Servidor nuevo (producción) | `deploy/server/compose.yaml` + `deploy/server/.env` | Edición definida por `MSSQL_PID` (obligatoria) | Instalador `scripts/install-server.sh` |
| Instalación heredada | — | — | No forma parte de este paquete; se retira tras la migración |

## 10. Tecnologías

Node.js 20, Express, TypeScript, Prisma 5, Zod, JWT, bcryptjs, multer,
nodemailer, firebase-admin · React 18, Vite 5, Tailwind, Axios, Capacitor 8 ·
SQL Server 2022 (`mcr.microsoft.com/mssql/server:2022-latest`, solo x86_64) ·
Docker Engine + Compose v2 · nginx · certbot · systemd.
