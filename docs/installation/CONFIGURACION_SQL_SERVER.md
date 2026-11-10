# SQL Server 2022 en el servidor nuevo

Escrito para: el administrador del servidor y quien decida la licencia de SQL Server.

SQL Server 2022 es el **único** motor de base de datos. PostgreSQL está retirado.

## 1. Edición: pruebas y producción

| Uso | `SERVER_PURPOSE` | `MSSQL_PID` | Comentario |
|---|---|---|---|
| **Primera instalación (pruebas)** | `pruebas` | `Developer` | Edición completa y gratuita, con licencia **solo para desarrollo, evaluación y pruebas**. **No es válida para producción.** El instalador y `server-health.sh` lo recuerdan |
| Producción con bases < 10 GB | `produccion` | `Express` | Gratuita. Límites: 10 GB por base, ≈ 1,4 GB de *buffer pool*, 4 núcleos |
| Producción con licencia de la UTA | `produccion` | `Standard`, `Enterprise` o la clave | Según la licencia que aporte la UTA |
| — | cualquiera | `Evaluation` | **Bloqueada**: caduca a los 180 días |

Con `SERVER_PURPOSE=produccion`, el instalador **bloquea** Developer y Evaluation. Después de arrancar, compara la edición real (`SERVERPROPERTY('Edition')`) con la pedida.

**Pasar de pruebas a producción** (el código de los microservicios no cambia):
1. Haz un backup y, si el servidor de pruebas tenía datos reales, decide si se conservan.
2. En `deploy/server/.env`: `MSSQL_PID=Express` (u otra) y `SERVER_PURPOSE=produccion`.
3. `docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env up -d mssql`. El contenedor se recrea con la edición nueva sobre los **mismos** volúmenes.
4. `scripts/operations/server-health.sh` debe mostrar la edición nueva.

Pasar de Developer a Express **solo funciona** si ninguna base supera los 10 GB y no se usan funciones exclusivas de ediciones superiores; ServiceDesk no las usa. Probado en la simulación: backup en Developer y restauración en Express.

## 2. Imagen

`mcr.microsoft.com/mssql/server:2022-CU27-GDR1-ubuntu-22.04@sha256:cf8f0ab2…1718` (16.0.4305.5).

- Fijada por versión **y** por *digest*, para que la instalación sea reproducible.
- Es exactamente la imagen probada en el laboratorio y en las simulaciones.
- Para actualizar el CU, define `MSSQL_IMAGE` en el `.env`, con backup previo y prueba en un servidor de pruebas.

## 3. Parámetros

| Parámetro | Valor | Dónde |
|---|---|---|
| Collation | `SQL_Latin1_General_CP1_CI_AS` | `MSSQL_COLLATION` (compose) |
| Memoria del motor | 2048 MB | `MSSQL_MEMORY_LIMIT_MB`. Con Express el *buffer pool* no pasa de ≈ 1,4 GB |
| Memoria del contenedor | 3 GiB | `MSSQL_CONTAINER_MEMORY` |
| CPU del contenedor | 2 | `MSSQL_CPUS` |
| SQL Agent | Desactivado | Los backups los hace systemd y no se necesita |
| Recovery model | **SIMPLE** en las 3 bases | `mssql-init`. RPO del backup diario: 24 h |
| Usuario del proceso | `mssql` (uid 10001), **sin root** | Imagen + `mssql-volumes` |
| Reinicio | `unless-stopped`, parada ordenada de 60 s | Compose |
| Healthcheck | `sqlcmd SELECT 1` cada 10 s | Compose |
| Puerto | 1433 **sin publicar**; solo en la red interna `data` | Compose |

## 4. Bases y logins

`mssql-init` es idempotente:
1. Crea `auth_db`, `catalog_db` y `ticket_db`, cada una con su login `auth_user`, `catalog_user` o `ticket_user`.
2. Da a cada login permisos **solo sobre su base**.
3. Sincroniza las contraseñas con el `.env`.
4. Remapea los usuarios huérfanos tras un `RESTORE`.
5. Aplica RECOVERY SIMPLE.

`sa` solo se usa para la administración (init, backup, restore) y **dentro** del contenedor. La aplicación nunca lo usa.

## 5. Almacenamiento

| Ruta | Volumen | Contenido |
|---|---|---|
| `/var/opt/mssql` | `mssql-system` | Configuración, secrets, errorlog |
| `/var/opt/mssql/data` | `mssql-data` | `.mdf` (`MSSQL_DATA_DIR`) |
| `/var/opt/mssql/tlog` | `mssql-tlog` | `.ldf` (`MSSQL_LOG_DIR`) |
| `/var/opt/mssql/backup` | `mssql-backup` | `.bak` temporales (`MSSQL_BACKUP_DIR`) |

`mssql-volumes` fija el propietario 10001 y los permisos 770 antes de cada arranque. Sin ese paso, SQL Server no podía usar subvolúmenes y fallaba con "Access is denied". Comprobado: `.mdf` en `data/`, `.ldf` en `tlog/`, `.bak` en `backup/` y el proceso sin root.

## 6. Recuperación

- **Backup y restauración:** [BACKUPS_MSSQL.md](../operations/BACKUPS_MSSQL.md) y [RECUPERACION_SERVIDOR.md](RECUPERACION_SERVIDOR.md).
- **Restauración de un `.bak`:** `restore-mssql.sh` lee del propio SQL Server las rutas de datos y log, así que los archivos van a los volúmenes correctos.
- **Contenedor dañado:** `docker compose … up -d --force-recreate mssql`. Los volúmenes persisten.
- **Base dañada:** `DBCC CHECKDB` y restauración del último snapshot (`restic-restore.sh` + `restore-mssql.sh --replace`).
