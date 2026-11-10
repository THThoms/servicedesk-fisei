# Backups de ServiceDesk UTA (SQL Server 2022 + Restic cifrado)

Escrito para: el operador del servidor de ServiceDesk.

Relacionados: [configuración de Backblaze B2](CONFIGURACION_BACKBLAZE.md) · [custodia de la clave](CUSTODIA_CLAVE_BACKUPS.md) · [retención](RETENCION_BACKUPS.md) · [alertas](ALERTAS_BACKUPS.md) · [restaurar en un servidor nuevo](RESTAURACION_SERVIDOR_NUEVO.md) · [restaurar en el mismo servidor y rollback](RESTAURACION_Y_ROLLBACK.md)

> **Estado (Fase S, 2026-11-04):** probado de punta a punta en laboratorio con MinIO (S3 local). **Todavía no hay copia externa real**: falta crear el bucket de Backblaze B2 y configurar sus credenciales. Hasta entonces cada backup termina con código 3 y dispara la alerta.

## 1. Qué se protege y cómo

```text
SQL Server ─► BACKUP DATABASE auth_db, catalog_db, ticket_db  WITH CHECKSUM
           ─► archivo existe y tamaño > 0 ─► RESTORE VERIFYONLY WITH CHECKSUM ─► SHA-256
           ─► conteos de 13 tablas + 14 comprobaciones de relaciones
imágenes   ─► lista SHA-256 de cada archivo del volumen real (/app/uploads)
config     ─► .env del servidor, compose, nginx, systemd, daemon.json, parámetros SQL
           ─► manifest.json ─► SHA256SUMS
           ─► RESTIC (cifra en el servidor: AES-256 + Poly1305) ─► Backblaze B2 (S3, TLS)
           ─► verificación del snapshot leyendo del repositorio
```

| Elemento | Dónde queda | Verificación |
|---|---|---|
| `auth_db`, `catalog_db`, `ticket_db` | `.bak` en el conjunto local + snapshot cifrado | `CHECKSUM` + `RESTORE VERIFYONLY` + SHA-256; el snapshot se relee y se compara |
| Imágenes adjuntas | **Solo** en el snapshot cifrado. Restic lee el volumen real en solo lectura y deduplica: una imagen se sube una sola vez | `uploads.sha256` (huella de cada archivo) + recuento en el snapshot |
| Configuración necesaria | **Solo** en el snapshot cifrado (`config/`). En el disco local se borra al terminar | `config/SHA256SUMS` |
| Conteos y relaciones | `counts.txt` | El restore drill los compara |

Los tres `.bak` de una ejecución comparten un **ID** (`sd-<fecha UTC>-<aleatorio>`). Si una de las tres bases falla, el conjunto se marca `.failed` y **no** se sube.

**Qué NO se respalda, y por qué:**

| Elemento | Motivo |
|---|---|
| Claves SSH | Se generan de nuevo en el servidor nuevo |
| `/etc/letsencrypt` | El certificado se vuelve a emitir con certbot |
| `/etc/servicedesk/backup.env` y la clave Restic | Viven fuera del servidor (custodia). Meterlos dentro del propio repositorio no sirve para abrirlo |
| `.initial-admin-secret` y contraseñas temporales | Son de un solo uso |

## 2. Archivos

```text
/var/backups/servicedesk/                    (700, root)
├── sets/sd-20261105T031500Z-a1b2/           conjunto local (últimos BACKUP_LOCAL_KEEP=3)
│   ├── db/auth_db-…bak  catalog_db-…bak  ticket_db-…bak
│   ├── manifest.json  counts.txt  uploads.sha256  SHA256SUMS
│   ├── offsite-status                       snapshot Restic de este conjunto
│   └── .complete                            (o .failed)
├── last-status          último backup:  status=OK|NO_OFFSITE|FAILED · code=… · backup_id=…
├── last-restic-check    última verificación del repositorio
├── last-retention       última retención
├── last-drill           último restore drill
└── drills/drill-<UTC>.json                  informes del restore drill
```

`manifest.json` contiene: `backupId`, fechas UTC, duración, versión de la aplicación y de SQL Server, y por cada base su tamaño, SHA-256, `verifyOnly` y duración. También conteos, imágenes (número, bytes y origen del volumen), adjuntos (filas sin archivo y archivos huérfanos) y el estado final. **No contiene** contraseñas, JWT, tokens FCM, claves ni cadenas de conexión: lo comprueba la simulación.

## 3. Configuración

| Archivo | Contenido |
|---|---|
| `deploy/server/.env` | `BACKUP_DIR`, `BACKUP_LOCAL_KEEP` (3), `BACKUP_REQUIRE_OFFSITE` (true), `DRILL_MODE`, `BACKUP_ALERT_EMAIL`, `BACKUP_ALERT_WEBHOOK_URL` |
| `/etc/servicedesk/backup.env` (600, root) | Repositorio, credenciales S3 limitadas al bucket, ruta de la clave Restic, imagen de Restic, retención, latido externo. Plantilla: `deploy/backup/backup.env.example`. Guía: [CONFIGURACION_BACKBLAZE.md](CONFIGURACION_BACKBLAZE.md) |
| `/etc/servicedesk/restic.pass` (600, root) | Clave de cifrado del servidor. Ver [CUSTODIA_CLAVE_BACKUPS.md](CUSTODIA_CLAVE_BACKUPS.md) |

Restic se ejecuta en un contenedor efímero de la imagen oficial **fijada** (`restic/restic:0.18.0`), así que la versión es la misma en el backup, la restauración y las pruebas. No hace falta instalar Restic en el host. Los secretos entran al contenedor por nombre de variable y por un archivo de solo lectura; nunca aparecen en la línea de comandos.

## 4. Automatización (systemd)

| Timer → servicio | Cuándo | Qué hace | Falla si… |
|---|---|---|---|
| `servicedesk-backup` | Diario 03:15 (+≤10 min) | `scripts/backup-mssql.sh` | falla cualquier base, VERIFYONLY, SHA-256, espacio, Restic o la verificación del snapshot; o no hay copia externa |
| `servicedesk-backup-check` | Cada 6 h (00:30, 06:30…) | `scripts/operations/check-backup.sh` | el último conjunto tiene más de 26 h, su SHA-256 no cuadra, el último backup falló, o el repositorio externo no tiene un snapshot de menos de 26 h |
| `servicedesk-backup-retention` | Domingo 04:30 | `restic-retention.sh --prune` | el repositorio no está íntegro, no hay un snapshot reciente y completo, o algo sale mal al aplicar |
| `servicedesk-backup-verify` | Domingo 05:30 | `restic-check.sh`: estructura + lectura del 5 % de los datos | el repositorio tiene errores |
| `servicedesk-restore-drill` | Día 1 de cada mes, 06:00 | `restore-drill.sh` | la restauración de prueba no reproduce las bases, los conteos, las relaciones o las imágenes |
| `servicedesk-alert@` | Al fallar cualquiera (`OnFailure=`) | `scripts/operations/alert.sh` | — |

Todos los timers usan `Persistent=true`: si el servidor estaba apagado a esa hora, la tarea se ejecuta al arrancar. Los instala `scripts/install-server.sh`.

## 5. Operación

```bash
cd /opt/servicedesk
sudo systemctl start servicedesk-backup.service             # backup ahora
sudo journalctl -u servicedesk-backup -n 60 --no-pager      # resultado
sudo cat /var/backups/servicedesk/last-status
sudo scripts/operations/check-backup.sh                     # 0 OK · 1 fallo · 3 sin copia externa
sudo scripts/backup/restic-test-connection.sh               # diagnóstico del repositorio externo
sudo scripts/backup/restic-restore.sh --list                # snapshots disponibles
sudo scripts/backup/restore-drill.sh                        # restauración de prueba ahora
systemctl list-timers 'servicedesk-*'
```

Códigos de salida de `backup-mssql.sh`:

| Código | Significado |
|---|---|
| `0` | Conjunto local verificado y snapshot cifrado verificado |
| `1` | Fallo de backup o de verificación local; el conjunto **no** es válido |
| `3` | Conjunto local correcto, pero **sin repositorio externo configurado** |
| `4` | Conjunto local correcto, pero **falló la copia externa** |

Los códigos 3 y 4 disparan la alerta a propósito: un backup que solo está en el mismo disco no protege ante la pérdida del servidor.

## 6. Espacio

- **Disco local:** 3 conjuntos × tamaño de los `.bak`. Las imágenes no se copian al disco local. Antes de cada backup se comprueba que haya espacio libre de al menos el tamaño de las bases +20 % +100 MB, tanto en el volumen de SQL Server como en `BACKUP_DIR`; si no, falla con `E_NO_SPACE`.
- **Bucket:** cada backup diario sube solo lo que cambió, y las imágenes una sola vez.
- **Compresión (`BACKUP_SQL_COMPRESSION=auto`):** con repositorio externo, SQL Server **no** comprime los `.bak` y Restic los comprime y deduplica antes de cifrar. Un `.bak` comprimido por SQL Server cambia entero cada día y no se puede deduplicar. Medido en el laboratorio (bases de unos 19 MB sin comprimir):

  | Modo | Primer backup (subido) | Cada backup posterior |
  |---|---|---|
  | Con compresión de SQL Server | 2,1 MB | 2,1 MB (sin deduplicación) |
  | Sin compresión de SQL Server (`auto`) | 1,4 MB | **0,4 MB** |

  Sin repositorio externo, `auto` sí comprime, para ahorrar disco local. La edición Express nunca comprime.

## 7. Instalaciones heredadas

`backup-mssql.sh` también funciona sobre una instalación anterior, indicando sus contenedores y su `.env` con `MSSQL_CONTAINER`, `TICKET_CONTAINER` y `SD_ENV_FILE`. Hazlo solo con autorización sobre ese servidor.
