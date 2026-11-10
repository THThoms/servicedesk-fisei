# PostgreSQL — retirada definitiva del runtime

**Fecha de retiro:** 2026-09-15
**Fases previas:** F (schema MSSQL) · G (VPS cutover MSSQL) · H
(estabilización) · J (E2E) · K (deploy VPS) · L/M (imágenes) · **N (esta)**.
**Efecto:** SQL Server 2022 queda como motor único; ningún servicio de
aplicación depende de PostgreSQL para arrancar o correr.

Escrito para: el equipo del proyecto y cualquier operador que necesite
saber si aún se puede recuperar información de PG y cómo.

## Motivo

Tras 8 días de estabilidad post-cutover en el VPS (Fases G–M sin
incidentes), la instancia PG solo funcionaba como red de seguridad
"por si acaso". Al haberse validado repetidamente que:

- Los tres servicios (`auth`, `catalog`, `ticket`) tienen
  `DATABASE_URL` apuntando a `sqlserver://mssql:1433;…`.
- 0 conexiones de aplicación a `:5432`.
- Backups MSSQL diarios con `RESTORE VERIFYONLY` y drill exitoso.
- Toda la funcionalidad crítica (login, tickets, historial, imágenes,
  reescalamiento, FCM/Email/SSO) opera sobre SQL Server.

… mantener PG activo dejó de ser una salvaguarda y pasó a ser deuda
técnica: consumía memoria/disco, exponía superficie extra y confundía
la documentación oficial.

## Estado antes del retiro

- **VPS:** `sd-postgres` (`postgres:16-alpine`) corriendo con volumen
  `servicedesk-uta_postgres-data`, sin conexiones de aplicación
  establecidas (verificado con `ss -tn` en los 3 services).
- **Local:** `sd-postgres` levantado por el compose legacy con datos
  de desarrollo (11 usuarios, 13 servicios, 33 artículos KB,
  99 tickets sintéticos, 0 adjuntos).

## Backup final (archivo histórico permanente)

### VPS
- Ubicación: `/root/backups/postgresql-final-retired/20260915T203658Z/`
- Permisos: `chmod 600 root:root` en cada archivo.
- Contenido:

| Archivo | Bytes | SHA-256 |
|---|---:|---|
| `auth_db.custom.dump` | 18139 | `b08181f42b2d4dcc8008a212d85dce0c85e72b4361397abb22033ca9eae7f8b1` |
| `catalog_db.custom.dump` | 16545 | `bb3aad80a2c691d939494003ef5aabfde25d684cf667b673452404756ef9de7c` |
| `ticket_db.custom.dump` | 22664 | `ff4105b84e9734e308d952da3a4696dfc3958c72892efec548ae6a3aa01eb413` |
| `auth_db.sql` | 45269 | `c6ff3056924571e3ab453edf8923e3e58c25a0593c1875bc71ffec6170b95b25` |
| `catalog_db.sql` | 24838 | `578360cbe49708d97b10a362fc1921577ddefaa2ca84aaf5328381de88e24188` |
| `ticket_db.sql` | 56112 | `4cd7637f3baedc57e426f254062aa572b16b899c7b95ba3d99edd756c26d9f33` |

`pg_restore -l` legible sobre los 3 custom dumps (TOC entries 26/29/47).

### Local (dev)
- Ubicación: `<repo>/backups/postgresql-final-retired-local-20260915T204733Z/`
- Contenido: 3 `.custom.dump` (50318 / 17841 / 46813 bytes) + 3 `.sql`
  (208001 / 28080 / 216248 bytes) + `SHA256SUMS.txt`.
- `pg_restore -l` legible sobre los 3 (TOC entries 26/29/40).
- Directorio bajo `backups/` que ya está en `.gitignore` — no se commitea.

## Estado MSSQL previo al retiro (evidencia de continuidad)

- `RESTORE VERIFYONLY` sobre los 3 `.bak` diarios más recientes:
  "The backup set on file 1 is valid" en los 3.
- Restore drill sobre bases `*_verify` distintas de producción:
  - `auth_db_verify` : `users = 16`
  - `catalog_db_verify` : `services = 8`, `locations = 23`, `knowledge = 28`
  - `ticket_db_verify` : `tickets = 13`, `ticket_events = 37`, `attachments = 7`, `email_outbox = 22`
- Contadores en producción (post retiro): idénticos, sin regresiones.

Ubicación de los `.bak` MSSQL diarios: `/var/backups/servicedesk-mssql/daily/`
en el host del VPS; también hay una copia canónica en
`/root/backups/mssql/20260915T203753Z/` (SHA-256 registrados
`d6a50de2…`, `a8037c3d…`, `14cf05d3…`).

## Operaciones ejecutadas para retirar

### VPS
```
docker stop sd-postgres
docker rm  sd-postgres
docker volume rm servicedesk-uta_postgres-data
sed -i '/^POSTGRES_/d' /opt/servicedesk-uta/.env.mssql       # tras backup .env.mssql.pre-fase-N-<TS>
```

Verificación:
- `docker ps` → sin `sd-postgres`.
- `docker volume ls` → sin `servicedesk-uta_postgres-data`.
- `docker compose --env-file .env.mssql -f docker-compose.prod-mssql.yml config | grep -iE "postgres|5432"` → 0 líneas.
- `docker compose ps` → los 6 servicios restantes healthy (excepto la
  flag heredada `unhealthy` de `sd-frontend` que corresponde al
  HEALTHCHECK preexistente del Dockerfile, no funcional; pendiente en
  fase posterior no bloqueante).

### Local
```
docker stop sd-postgres
docker rm  sd-postgres
docker volume rm servicedesk-microservices_postgres-data
```

Los volúmenes de otros proyectos en la misma máquina (`asistencia_*`,
`proyectosmetodologiascrum_*`, `trasnporte_*`) **no** se tocaron.

## Cambios en el repositorio

| Archivo | Antes | Después |
|---|---|---|
| `docker-compose.yml` | Compose PG activo | Renombrado a `docker-compose.legacy-pg.yml` con banner *"⛔ LEGACY — NO EJECUTAR"*. |
| `scripts/init-multi-db.sh` | Init PG | Movido a `scripts/legacy/init-multi-db.sh` con banner LEGACY. |
| `.env.example` | Bloque `POSTGRES_*` + `DATABASE_URL=postgresql://…` | Bloque MSSQL + comentarios explicativos. |
| `README.md` | "PostgreSQL :5432", "PostgreSQL local", `DATABASE_URL="postgresql://…"` para `prisma validate` | "SQL Server 2022 :1433", nota de retiro que apunta aquí, ejemplo `prisma validate` con `sqlserver://`. |
| `{auth,catalog,ticket}-service/prisma/schema.prisma` | `provider = "postgresql"` | Contenido del `schema.mssql.prisma` (sqlserver). El PG original quedó como `schema.pg.legacy.prisma`. |

Los reportes históricos (`FASE_E`..`FASE_M`), el plan
`docs/mssql-uta/PLAN_CAMBIO_PRODUCCION.md`, `docs/mssql/RETIRO_POSTGRESQL.md`
y `docs/mssql/GUIA_OFICIAL_MSSQL.md` se mantienen sin cambios como
archivo histórico.

## Cómo restaurar los dumps si fuera necesario (procedimiento de
emergencia)

Solo debería ejecutarse si alguna vez hiciera falta leer o auditar los
datos previos al cutover. **No** es un procedimiento de rollback: el
código actual (Prisma con `provider = "sqlserver"`) no puede correr
contra PG.

1. Levantar un contenedor `postgres:16-alpine` desechable:
   ```
   docker run -d --name pg-restore-emergencia \
     -e POSTGRES_PASSWORD=any \
     -v pg-restore-emergencia:/var/lib/postgresql/data \
     postgres:16-alpine
   ```
2. Copiar el archivo `<db>.custom.dump` al contenedor:
   ```
   docker cp /root/backups/postgresql-final-retired/20260915T203658Z/ticket_db.custom.dump \
     pg-restore-emergencia:/tmp/
   ```
3. Crear la base y restaurar:
   ```
   docker exec pg-restore-emergencia psql -U postgres -c 'CREATE DATABASE ticket_db_retired'
   docker exec pg-restore-emergencia pg_restore -U postgres -d ticket_db_retired /tmp/ticket_db.custom.dump
   ```
4. Consultar con `psql -U postgres -d ticket_db_retired`.
5. Al terminar, borrar el contenedor y el volumen para no dejar copias
   sueltas.

Los `SHA-256` listados arriba permiten confirmar la integridad de los
archivos antes de restaurar. Los `.sql` (dump plain-text) sirven para
inspección con `less/grep` sin necesidad de PG.

## Estado final verificado

- `docker ps` VPS: 6 servicios (mssql, auth, catalog, ticket, gateway,
  frontend), 0 postgres.
- `docker volume ls` VPS: 2 volúmenes del proyecto (`mssql-data`,
  `ticket-uploads`), 0 postgres.
- Contadores MSSQL post-retiro idénticos a pre-retiro
  (users=16, services=8, knowledge=28, tickets=13, attachments=7,
  events=37).
- Endpoint atacado por el navegador
  `GET /api/tickets/…/attachments/…` responde `200 image/jpeg` con
  bytes exactos.
- 293/293 tests locales verdes (Fase L/M mantenidos).

**PostgreSQL:** RETIRADO DEL RUNTIME.
**Backup histórico:** conservado, íntegro y verificable.
