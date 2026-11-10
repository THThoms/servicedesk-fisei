# ⛔ Archivo histórico de PostgreSQL — NO USAR PARA EJECUTAR SERVICEDESK

ServiceDesk UTA usa **únicamente SQL Server 2022**. PostgreSQL se retiró del
runtime local y del VPS en la Fase N (2026-09-15). Esta carpeta conserva los
artefactos de esa etapa solo como **referencia histórica y de auditoría**.

- Ningún compose, Dockerfile ni script vigente referencia esta carpeta.
- El instalador del servidor nuevo (`scripts/install-server.sh`) no la incluye
  y el paquete de `scripts/build-server-package.sh` la excluye.
- **No ejecutes** `docker-compose.legacy-pg.yml`: levantaría un stack obsoleto.

## Contenido

| Ruta | Qué era | Movido desde (Fase P) |
|---|---|---|
| `docker-compose.legacy-pg.yml` | Compose original con PostgreSQL 16 | `docker-compose.legacy-pg.yml` (antes `docker-compose.yml`) |
| `dockerfiles/<servicio>.Dockerfile` | Dockerfiles PG de auth/catalog/ticket | `<servicio>/Dockerfile` |
| `prisma/<servicio>.schema.pg.legacy.prisma` | Schemas Prisma con `provider = "postgresql"` | `<servicio>/prisma/schema.pg.legacy.prisma` |
| `scripts/init-multi-db.sh` | Creación de las 3 bases en PostgreSQL | `scripts/legacy/init-multi-db.sh` |
| `scripts/migrate-areas-*.sql` | Migración Sprint 3 (GENERAL→TECHNICIANS, TICS→DTIC) en sintaxis PostgreSQL (`ALTER TYPE`, `BEGIN;`) | `scripts/` |
| `docs/POSTGRESQL_RETIRADO.md` | Cómo consultar los dumps históricos | `docs/mssql/` |
| `docs/POSTGRESQL_AUDITORIA_FINAL.md` | Auditoría previa al retiro | `docs/mssql/` |

## Backups históricos de PostgreSQL

**No están en esta carpeta ni en Git.** Se conservan como archivo permanente:

- Local: `backups/postgresql-final-retired-local-20260915T204733Z/` (ignorado por Git)
- VPS: `/root/backups/postgresql-final-retired/20260915T203658Z/` (con SHA-256)

No borrarlos. Para consultarlos, restaurarlos en un PostgreSQL **temporal y
aislado** (ver `docs/POSTGRESQL_RETIRADO.md`), nunca en el entorno de la aplicación.

El historial de la migración (fases B–N) se conserva fuera de este repositorio.
