# ServiceDesk UTA

**Sistema institucional de gestión de tickets de soporte técnico** de la Facultad de
Ingeniería en Sistemas, Electrónica e Industrial (FISEI) de la Universidad Técnica
de Ambato. Cubre el flujo completo: reporte, enrutamiento por área, aceptación,
contribuciones, reescalamiento, resolución con base de conocimiento, validación
por el solicitante, historial auditable, imágenes adjuntas, estadísticas,
notificaciones por correo y push, Microsoft SSO y app Android.

![Node](https://img.shields.io/badge/Node.js-20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748)
![SQL Server](https://img.shields.io/badge/SQL%20Server-2022-CC2927)
![React](https://img.shields.io/badge/React-18.3-61DAFB)
![Capacitor](https://img.shields.io/badge/Capacitor-8-119EFF)
![Tests](https://img.shields.io/badge/Tests-372%2F372-brightgreen)

| Perfil | Qué hace |
|---|---|
| Usuario solicitante | Crea tickets con imágenes, sigue su estado, acepta o rechaza la solución propuesta |
| Técnico (`technician`, área Técnicos) | Bandeja de su área, aceptar, contribuir, reescalar, resolver con KB |
| DTIC (`dtic`, área DTIC) | Lo mismo para el área DTIC (no es administrador) |
| Administrador | Asignación directa, estadísticas, historial general, reportes por técnico y por bloque, técnicos por bloque, catálogo, KB y ubicaciones |

---

## Arquitectura

```text
Navegador / APK Android ─HTTPS─► nginx ─► frontend (React SPA)
                                    └──► api-gateway ─► auth-service    ─┐
                                                     ├► catalog-service ─┼─► SQL Server 2022
                                                     └► ticket-service  ─┘   (auth_db · catalog_db · ticket_db)
```

- **SQL Server 2022 es el único motor.** PostgreSQL se retiró en la Fase N; sus restos están en [archive/postgresql/](archive/postgresql/) y no deben usarse.
- Cada microservicio tiene su propia base y su propio login (mínimo privilegio).
- Las imágenes se sirven solo por `GET /api/tickets/:id/attachments/:aid`, con JWT.

Detalle completo: [docs/architecture/ARQUITECTURA_SERVICEDESK.md](docs/architecture/ARQUITECTURA_SERVICEDESK.md).

| Componente | Tecnología |
|---|---|
| Backend | Node 20 · Express · TypeScript · Prisma 5 (`sqlserver`) · Zod · JWT · bcryptjs · multer · nodemailer · firebase-admin |
| Frontend | React 18 · Vite 5 · Tailwind · Axios · Capacitor 8 (Android `ec.uta.servicedesk`) |
| Infraestructura | Docker + Compose v2 · nginx · certbot · systemd · SQL Server 2022 (x86_64) |

---

## Levantar en local (laboratorio)

Requisitos: Docker Desktop o Engine con Compose v2, y Node 20 (para los tests).

```bash
cp .env.example .env.mssql          # rellena MSSQL_SA_PASSWORD, *_DB_PASSWORD y JWT_SECRET
#   para el laboratorio: AUTH_DEV_LOGIN=true, AUTH_MICROSOFT_SIMULATE=true, SEED_DEMO_USERS=true
docker compose --env-file .env.mssql up -d --build
docker compose --env-file .env.mssql ps        # 6 servicios healthy
```

| URL | Servicio |
|---|---|
| http://localhost:13000 | Frontend |
| http://localhost:18080 | API Gateway |
| 127.0.0.1:14330 | SQL Server (Developer, solo laboratorio) |

- En el laboratorio, el auth-service corre con `NODE_ENV=development`, lo que permite dev-login, login Microsoft simulado y cuentas demo. Las cuentas de prueba se definen en `auth-service/prisma/seed.demo.ts`, fuera de Git; la plantilla es `seed.demo.example.ts`. **En producción esos mecanismos quedan bloqueados en código.**
- Para detener: `docker compose --env-file .env.mssql down`. **Nunca** `down -v`, que borra la base de datos.

## Pruebas

```bash
cd auth-service    && npm test     # 57 tests
cd catalog-service && npm test     # 67 tests
cd ticket-service  && npm test     # 242 tests
cd frontend        && npm test     # 6 tests (reglas de compresión de imágenes)
cd <servicio> && npx tsc --noEmit && npx prisma validate
cd frontend && npm run build       # tsc -b + vite build
```

E2E contra un stack en marcha: [scripts/testing/smoke-e2e.mjs](scripts/testing/smoke-e2e.mjs).
Simulación completa de un servidor nuevo (paquete → instalación limpia → nginx/TLS → E2E → backup → restauración):

```bash
bash scripts/testing/new-server-simulation.sh          # y luego: --cleanup
```

## App Android

```bash
cd frontend
VITE_API_URL=https://<dominio-del-servidor> npm run build
npx cap sync android
cd android && ./gradlew assembleDebug     # app/build/outputs/apk/debug/app-debug.apk
```

`google-services.json` (Firebase) va en `frontend/android/app/` y **no** se versiona.
Las credenciales FCM solo viven en el backend.

## Instalar en un servidor

```bash
scripts/build-server-package.sh 1.0.0     # → release/servicedesk-uta-server-1.0.0.tar.gz (+ .sha256, MANIFEST)
```

Guía paso a paso: **[docs/installation/INSTALACION_SERVIDOR_NUEVO.md](docs/installation/INSTALACION_SERVIDOR_NUEVO.md)**.
Requisitos: [REQUISITOS_NUEVO_SERVIDOR.md](docs/installation/REQUISITOS_NUEVO_SERVIDOR.md) · Configuración: [CONFIGURACION_PRODUCCION.md](docs/installation/CONFIGURACION_PRODUCCION.md) · Seguridad: [SEGURIDAD_SERVIDOR.md](docs/installation/SEGURIDAD_SERVIDOR.md)

---

## Estructura del repositorio

```text
api-gateway/  auth-service/  catalog-service/  ticket-service/  frontend/   ← código (cada uno con su Dockerfile)
deploy/        server/compose.yaml, mssql-init/, nginx/, systemd/            ← instalación en servidor
scripts/       install-server, backup/restore, build-server-package, operations/, testing/, lib/
docs/          architecture/ installation/ operations/ troubleshooting/
archive/       postgresql/  (histórico, NO ejecutar)
backups/       copias locales históricas (ignorado por Git)
compose.yaml                   ← laboratorio local
docker-compose.prod-mssql.yml  ← compose del VPS ACTUAL (no modificar; se retira tras migrar)
.env.example                   ← plantilla única de configuración
```

- Operación: [backups](docs/operations/BACKUPS_MSSQL.md) · [Backblaze B2](docs/operations/CONFIGURACION_BACKBLAZE.md) · [custodia de la clave](docs/operations/CUSTODIA_CLAVE_BACKUPS.md) · [recuperar en servidor nuevo](docs/operations/RESTAURACION_SERVIDOR_NUEVO.md) · [restauración y rollback](docs/operations/RESTAURACION_Y_ROLLBACK.md) · [usuarios y roles](docs/operations/GESTION_USUARIOS.md) · [problemas frecuentes](docs/troubleshooting/PROBLEMAS_FRECUENTES.md)
- La documentación interna del proyecto (historial de fases y auditorías) se conserva fuera de este repositorio.

## Reglas del proyecto

1. SQL Server es el único motor; no reintroducir PostgreSQL.
2. El frontend solo habla con el API Gateway.
3. Imágenes por endpoint autenticado, nunca `/uploads/` ni Base64.
4. Solo el propietario valida la solución (aceptar → `cerrado`; rechazar exige motivo); el historial no se sobrescribe.
5. Roles `admin`, `technician`, `dtic` y `user`; áreas `TECHNICIANS` y `DTIC` (no `GENERAL`); un técnico solo accede a tickets de su área. Toda autorización se valida en el backend.
6. Nunca commitear `.env`, credenciales ni `google-services.json`.

---

## Historias de usuario

- **Sprint 1** — HU-01 a HU-05: roles, autenticación y creación de tickets.
- **Sprint 2** — HU-06 a HU-11: enrutamiento por área, panel técnico, escalamiento, historial, base de conocimiento y estadísticas.
- **Sprint 3** — HU-12 a HU-16: filtros por fecha, seguridad de contraseñas (bcrypt), impresión del historial, notificaciones por correo (outbox) y reporte por técnico.
- **Posteriores (fases I–P)** — validación de la solución por el usuario, imágenes autenticadas (web y Android), push FCM, migración a SQL Server, instalador y paquete de servidor.

## Autor y contribución

**Autor principal:** Tomás Solís (Tech Lead FISEI-UTA) — [@THThoms](https://github.com/THThoms).
Proyecto académico de la asignatura **Metodologías Ágiles** (cuarto semestre, FISEI-UTA).

1. Rama desde `Develop`: `git checkout -b feat/mi-cambio`.
2. Commits en español con el estilo Conventional Commits (`feat(alcance): …`, `fix(alcance): …`).
3. Antes del PR: tests verdes, `npx tsc --noEmit` limpio, sin `.env` ni credenciales.
4. PR contra `Develop`. `main` se actualiza al cerrar cada sprint.

## Licencia

Licencia académica interna de la Universidad Técnica de Ambato — FISEI. Uso restringido a fines educativos y demostrativos.
Copyright © 2026 Universidad Técnica de Ambato · FISEI · ServiceDesk Institucional.
