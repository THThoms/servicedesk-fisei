# Configuración de producción

Escrito para: quien rellena `deploy/server/.env` en el servidor nuevo.

La plantilla es `.env.example` (raíz del paquete). Se copia a `deploy/server/.env`
con permisos `600`. **Nunca** copies el `.env` del VPS anterior ni reutilices sus
contraseñas: este servidor debe tener credenciales propias.

## 1. Variables

| Variable | Obligatoria | Descripción |
|---|---|---|
| `PUBLIC_DOMAIN` | Sí | Dominio público **sin** `https://`, p. ej. `servicedesk.fisei.uta.edu.ec` |
| `GATEWAY_BIND_PORT` / `FRONTEND_BIND_PORT` | No (8080/3000) | Puertos en 127.0.0.1 hacia los que proxya nginx |
| `MSSQL_PID` | **Sí (bloqueante)** | Edición de SQL Server (§2) |
| `MSSQL_MEMORY_LIMIT_MB` | No (2048) | Memoria máxima del motor |
| `MSSQL_SA_PASSWORD` | Sí | Contraseña de `sa` (§3) |
| `AUTH_DB_PASSWORD`, `CATALOG_DB_PASSWORD`, `TICKET_DB_PASSWORD` | Sí | Una por login de servicio, distintas entre sí y de `sa` |
| `*_DB_NAME`, `*_DB_USER` | No | `auth_db`/`auth_user`, `catalog_db`/`catalog_user`, `ticket_db`/`ticket_user` |
| `JWT_SECRET` | Sí | ≥ 32 caracteres aleatorios. Cambiarlo invalida todas las sesiones |
| `JWT_EXPIRES_IN` | No (8h) | Duración de la sesión |
| `MICROSOFT_CLIENT_ID`, `_TENANT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI` | Las 4 o ninguna | SSO institucional (§4) |
| `ALLOWED_DOMAIN` | No (`uta.edu.ec`) | Dominio de correo permitido |
| `ADMIN_EMAILS` | No | Correos que reciben rol `admin` en su **primer** login SSO |
| `INITIAL_ADMIN_EMAIL` | Sí en modo limpio | Administrador inicial. Lo crea el bootstrap seguro **una sola vez** (si ya hay un admin, no crea otro) |
| `INITIAL_ADMIN_NAME` | No | Nombre visible del admin inicial |
| `INITIAL_ADMIN_SSO_ONLY` | No (`false`) | `true` = admin sin contraseña local (requiere SSO) |
| ~~`INITIAL_ADMIN_PASSWORD`~~ | **Retirada (Fase R)** | El instalador la **rechaza**. La contraseña inicial es **temporal**, se genera aleatoriamente, solo se guarda su hash y queda en `deploy/server/.initial-admin-secret` (0600) para leerla una vez y borrarla. El primer login obliga a cambiarla |
| `SESSION_RETENTION_DAYS` | No (7) | Días que se conservan sesiones caducadas o revocadas antes de purgarlas |
| `EMAIL_SEND_MODE` | No (`log`) | `smtp` para enviar correo real (exige `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) |
| `SMTP_*` | Si `smtp` | Servidor SMTP. En Gmail, usar una *contraseña de aplicación* |
| `STORAGE_MODE` | No (`local`) | Mantener `local` (§6) |
| `FCM_MODE`, `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | Si hay push | `firebase` + service account (§5) |
| `BACKUP_DIR` | No | `/var/backups/servicedesk` |
| `BACKUP_LOCAL_KEEP` | No (3) | Conjuntos locales que se conservan en disco |
| `BACKUP_SQL_COMPRESSION` | No (`auto`) | `auto`: sin compresión SQL cuando hay Restic (comprime y deduplica él) |
| `BACKUP_REQUIRE_OFFSITE` | No (`true`) | Sin repositorio externo, el backup termina con código 3 (alerta) |
| `DRILL_MODE` | No (`ephemeral`) | Restore drill en un SQL Server temporal aislado o en la propia instancia (`instance`) |
| `BACKUP_ALERT_EMAIL` | Recomendado | Destinatario de alertas (requiere `mail` en el host) |
| `BACKUP_ALERT_WEBHOOK_URL` | Opcional | Webhook de alertas (Teams/Slack/ntfy) |

La **copia externa cifrada** (Restic → B2) **no** se configura aquí, sino en `/etc/servicedesk/backup.env` (§7).

Variables de laboratorio (`AUTH_DEV_LOGIN`, `AUTH_MICROSOFT_SIMULATE`,
`SEED_DEMO_USERS`): el compose del servidor las fija en `false` y, además, el
backend las ignora con `NODE_ENV=production`.

Para comprobar el estado de cada variable **sin ver los valores**, ejecuta
`sudo scripts/install-server.sh --mode clean --dry-run`. Muestra cada una como
CONFIGURADA, VACÍA o AUSENTE.

## 2. SQL Server: edición y licencia (BLOQUEANTE)

La edición se elige con `MSSQL_PID`. **El instalador no continúa** si está vacía,
y la rechaza si es `Developer` o `Evaluation`.

| Edición | ¿Producción? | Licencia | Límites relevantes | Valoración para ServiceDesk |
|---|---|---|---|---|
| **Developer** | ❌ No | Gratuita **solo para desarrollo y pruebas** | Sin límites técnicos | Prohibida en el servidor nuevo |
| **Evaluation** | ❌ No | Gratuita 180 días | Caduca | Prohibida |
| **Express** | ✅ Sí | Gratuita, uso en producción permitido | 10 GB **por base**, 1.410 MB de buffer pool, mín(1 socket, 4 núcleos); sin SQL Agent ni compresión de backup | Suficiente hoy: las bases ocupan MB y las imágenes no van en SQL. Se probó en la simulación de Fase P |
| **Standard** | ✅ Sí | De pago (por núcleo o servidor + CAL) | 128 GB de buffer pool, 24 núcleos | Si se superan los límites de Express o se quiere margen |
| **Enterprise** / **EnterpriseCore** | ✅ Sí | De pago | Sin límites prácticos | Innecesaria para el volumen actual |

- `MSSQL_PID` también admite una **clave de producto** (`XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`).
- La imagen `mcr.microsoft.com/mssql/server:2022-latest` es la misma para todas las ediciones; `MSSQL_PID` determina la edición y la licencia que aceptas (`ACCEPT_EULA=Y`).
- **La decisión de licencia corresponde al propietario del sistema o a la UTA.** El instalador pide una confirmación explícita.
- Tras instalar, la edición real se comprueba con `SERVERPROPERTY('Edition')`. El instalador aborta si no coincide con `MSSQL_PID`.
- Express no soporta `BACKUP … WITH COMPRESSION`. `scripts/backup-mssql.sh` lo detecta y hace el backup sin compresión.

## 3. Contraseñas

- Política del instalador: ≥ 12 caracteres, con mayúscula, minúscula, número y símbolo.
- No pueden contener `; ' " $ \` \ { } # & | < >` ni espacios: rompen la cadena de conexión de Prisma o `sqlcmd`.
- `sa` y los 3 logins deben ser **distintos entre sí**. `JWT_SECRET` no puede coincidir con ninguno.
- La forma recomendada es `sudo scripts/install-server.sh --mode … --generate-secrets`, que rellena los valores **vacíos** con contraseñas aleatorias que cumplen la política. No las imprime; quedan solo en `deploy/server/.env`.
- **Rotación posterior**: cambia el valor en `.env` y ejecuta `docker compose up -d`. `mssql-init` sincroniza la contraseña de cada login con `ALTER LOGIN`, y los servicios se recrean con el valor nuevo. Para `sa`, cámbiala dentro de SQL Server **antes** de editar `.env`.

## 4. Microsoft SSO (Entra ID)

1. En el registro de la aplicación en Azure (lo hace quien administra el tenant; esta fase no modifica Azure), añade la *Redirect URI*:
   `https://<PUBLIC_DOMAIN>/api/auth/microsoft/callback`
2. Pon en `.env` las 4 variables `MICROSOFT_*`, con `MICROSOFT_REDIRECT_URI` exactamente igual a esa URL.
   Desde la Fase R el callback devuelve al navegador o a la app un **código de un solo uso** (`/auth/success?code=…`, 60 s), nunca el JWT. El código se canjea con `POST /api/auth/sso/exchange`. No hace falta ningún cambio en Azure por esto.
3. Pon en `ADMIN_EMAILS` los correos que deben entrar como administradores.
4. Android: el flujo usa el navegador del sistema y vuelve por `ec.uta.servicedesk://auth/success?code=…`. **El APK debe reconstruirse** con el frontend de la Fase R (el anterior esperaba `?token=`) y con `VITE_API_URL` apuntando al dominio nuevo.

## 5. Firebase (push Android)

- `FCM_MODE=firebase` + `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` y `FCM_PRIVATE_KEY` de un *service account* del proyecto `servicedesk-uta`.
- `FCM_PRIVATE_KEY` va entre comillas, con los saltos de línea escritos como `\n`.
- **Nunca** subas el JSON del service account al servidor fuera de `.env`, ni al repositorio, ni al APK.

## 6. Imágenes adjuntas

- Deja `STORAGE_MODE=local`. Las imágenes viven en el volumen `servicedesk_ticket-uploads`, que entra en el backup diario: Restic lo lee directamente, detectado por el montaje `/app/uploads`.
- `cloudinary` **no está instalado** en ticket-service: con `STORAGE_MODE=cloudinary` el servicio usa almacenamiento local de todos modos. Cambiar de proveedor requiere instalar el paquete y planificar qué pasa con los archivos existentes.

## 7. Backups y copia externa

- Copia externa: **Restic cifrado → Backblaze B2 (API S3)**. Configuración en `/etc/servicedesk/backup.env` (600; plantilla `deploy/backup/backup.env.example`) y clave en `/etc/servicedesk/restic.pass`. Pasos: [CONFIGURACION_BACKBLAZE.md](../operations/CONFIGURACION_BACKBLAZE.md). Custodia de la clave: [CUSTODIA_CLAVE_BACKUPS.md](../operations/CUSTODIA_CLAVE_BACKUPS.md).
- Sin copia externa, cada backup termina con código 3: el backup local se conserva, pero systemd dispara la alerta. Un backup guardado solo en el mismo disco **no** se considera suficiente.
- `BACKUP_OFFSITE_RSYNC_TARGET` (Fase P) **ya no se usa**: el instalador avisa si aún aparece.

## 8. App Android

El APK lleva la URL del API **compilada**. Para el servidor nuevo, el APK debe reconstruirse con `VITE_API_URL=https://<PUBLIC_DOMAIN>` (ver README §Android). El APK actual apunta a `https://servicedesk-uta.site`.
