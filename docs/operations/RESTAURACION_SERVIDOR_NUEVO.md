# Recuperar ServiceDesk en un servidor nuevo (pérdida total del servidor)

Escrito para: el administrador que reconstruye el servicio cuando el servidor original ya no existe o no es accesible.

**No depende del servidor original.** Necesitas solo:

1. El **paquete de instalación**: `servicedesk-uta-server-<versión>.tar.gz`, del repositorio Git o de la copia guardada de la última versión.
2. Acceso a la **consola de Backblaze**, para crear una Application Key nueva si la anterior estaba en el servidor perdido.
3. **Una clave Restic** válida: la copia del responsable principal o la clave del custodio de recuperación ([CUSTODIA_CLAVE_BACKUPS.md](CUSTODIA_CLAVE_BACKUPS.md)).

Para restaurar sobre el **mismo** servidor o hacer rollback de una actualización, usa [RESTAURACION_Y_ROLLBACK.md](RESTAURACION_Y_ROLLBACK.md).

> Este procedimiento se ejecutó completo en la simulación de la Fase S, con MinIO en lugar de B2. El servidor nuevo usó **solo** el paquete, las credenciales S3 y la **clave del custodio**, y recuperó las 3 bases, las imágenes y la configuración. Login, tickets, historial e imágenes funcionaron. El RTO medido en el laboratorio está en el reporte de la Fase S.

## A. Preparar el servidor

**1. Sistema operativo.** Ubuntu Server 24.04 LTS x86_64 (SQL Server 2022 no tiene imagen ARM). Requisitos en [REQUISITOS_NUEVO_SERVIDOR.md](../installation/REQUISITOS_NUEVO_SERVIDOR.md).

**2. Docker.** Docker Engine + plugin compose (paso 2 de [INSTALACION_SERVIDOR_NUEVO.md](../installation/INSTALACION_SERVIDOR_NUEVO.md)).

**3. SQL Server con edición compatible.** No se instala aparte: lo levanta el instalador en un contenedor. Elige `MSSQL_PID` (Express si las bases ocupan menos de 10 GB, o la edición con licencia de la UTA). Un backup se restaura en una edición igual o superior en funcionalidades; los de ServiceDesk no usan funciones exclusivas de Enterprise.

**4. Restic.** No hace falta instalarlo: los scripts usan la imagen oficial fijada.
```bash
docker pull restic/restic:0.18.0
```

**5. Paquete.**
```bash
sudo mkdir -p /opt/servicedesk && sudo tar -xzf servicedesk-uta-server-<versión>.tar.gz -C /opt/servicedesk --strip-components=1
cd /opt/servicedesk
```

## B. Acceder a los backups

**6. Credenciales externas.** En Backblaze, **revoca** la Application Key del servidor perdido y crea una nueva limitada al bucket ([CONFIGURACION_BACKBLAZE.md §4](CONFIGURACION_BACKBLAZE.md)).

**7. Clave Restic.** El custodio la escribe directamente en el servidor:
```bash
sudo install -d -m 700 /etc/servicedesk
sudo install -m 600 deploy/backup/backup.env.example /etc/servicedesk/backup.env
sudo nano /etc/servicedesk/backup.env          # RESTIC_REPOSITORY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, B2_REGION
sudo install -m 600 /dev/null /etc/servicedesk/restic.pass && sudo nano /etc/servicedesk/restic.pass   # pega la clave
```
Usa el **mismo** `RESTIC_SNAPSHOT_HOST` que tenía el servidor anterior (por defecto `servicedesk-prod`).

**8. Conectar con el repositorio.**
```bash
sudo scripts/backup/restic-test-connection.sh       # ✔ Conexión correcta … snapshots: N
```
Si aparece `E_REPO_PASSWORD`, la clave no es la de este repositorio. Prueba la del otro custodio.

**9. Listar los snapshots y elegir uno.**
```bash
sudo scripts/backup/restic-restore.sh --list
```
Normalmente, el más reciente (`latest`). Ante una corrupción lógica o un borrado masivo, elige uno **anterior** al incidente.

**10. Verificarlo y restaurar los archivos.**
```bash
sudo scripts/backup/restic-check.sh --full          # opcional pero recomendado: lee y descifra todo
sudo scripts/backup/restic-restore.sh --snapshot latest --target /root/restore/sd
```
El script descifra, comprueba con `restic restore --verify`, valida el `SHA256SUMS` del conjunto, cada imagen contra `uploads.sha256` y la configuración contra `config/SHA256SUMS`. El directorio queda con permisos 700 porque contiene secretos.

## C. Reconstruir

**11-12. Restaurar las tres bases y las imágenes.** Lo hace el instalador en modo restauración. Primero prepara el `.env` (paso 13).

**13. Configuración.** `/root/restore/sd/config/` contiene el `server.env` del servidor perdido, el compose, nginx, systemd y los parámetros de SQL Server (`mssql-server.txt`). Crea el `.env` nuevo a partir de la plantilla:
```bash
sudo cp .env.example deploy/server/.env && sudo chmod 600 deploy/server/.env
sudo diff <(grep -oE '^[A-Z_]+=' /root/restore/sd/config/server.env) <(grep -oE '^[A-Z_]+=' deploy/server/.env)   # compara solo NOMBRES
sudo nano deploy/server/.env
```

| Tipo de variable | Qué hacer |
|---|---|
| **Servicios externos** (`MICROSOFT_*`, `SMTP_*`, `FCM_*`, `ADMIN_EMAILS`, `STORAGE_MODE`…) | **Cópialas** del `server.env` restaurado. Si sospechas que el servidor se perdió por un ataque, **rótalas** en cada proveedor |
| **Internas** (`MSSQL_SA_PASSWORD`, `*_DB_PASSWORD`, `JWT_SECRET`) | **No** las copies: déjalas vacías y el instalador las genera nuevas (`--generate-secrets`). Los usuarios de base se remapean a los logins nuevos |
| `INITIAL_ADMIN_EMAIL` | Déjala vacía: los administradores vienen en el backup |

**14. Red y dominio nuevos.** Ajusta `PUBLIC_DOMAIN`, puertos y `MSSQL_PID`. Si cambia el dominio, actualiza también la *Redirect URI* de Azure (`MICROSOFT_REDIRECT_URI`) y el DNS.

**15. Levantar los servicios restaurando.**
```bash
sudo scripts/install-server.sh --mode restore --from /root/restore/sd --generate-secrets
```

| Etapa | Qué hace |
|---|---|
| Validación | Comprueba el `.env`, la edición de SQL Server y los recursos |
| SQL Server | Lo levanta y crea los logins con contraseñas nuevas |
| Restauración | Ejecuta `restore-mssql.sh`: SHA-256, `VERIFYONLY`, compatibilidad de versión, `RESTORE … WITH MOVE`, `DBCC CHECKDB` y remapeo de usuarios. Restaura las imágenes en el volumen nuevo |
| Arranque | Inicia los servicios **sin seed**. Las migraciones de la Fase R se aplican solas si el backup es antiguo |
| Final | Configura nginx, systemd y firewall, y ejecuta el smoke |

## D. Validar

**16. Smoke:** `sudo scripts/operations/smoke-server.sh` → todo ✔.

**17. Login.** Como no hay contraseñas en el backup accesibles al operador, un administrador entra con una contraseña temporal:
```bash
sudo scripts/operations/manage-user.sh reset-password <correo-admin>   # secreto en archivo 0600; el login obliga a cambiarla
```
Los usuarios con Microsoft SSO entran normalmente (si se actualizó la Redirect URI).

**18. Tickets.** El listado de administración muestra el mismo número de tickets que `counts.txt` (`tickets=`).

**19. Imágenes.** Abre un ticket con adjuntos: las imágenes se ven. Sin sesión, la URL de una imagen responde 401.

**20. Historial.** El historial de un ticket muestra sus eventos.

## E. Después de recuperar

1. Recrea la clave del servidor: `sudo scripts/backup/restic-keys.sh rotate-server-key`. Si se usó la clave del custodio, deja la del custodio como estaba.
2. Primer backup desde el servidor nuevo: `sudo systemctl start servicedesk-backup.service` → `status=OK`.
3. Restore drill: `sudo scripts/backup/restore-drill.sh` → PASS.
4. Borra el directorio de restauración, que contiene secretos: `sudo shred -u /root/restore/sd/config/* && sudo rm -rf /root/restore/sd`.
5. Registra el incidente: snapshot usado, hora del snapshot (**pérdida de datos = desde ese momento hasta el incidente**, normalmente menos de 24 h) y tiempo total de recuperación.

## Atajo para una prueba sin tocar producción

`scripts/backup/restore-drill.sh` hace los pasos 9-12 y las comprobaciones de datos en un SQL Server efímero aislado, y lo borra al terminar. `scripts/testing/backup-dr-simulation.sh` (solo en el repositorio, no en el paquete) reproduce el procedimiento completo con MinIO local.
