# deploy/ — instalación en servidor (SQL Server 2022)

| Ruta | Contenido |
|---|---|
| `server/compose.yaml` | Compose de producción: mssql, mssql-init, auth, catalog, ticket, gateway, frontend. Redes `data` (interna), `app` y `edge`; puertos solo en 127.0.0.1 |
| `server/mssql-init/` | Bootstrap idempotente: 3 bases, 3 logins (sincroniza contraseñas), re-mapeo tras restore, RECOVERY SIMPLE |
| `server/.env` | **No versionado.** Se crea a partir de `../.env.example` |
| `nginx/servicedesk.conf.template` | nginx del host con TLS, cabeceras, límite de login y proxy `/api/` → gateway |
| `nginx/servicedesk-bootstrap-http.conf.template` | Config temporal para emitir el certificado (ACME) |
| `systemd/` | Timers de backup diario, verificación (6 h), retención y revisión (semanales), restore drill (mensual) y servicio de alerta |
| `backup/` | Plantilla de `/etc/servicedesk/backup.env` (Restic → Backblaze B2) |
| `backup-lab/` | **Solo pruebas**: MinIO S3 aislado para probar Restic (no va en el paquete del servidor) |

Guía paso a paso: [docs/installation/INSTALACION_SERVIDOR_NUEVO.md](../docs/installation/INSTALACION_SERVIDOR_NUEVO.md).
El VPS actual usa otro compose (`../docker-compose.prod-mssql.yml`), que no se modifica.
