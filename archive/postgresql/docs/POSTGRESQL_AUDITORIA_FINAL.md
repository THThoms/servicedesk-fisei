# PostgreSQL — Auditoría final del repositorio (Fase N)

**Fecha:** 2026-09-15
**Alcance:** todo el árbol del proyecto en la copia local previa a Fase N.
**Motor activo hoy:** SQL Server 2022 (imagen `mcr.microsoft.com/mssql/server:2022-latest`).

Escrito para: el equipo del proyecto. Este documento inventaria todas
las apariciones de PostgreSQL en el repo, las clasifica y anota qué
acción tomar antes de retirar PG del runtime.

Fuentes buscadas: `postgres`, `postgresql`, `POSTGRES`, `5432`,
`pg_dump`, `psql`, `postgres-data`, `postgres:16`, `provider="postgresql"`,
`schema.pg`, `ILIKE`, `DATE_TRUNC`, `INTERVAL`, `::text`, `ARRAY[`,
`NOW()`, `pg-`.

## Clasificación

| Categoría | Descripción |
|---|---|
| **runtime** | Se ejecuta al arrancar el stack de producción o de desarrollo oficial. Debe eliminarse. |
| **desarrollo (legacy)** | Solo aparece en el compose antiguo o guías previas al cutover. Se marca como legacy y se retira del stack activo. |
| **tests** | Aparece en configuración de tests actuales. |
| **migración/rollback** | Necesario para leer o restaurar un dump PG histórico. Se conserva como documentación. |
| **documentación histórica** | Reportes de fases previas (E, F, G, H, J, K, L, M). Se conservan como archivo histórico. |

## Runtime — ninguna dependencia

El stack activo utiliza:

- **Local:** `docker-compose.mssql.yml` (no contiene `postgres`, solo la línea de comentario histórico "NO tocar producción. NO borrar postgres-data.").
- **Producción:** `docker-compose.prod-mssql.yml` (idem — un comentario histórico).
- Los 3 `Dockerfile.mssql` sobrescriben `prisma/schema.prisma` con
  `prisma/schema.mssql.prisma` (`provider = "sqlserver"`) antes de
  correr `prisma generate`, por lo que el runtime **nunca** compila
  Prisma con `provider = "postgresql"`.

Verificaciones:

```
$ grep -n "postgres|5432|POSTGRES" docker-compose.mssql.yml
20:# NO tocar producción. NO borrar postgres-data.        ← solo comentario

$ grep -n "postgres|5432|POSTGRES" docker-compose.prod-mssql.yml
9:# estabilidad (mínimo 7 días — ver docs/mssql/RETIRO_POSTGRESQL.md).
13:#   · No hay `postgres` service; en su lugar `mssql` con volumen /var/opt/mssql.

$ grep -n "cp .*schema" */Dockerfile.mssql
auth-service/Dockerfile.mssql:  cp prisma/schema.mssql.prisma prisma/schema.prisma
catalog-service/Dockerfile.mssql: idem
ticket-service/Dockerfile.mssql:  idem
```

## Legacy — compose y variables antiguas (usadas hasta Fase F)

| Archivo | Línea | Uso | Acción |
|---|---|---|---|
| `docker-compose.yml` | 14, 21–43, 64, 70, 99, 104, 124, 131–133 | Compose PG original (imagen `postgres:16-alpine`, volumen `postgres-data`, `DATABASE_URL=postgresql://…`). | Renombrar a `docker-compose.legacy-pg.yml` y anteponer un banner *"LEGACY, no ejecutar"*. **No borrar** (evidencia histórica). |
| `.env.example` | 9–12, 29–30, 31 | Bloque `POSTGRES_*` + `DATABASE_URL=postgresql://…` para los 3 servicios. | Reemplazar por bloque MSSQL (referenciando `.env.mssql.example`). |
| `README.md` | 170, 223, 256, 408 | Instrucciones de instalación PG local + diagrama con caja "PostgreSQL :5432". | Rebridar sección "Instalación local" a MSSQL. |
| `scripts/init-multi-db.sh` | 5, 16, 23 | Script `psql` que crea `auth_db`, `catalog_db`, `ticket_db` en el contenedor postgres. Solo se llamaba desde `docker-compose.yml` (el legacy). | Renombrar a `scripts/legacy/init-multi-db.sh` con banner LEGACY. |
| `catalog-service/prisma/schema.prisma` | 11 | `provider = "postgresql"` — origen del cutover, se sobrescribe en `Dockerfile.mssql`. | Documentar como *"solo se usa en dev PG"*. Alternativa recomendada: apuntar el archivo activo al `.mssql.prisma` y renombrar el PG a `.pg.legacy.prisma`. |
| `auth-service/prisma/schema.prisma` | 12 | idem | idem |
| `ticket-service/prisma/schema.prisma` | 13 | idem | idem |
| `ticket-service/scripts/seedHistoricalTickets.js` | 70–75 | Script PG-only ya documentado como legacy en `ticket-service/scripts/LEGACY_README.md`. | Sin cambios (ya documentado como legacy). |

## Referencias en comentarios (no son runtime)

- `ticket-service/src/routes/adminRoutes.ts:290–296` — comentarios que
  explican la migración `EXTRACT(EPOCH …) → DATEDIFF_BIG`,
  `NOW()-INTERVAL '30 days' → DATEADD`, etc. **El código real es
  T-SQL.** Solo son comentarios explicativos.
- `ticket-service/src/routes/adminRoutes.ts:213` — comentario sobre
  `@P1`, `@P2` de `$queryRawUnsafe` (T-SQL).

Estas referencias no representan dependencia de PG y **no requieren
cambio** para retirar el runtime.

## Documentación histórica (conservar)

Los siguientes reportes de fases previas mencionan PG porque narran la
migración. Se conservan como archivo histórico. **No se editan**.

- `docs/mssql/RETIRO_POSTGRESQL.md` (plan de decomiso)
- `docs/mssql/GUIA_OFICIAL_MSSQL.md`
- `docs/mssql-uta/PLAN_CAMBIO_PRODUCCION.md`
- `FASE_E_REPORTE.md`, `FASE_F_REPORTE.md`,
  `FASE_F_MIGRACION_DEFINITIVA_MSSQL.md`,
  `FASE_G_REPORTE_SWITCH_VPS_MSSQL.md`,
  `FASE_H_REPORTE_ESTABILIDAD_MSSQL.md`,
  `FASE_J_REPORTE_E2E.md`,
  `FASE_K_REPORTE_DEPLOY_VPS.md`,
  `FASE_L_DIAGNOSTICO_IMAGENES.md`,
  `FASE_M_REPORTE_DEPLOY_IMAGENES.md`
- `ticket-service/scripts/LEGACY_README.md`

## Resumen ejecutivo

- **Runtime PG activo hoy:** cero (ambos compose activos son MSSQL).
- **Legacy PG en repo:** 7 archivos (compose antiguo, `.env.example`,
  README, `init-multi-db.sh`, 3 `schema.prisma`) — todos con acción
  concreta arriba.
- **PG en producción (VPS):** contenedor `sd-postgres` en pie sin uso
  por servicios (mantenido como rollback desde Fase G — 8 días).
- **PG en local:** depende del entorno del operador; se hará backup
  final antes de tocar cualquier volumen local.

Con esta auditoría cerrada, se procede a los prechecks del VPS (Fase N
parte H) y al backup final PG antes de destruir nada.
