# Instalación de ServiceDesk UTA en un servidor nuevo

Escrito para: la persona que instalará el sistema **a mano** en un servidor Ubuntu nuevo.
No hace falta conocer el proyecto. Cada paso indica **dónde** se ejecuta y **qué** debe verse.

> Antes de empezar, lee `REQUISITOS_NUEVO_SERVIDOR.md` y `CONFIGURACION_PRODUCCION.md`.
> Ten decididos: **dominio**, **edición de SQL Server** (`MSSQL_PID`), **modo** (limpio o
> restauración) y **destino de la copia externa** de backups.

Convenciones: `$` = usuario normal con sudo · `#` = root. Directorio de instalación: `/opt/servicedesk`.

---

## 0. Decide el modo

| | **MODO A — instalación limpia** | **MODO B — restauración** |
|---|---|---|
| Cuándo | Sistema nuevo, sin datos | Trasladar los datos de otra instalación (p. ej. el VPS anterior) |
| Datos | Catálogo, ubicaciones y base de conocimiento iniciales + admin inicial | Los de los `.bak` y el `.tar.gz` de imágenes |
| Seeds | Sí, solo en el primer arranque | **Nunca** |
| Comando | `--mode clean` | `--mode restore --from <dir>` |

El instalador **obliga** a elegir uno y no los mezcla: no instala limpio sobre datos existentes y no restaura encima sin `--replace`.

---

## 1. Copiar el paquete y verificar su integridad

En **tu equipo**, carpeta `release/` del repositorio (generada con `scripts/build-server-package.sh <versión>`):

```bash
scp release/servicedesk-uta-server-<VERSION>.tar.gz release/servicedesk-uta-server-<VERSION>.tar.gz.sha256 usuario@SERVIDOR:/tmp/
```

En el **servidor**:

```bash
$ cd /tmp && sha256sum -c servicedesk-uta-server-<VERSION>.tar.gz.sha256
```
Esperado: `servicedesk-uta-server-<VERSION>.tar.gz: OK`. Si dice `FAILED`, **no continúes**: vuelve a copiar el archivo.

---

## 2. Preparar Ubuntu Server 24.04

```bash
# Actualizar y utilidades
$ sudo apt update && sudo apt -y full-upgrade
$ sudo apt -y install ca-certificates curl gnupg rsync openssl nginx certbot ufw
$ sudo timedatectl set-timezone America/Guayaquil

# Usuario administrativo (si el servidor solo trae root)
# adduser admin && usermod -aG sudo admin
```

**SSH** (antes, prueba que tu clave pública funciona con el usuario admin):

```bash
$ sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
$ sudo systemctl reload ssh
```

**Firewall**: lo configura el instalador (paso 3b: UFW con SSH, 80 y 443; con otro puerto SSH, usa `--ssh-port N`). Para hacerlo a mano antes de empezar, o si usas `--skip-firewall`:

```bash
$ sudo ufw allow OpenSSH
$ sudo ufw allow 80/tcp
$ sudo ufw allow 443/tcp
$ sudo ufw enable
$ sudo ufw status
```
Esperado: solo SSH, 80 y 443 en `ALLOW`. **No** abras 1433, 8080 ni 3000: el compose los publica solo en 127.0.0.1.

---

## 3. Instalar Docker Engine y Compose v2 (repositorio oficial)

```bash
$ sudo install -m 0755 -d /etc/apt/keyrings
$ curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
$ echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
$ sudo apt update && sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
$ sudo docker version --format '{{.Server.Version}}' && sudo docker compose version
```
Esperado: versión de Docker ≥ 24 y `Docker Compose version v2.x`.

---

## 4. Extraer el paquete

```bash
$ sudo mkdir -p /opt/servicedesk
$ sudo tar -xzf /tmp/servicedesk-uta-server-<VERSION>.tar.gz -C /opt/servicedesk --strip-components=1
$ cd /opt/servicedesk && ls
```
Esperado: `api-gateway auth-service catalog-service deploy docs frontend scripts ticket-service .env.example MANIFEST.md FILES.txt README.md`.

---

## 5. Configurar `deploy/server/.env`

Desde `/opt/servicedesk`:

```bash
$ sudo cp .env.example deploy/server/.env
$ sudo chmod 600 deploy/server/.env
$ sudo nano deploy/server/.env
```

Rellena como mínimo (detalle en `CONFIGURACION_PRODUCCION.md`):

- `PUBLIC_DOMAIN=servicedesk.tu-dominio.edu.ec`
- **Servidor de PRUEBAS (primera instalación):** `SERVER_PURPOSE=pruebas` y `MSSQL_PID=Developer`. Developer tiene licencia solo para desarrollo, evaluación y pruebas.
- **Producción:** `SERVER_PURPOSE=produccion` y `MSSQL_PID=Express` (o la edición con licencia). Con `produccion`, Developer queda **bloqueado** ([CONFIGURACION_SQL_SERVER.md](CONFIGURACION_SQL_SERVER.md))
- `INITIAL_ADMIN_EMAIL` y `INITIAL_ADMIN_NAME` (solo en modo limpio). **No hay ninguna contraseña de admin en el `.env`**: el instalador crea el administrador con una contraseña **temporal** (ver paso 6A.7b)
- SSO (`MICROSOFT_*`, `ADMIN_EMAILS`), SMTP y FCM si se van a usar
- `BACKUP_ALERT_EMAIL` / `BACKUP_ALERT_WEBHOOK_URL`. La copia externa cifrada se configura **aparte**, en `/etc/servicedesk/backup.env` ([CONFIGURACION_BACKBLAZE.md](../operations/CONFIGURACION_BACKBLAZE.md))

Deja **vacías** `MSSQL_SA_PASSWORD`, `*_DB_PASSWORD` y `JWT_SECRET`: el instalador las genera con `--generate-secrets`.

Comprueba la configuración **sin instalar nada**:

```bash
$ sudo scripts/install-server.sh --mode clean --generate-secrets --dry-run
```
Esperado: la tabla de variables (CONFIGURADA, VACÍA o AUSENTE, nunca valores) y `✔ Configuración válida`. Cada `✘` dice qué corregir.

---

## 6A. MODO A — Instalación limpia

Desde `/opt/servicedesk`:

```bash
$ sudo scripts/install-server.sh --mode clean --generate-secrets
```

Qué hace, en orden, y qué verás:

1. **Preflight**: Ubuntu, x86_64, RAM, vCPU, disco, Docker y Compose (`✔` en cada línea).
2. **Configuración**: genera los secretos vacíos (`GENERADA`), valida y pide confirmar la licencia de SQL Server. Escribe `SI`.
3. **Modo**: comprueba que no haya datos previos.
   **3b. Host**: instala `/etc/docker/daemon.json` (rotación de logs, `live-restore`, `no-new-privileges`; si ya existe uno distinto **no lo toca**), configura **UFW** (SSH, 80, 443), endurece **SSH** (sin contraseña, sin root por contraseña) **solo si ya tienes una clave autorizada** y tras validar con `sshd -t`, e instala logrotate. Pide confirmación antes de UFW y de SSH.
4. **Build** de las 5 imágenes (5–15 minutos la primera vez).
5. **SQL Server**: lo arranca y muestra la edición real (`Express Edition (64-bit) · 16.0…`).
6. **Datos**: `mssql-init` crea `auth_db`, `catalog_db`, `ticket_db` y sus 3 logins.
7. **Servicios**: arranca auth, catalog, ticket, gateway y frontend con el seed inicial (catálogo, ubicaciones y KB; **ningún usuario**) y espera `6/6 servicios healthy`. Después los recrea sin seed.
   **7b. Administrador inicial**: lo crea con el bootstrap seguro y guarda la contraseña **temporal** en `deploy/server/.initial-admin-secret` (permisos 600). **No la muestra.** Léela una vez (`sudo cat deploy/server/.initial-admin-secret`) y bórrala (`sudo shred -u deploy/server/.initial-admin-secret`). Al entrar por primera vez, la aplicación obliga a cambiarla.
8. **Smoke**: `SMOKE: 16 OK · 0 fallos` (aprox.). Incluye que el login simulado y el dev-login respondan **404**, que los endpoints heredados respondan **410** y que un código SSO inválido responda **400**.
9. **nginx**: instala la configuración de arranque (sin certificado aún) y el hook de certbot que recarga nginx tras cada renovación.
10. **systemd**: crea `/etc/servicedesk/backup.env` vacío (si no existe), descarga la imagen de Restic y activa los timers de backup diario, verificación cada 6 h, retención y revisión semanales y restore drill mensual.

Continúa en el **paso 7**.

## 6B. MODO B — Restauración desde backups

1. **Obtén un backup reciente del servidor de origen.** El directorio debe contener `auth_db-*.bak`, `catalog_db-*.bak`, `ticket_db-*.bak` (en la raíz o en `db/`), las imágenes (`uploads/` + `uploads.sha256`, o `uploads-*.tar.gz`) y `SHA256SUMS`. Si el origen ya no existe, recupéralo del repositorio cifrado: [RESTAURACION_SERVIDOR_NUEVO.md](../operations/RESTAURACION_SERVIDOR_NUEVO.md).
   Desde una **instalación anterior**, si tienes autorización: haz un backup nuevo con el script de este paquete en modo heredado. Copia `scripts/` a ese servidor (p. ej. a `/root/sd-scripts/`) y ejecuta allí, con los nombres de contenedor y la ruta del `.env` de esa instalación:
   ```bash
   # cd /root/sd-scripts && MSSQL_CONTAINER=<CONTENEDOR_SQL> TICKET_CONTAINER=<CONTENEDOR_TICKETS> \
     SD_ENV_FILE=<RUTA_DEL_ENV> BACKUP_DIR=/root/backups/migracion \
     BACKUP_REQUIRE_OFFSITE=false ./backup-mssql.sh
   ```
   Esperado: `✔ Backup local completo: /root/backups/migracion/sets/<ID>` (sin repositorio externo configurado, las imágenes van en `uploads-*.tar.gz` dentro del conjunto). Copia esa carpeta al servidor nuevo, p. ej. a `/root/restore/<ID>/`.
2. Desde `/opt/servicedesk` del servidor nuevo, valida el backup sin restaurar:
   ```bash
   $ sudo scripts/install-server.sh --mode restore --from /root/restore/<STAMP> --generate-secrets --dry-run
   ```
3. Instala restaurando:
   ```bash
   $ sudo scripts/install-server.sh --mode restore --from /root/restore/<STAMP> --generate-secrets
   ```
   Esperado: `SHA-256 correcto`, `RESTORE VERIFYONLY` y `DBCC CHECKDB` correctos para cada base, imágenes restauradas, `usuarios re-mapeados`, los conteos (`users=… tickets=… attachments=…`), `6/6 servicios healthy` y el smoke en verde. **No se ejecuta ningún seed.**

Notas:
- Las contraseñas de este servidor son **nuevas** (`--generate-secrets`). Los usuarios conservan las suyas y sus roles, porque viajan dentro de `auth_db`.
- Un backup de **Developer** se puede restaurar en **Express** si cada base ocupa menos de 10 GB y no usa funciones exclusivas (ServiceDesk no las usa).
- El `JWT_SECRET` nuevo invalida las sesiones anteriores, así que los usuarios deberán volver a iniciar sesión.

---

## 7. DNS

En el proveedor del dominio, crea un registro `A` (y `AAAA` si hay IPv6) de `PUBLIC_DOMAIN` hacia la IP del servidor nuevo. Comprueba:

```bash
$ dig +short servicedesk.tu-dominio.edu.ec
```
Esperado: la IP del servidor nuevo. Si migras desde el VPS anterior, cambia el DNS **después** de validar los pasos 9–12 usando la IP directamente (hosts local).

## 8. HTTPS (Let's Encrypt)

Desde `/opt/servicedesk`, con el DNS ya resuelto:

```bash
$ sudo certbot certonly --webroot -w /var/www/certbot -d servicedesk.tu-dominio.edu.ec --agree-tos -m correo@uta.edu.ec --no-eff-email
$ sudo scripts/install-server.sh --nginx-tls
$ systemctl list-timers | grep certbot
```
Esperado: `Successfully received certificate`, luego `✔ nginx configurado (servicedesk.conf.template)` y el timer `certbot.timer` activo (renovación automática). Comprueba también la recarga tras renovar:
```bash
$ echo 'systemctl reload nginx' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh && sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
$ sudo certbot renew --dry-run
```

## 9. Verificar el dominio

```bash
$ cd /opt/servicedesk
$ sudo SMOKE_BASE_URL=https://servicedesk.tu-dominio.edu.ec scripts/operations/smoke-server.sh
$ curl -sI https://servicedesk.tu-dominio.edu.ec | grep -i strict-transport
$ curl -s -o /dev/null -w '%{http_code}\n' http://servicedesk.tu-dominio.edu.ec/
```
Esperado: `SMOKE: … 0 fallos`, la cabecera `strict-transport-security` y `301` (redirección a HTTPS).

## 10. Usuarios, login y roles

- **Login**: abre `https://<dominio>` y entra con el admin inicial (contraseña temporal → la aplicación pide cambiarla) o con Microsoft.
- **Técnicos y DTIC**: la aplicación aún no tiene pantalla para asignar roles. Pide a cada persona que entre una vez con Microsoft y después, desde `/opt/servicedesk`:
  ```bash
  $ sudo scripts/operations/manage-user.sh set-role correo@uta.edu.ec technician   # área Técnicos
  $ sudo scripts/operations/manage-user.sh set-role correo@uta.edu.ec dtic         # área DTIC (no es admin)
  $ sudo scripts/operations/manage-user.sh list-staff
  ```
  Sin SSO: `manage-user.sh create correo@uta.edu.ec dtic "Nombre Apellido" --password`.
- Más detalle en `docs/operations/GESTION_USUARIOS.md`.

## 11. Probar tickets e imágenes (navegador)

1. Como usuario: **Nuevo ticket** → servicio → ubicación → detalle → adjunta una imagen → crear.
2. Como técnico del área: **Disponibles** → aceptar → **Mis Aceptados** → clic en la tarjeta. Debe verse el detalle con la miniatura; al hacer clic, la imagen ampliada.
3. En DevTools → *Network*: `GET /api/tickets/…/attachments/…` → `200 image/…`, y **ningún** `/uploads/`.
4. Técnico → **Resolver**. Como usuario: **Rechazar** (con motivo), y el ticket vuelve al técnico. Técnico → resolver de nuevo. Usuario → **Aceptar**: estado *Resuelto*.
5. Admin → **Estadísticas** e **Historial**.

Prueba automatizada opcional (requiere Node 20 en algún equipo con acceso al gateway): `scripts/testing/smoke-e2e.mjs` (ver su cabecera).

## 12. Android

El APK actual apunta a `https://servicedesk-uta.site`. Para el dominio nuevo hay que **reconstruirlo** en el equipo de desarrollo:

```bash
cd frontend
VITE_API_URL=https://servicedesk.tu-dominio.edu.ec npm run build
npx cap sync android
cd android && ./gradlew assembleDebug        # o assembleRelease con keystore de firma
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
En el dispositivo: login (local y Microsoft), Mis Aceptados → detalle → miniatura → lightbox, y una notificación push que abra el ticket.

## 13. Backups y recuperación

```bash
$ cd /opt/servicedesk
$ sudo systemctl start servicedesk-backup.service && sudo journalctl -u servicedesk-backup -n 30 --no-pager
$ sudo scripts/operations/check-backup.sh
$ systemctl list-timers 'servicedesk-*'
```
Esperado: `✔ Backup completo … → snapshot …`, `✔ Backup correcto de hace 0 h` y cinco timers activos. Si aparece **código 3 / NO_OFFSITE**, falta configurar la copia externa cifrada ([CONFIGURACION_BACKBLAZE.md](../operations/CONFIGURACION_BACKBLAZE.md)). Operación diaria: [BACKUPS_MSSQL.md](../operations/BACKUPS_MSSQL.md).

**Restauración de prueba** (obligatoria antes de dar el servidor por bueno): `sudo scripts/backup/restore-drill.sh` → `RESTORE DRILL PASS`.

## 13b. Estado general

```bash
$ sudo scripts/operations/server-health.sh
```
Esperado: `Resumen: 0 fallo(s)`. El instalador ejecuta la versión `--brief` al terminar. Detalle en [MONITOREO_SERVIDOR.md](../operations/MONITOREO_SERVIDOR.md). Comprueba también, **desde otro equipo**, que solo 22, 80 y 443 están abiertos ([CONFIGURACION_RED.md §4](CONFIGURACION_RED.md)).

## 14. Lista final antes de abrir a usuarios

- [ ] `docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env ps` → 6 servicios `healthy`
- [ ] `/api/auth/config` → `devLoginEnabled:false`, `microsoftSimulateEnabled:false`
- [ ] Contraseña temporal del admin cambiada y `deploy/server/.initial-admin-secret` **borrado**
- [ ] `sudo ufw status` → solo SSH, 80 y 443 · `sudo sshd -T | grep passwordauthentication` → `no`
- [ ] Smoke por el dominio sin fallos
- [ ] Edición SQL Server ≠ Developer/Evaluation y licencia confirmada
- [ ] Backup manual correcto **con copia externa** y `check-backup.sh` en verde
- [ ] Simulacro de restauración hecho
- [ ] Puertos: `sudo ss -tlnp | grep -E ':(1433|8080|3000)'` → solo `127.0.0.1`
- [ ] Certificado válido y `certbot renew --dry-run` correcto
- [ ] APK reconstruido y probado en un dispositivo real (si se usa Android)

Si algo falla: `docs/troubleshooting/PROBLEMAS_FRECUENTES.md`.
