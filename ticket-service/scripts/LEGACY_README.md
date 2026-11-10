# Scripts legacy PostgreSQL

Este directorio contiene scripts que se conservan **por valor histórico y de
rollback**, pero que **NO forman parte del runtime SQL Server** (Sprint F).

## `seedHistoricalTickets.js`

Origen: Sprint 2 (rev). Genera un backfill sintético de ~100 tickets +
eventos usando SQL **PostgreSQL-only** (`::text`, `::uuid`, `ANY`, `NOW()`,
`INTERVAL`, `ARRAY[...]`).

- **No se ejecuta** durante el arranque de los servicios.
- **No se llama** desde ningún Dockerfile ni script de CI.
- Sólo el operador puede lanzarlo a mano contra una instancia PostgreSQL de
  desarrollo local (`node ticket-service/scripts/seedHistoricalTickets.js`).
- **Contra SQL Server fallará** — está intencionalmente marcado como PG-only.

## Cuándo reescribirlo a T-SQL

Si en el futuro necesitamos poblar el ticket_db con datos sintéticos para
benchmarks o demos:
- Reescribir con Prisma (usando el cliente MSSQL) o con `sqlcmd + INSERT`.
- Reemplazar `NOW() - INTERVAL '15 days'` por `DATEADD(DAY, -15, SYSUTCDATETIME())`.
- Reemplazar `id::text` por `CAST(id AS varchar(36))`.
- Ver el patrón en `ticket-service/src/routes/adminRoutes.ts:275-330`.

## Cuándo eliminarlo

Cuando se retire definitivamente PostgreSQL (Etapa 4 del plan de retiro —
ver `docs/mssql/RETIRO_POSTGRESQL.md`), este directorio y su contenido
pueden borrarse sin impacto en el runtime.
