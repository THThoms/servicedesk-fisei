# Seguridad del servidor

Escrito para: el administrador del servidor.

Resumen de las capas de seguridad del servidor.

## 1. Firewall (UFW)

Solo 22, 80 y 443. Detalles, el problema de Docker frente a UFW y cómo verificarlo en [CONFIGURACION_RED.md](CONFIGURACION_RED.md).

## 2. SSH

**Archivo:** `deploy/ssh/99-servicedesk-hardening.conf`, que va en `/etc/ssh/sshd_config.d/`.

| Directiva | Valor |
|---|---|
| `PasswordAuthentication` | `no` |
| `KbdInteractiveAuthentication` | `no` |
| `PermitRootLogin` | `prohibit-password` (root solo con clave) |
| `MaxAuthTries` | 3 |
| `LoginGraceTime` | 30 |
| Reenvío X11 y de agente | Desactivados |

**El puerto no cambia** (22, o el que ya tenga el servidor con `--ssh-port`); no se fija ningún valor arbitrario.

**Cuándo lo aplica el instalador:**
- **Solo** si existe una vía de entrada por clave verificable: una cuenta administrativa **no root** del grupo `sudo` con `~/.ssh/authorized_keys`, o como mínimo la clave de root (con aviso).
- Pide confirmación y valida con `sshd -t`. Si falla, retira el archivo y SSH queda como estaba.
- Sin ninguna clave **no** desactiva las contraseñas, para no dejarte fuera.

**Procedimiento recomendado** (antes de instalar):
```bash
# como root, una vez
adduser admin-sd && usermod -aG sudo admin-sd
install -d -m 700 -o admin-sd -g admin-sd /home/admin-sd/.ssh
nano /home/admin-sd/.ssh/authorized_keys          # pega TU clave pública
chown admin-sd: /home/admin-sd/.ssh/authorized_keys && chmod 600 /home/admin-sd/.ssh/authorized_keys
# desde OTRA terminal, sin cerrar la actual:
ssh admin-sd@servidor 'sudo -v && echo OK'
# luego, desde la sesión de admin-sd:
sudo scripts/install-server.sh --mode clean …
```

**Si quedas fuera:** entra por la **consola web** del proveedor y ejecuta `rm /etc/ssh/sshd_config.d/99-servicedesk-hardening.conf && systemctl reload ssh`.

**VPS anterior:** su SSH **no se toca**.

## 3. Docker

**Archivo:** `deploy/docker/daemon.json`, que va en `/etc/docker/daemon.json`. Validado con `dockerd --validate`.

| Opción | Valor | Para qué |
|---|---|---|
| `log-driver` | `json-file` | — |
| `max-size` × `max-file` | 20 MB × 5 | Rotación de logs de todos los contenedores |
| `live-restore` | `true` | Los contenedores siguen vivos si se reinicia dockerd |
| `userland-proxy` | `false` | — (exige Docker ≥ 28, ver CONFIGURACION_RED.md §4) |
| `no-new-privileges` | `true` | Ningún contenedor gana privilegios |

**Cómo lo aplica el instalador:**
- Solo si **no** existe un `daemon.json`. Uno existente no se sobrescribe; se avisa.
- Aplicarlo requiere **reiniciar Docker** (`systemctl restart docker`), que el instalador hace antes de levantar la aplicación.
- **Almacenamiento:** el *storage driver* por defecto (overlay2) en `/var/lib/docker`. Si hay un disco de datos aparte, define `"data-root"` **antes** de la primera instalación (moverlo después exige parar Docker y copiar).

Además, el compose añade:
- `no-new-privileges` en cada servicio.
- Límites de memoria y CPU.
- SQL Server sin root.
- La red `data` sin Internet.

## 4. Logs

| Origen | Rotación |
|---|---|
| Contenedores | json-file 20 MB × 5 (compose y daemon.json) |
| `/var/log/servicedesk-alerts.log` y `/var/log/servicedesk/*.log` | `deploy/logrotate/servicedesk`: semanal, 12 copias, comprimidas |
| journal de systemd | La rotación propia de journald |

Los logs **no contienen secretos**:
- Los scripts muestran solo el estado de las variables, nunca su valor.
- Las cadenas de error de la aplicación no incluyen contraseñas.
- El log de seguridad enmascara los correos.

## 5. Secretos

**Separación:**

| Secreto | Dónde vive |
|---|---|
| SQL, JWT, SSO, SMTP y FCM | `deploy/server/.env` (600) |
| Credenciales S3 | `/etc/servicedesk/backup.env` (600) |
| Clave Restic | `/etc/servicedesk/restic.pass` (600), con custodia |

**Reglas:**
- El instalador genera los internos (`--generate-secrets`): distintos entre sí, con política de fuerza y sin imprimirlos.
- **No se reutilizan contraseñas del VPS anterior.**
- No hay contraseña del administrador en el `.env`: se usa una contraseña temporal y el cambio es obligatorio en el primer acceso.
- El instalador rechaza un `SD_ENV_FILE` heredado de otra instalación.
- El paquete excluye `.env`, claves, certificados, `*.pass` y `backup.env`.

## 6. Aplicación (Fases R y T)

**Roles y acceso:**
- Roles oficiales `admin`, `technician`, `dtic` y `user`. **DTIC no es administrador**: probado por la E2E (403 en estadísticas, historial general y técnicos).
- Aislamiento por área en el backend: ningún técnico ve tickets, historial ni imágenes de otra área.
- Imágenes **solo** por el endpoint autenticado `GET /api/tickets/:ticketId/attachments/:attachmentId`. `/uploads/` devuelve 404.

**Sesiones y login:**
- Sesiones guardadas como SHA-256, con revocación efectiva en los 3 servicios.
- Límite de intentos por IP y por cuenta.
- Sin dev-login, sin login simulado y sin cuentas demo en producción.

**Microsoft SSO:**
- Código de un solo uso; el JWT nunca va en la URL.
- **Fase T:** el parámetro `state` está ligado al navegador mediante una cookie HttpOnly, SameSite=Lax y Secure, de 10 minutos. El callback rechaza (`invalid_state`) cualquier `state` que no corresponda a ese navegador, lo que protege contra el login CSRF. Funciona igual en web y en la app Android, porque esta abre el login en el navegador del sistema.
