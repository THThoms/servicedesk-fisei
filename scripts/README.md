# scripts/

| Script | Uso | Dónde se ejecuta |
|---|---|---|
| `install-server.sh` | Instalador del servidor nuevo (`--mode clean` / `--mode restore`, `--dry-run`, `--generate-secrets`, `--nginx-tls`) | Servidor, como root |
| `backup-mssql.sh` | Backup de las 3 bases (CHECKSUM, VERIFYONLY, SHA-256) + imágenes + configuración, `manifest.json`, envío cifrado a Restic y estado | Servidor (systemd) |
| `backup/restic-*.sh` | Restic sobre S3/B2: `init`, `test-connection`, `backup`, `check`, `retention`, `restore`, `keys` | Servidor |
| `backup/restore-drill.sh` | Restauración de prueba verificada (bases `*_restore_verify`, conteos, relaciones, imágenes) | Servidor (systemd, mensual) |
| `lib/backup.sh` | Funciones comunes de Restic (contenedor fijado, clasificación de errores, conteos) | — |
| `restore-mssql.sh` | Restauración desde `.bak` con verificación, DBCC CHECKDB y re-mapeo de logins | Servidor |
| `build-server-package.sh` | Genera `release/servicedesk-uta-server-<versión>.tar.gz` + SHA-256 + MANIFEST | Equipo de desarrollo |
| `operations/smoke-server.sh` | Smoke post-instalación con curl (incluye que los bypass de login den 404) | Servidor |
| `operations/manage-user.sh` | Crear usuarios y asignar roles (la app no tiene UI para esto) | Servidor |
| `operations/check-backup.sh` | Verifica que el último backup local y el último snapshot externo sean correctos y recientes | Servidor (systemd) |
| `operations/alert.sh` | Alerta de fallo (journal, log y correo opcional) | Servidor (systemd) |
| `testing/smoke-e2e.mjs` | E2E funcional completo con login local (Node 20+) | Cualquier equipo con acceso al gateway |
| `testing/new-server-simulation.sh` | Simula un servidor nuevo en local: paquete → limpio → nginx/TLS → E2E → backup → restore | Equipo de desarrollo con Docker |
| `testing/backup-dr-simulation.sh` | Fase S: Restic + MinIO local → backup, cifrado, retención, manipulación, custodia, drill y recuperación completa en otro proyecto | Equipo de desarrollo con Docker |
| `lib/common.sh` | Funciones compartidas (lectura segura del `.env`, compose, sqlcmd en contenedor) | — |
| `init-mssql-lab.sh` / `.sql` | Bootstrap de SQL Server para `compose.yaml` (lab) y `docker-compose.prod-mssql.yml` (VPS actual) | Contenedor `mssql-init` |
| `legacy/` | Utilidades antiguas sin uso (`init-db.sh`, `verificar_proyecto.bat`) | — |

Reglas comunes: ningún script imprime secretos ni lee el `.env` completo con
`source`; las contraseñas de SQL Server se usan **dentro** del contenedor; ningún
script borra volúmenes de producción.
