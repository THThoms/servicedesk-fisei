# Problemas frecuentes

Escrito para: el operador del servidor. Atajo usado abajo, ejecutado desde `/opt/servicedesk`:
`dc() { docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env "$@"; }`

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El instalador dice **BLOQUEADO: MSSQL_PID** | Edición vacía o `Developer`/`Evaluation` | Definir la edición con licencia válida (`CONFIGURACION_PRODUCCION.md §2`) |
| `mssql` nunca llega a `healthy` | RAM insuficiente (< 2 GB libres), `MSSQL_SA_PASSWORD` débil o arquitectura ARM | `dc logs mssql --tail 50`; revisar RAM y arquitectura; la contraseña debe cumplir la política |
| `mssql-init` sale con error | Contraseña de login que no cumple `CHECK_POLICY` o contiene caracteres prohibidos | `dc logs mssql-init`; regenerar la contraseña sin `; ' " $` |
| Un servicio se reinicia en bucle tras actualizar | `prisma db push` rechazó un cambio con pérdida de datos (`PRISMA_ACCEPT_DATA_LOSS=false`) | `dc logs auth-service` (o el servicio afectado); revisar el cambio de esquema; restaurar o migrar a mano |
| `frontend` aparece `unhealthy` pero la web responde | Healthcheck contra `localhost` (IPv6) en lugar de `127.0.0.1` | Ya corregido en este compose; si se editó, volver a `wget … http://127.0.0.1/` |
| Imágenes "No se pudo cargar la imagen" | 401 (sesión caducada), 403 (sin permiso) o 404 (archivo ausente) | DevTools → Network → `GET /api/tickets/…/attachments/…`; si da 404, `dc exec ticket-service ls /app/uploads` |
| Imágenes "No disponible" | Bundle antiguo en caché del navegador | Ctrl+F5 |
| Error de CORS en el navegador | `PUBLIC_DOMAIN` no coincide con la URL usada | Corregir `PUBLIC_DOMAIN` y `dc up -d --build frontend api-gateway auth-service ticket-service` |
| SSO vuelve con `error=…` | Redirect URI distinta de la registrada en Azure | Debe ser `https://<dominio>/api/auth/microsoft/callback` en Azure **y** en `.env` |
| El login simulado o el dev-login responden 404 | **Es lo correcto** en producción | — |
| Backup termina con código 3 | Sin repositorio externo cifrado | Configurar `/etc/servicedesk/backup.env` (`docs/operations/CONFIGURACION_BACKBLAZE.md`) |
| Backup termina con código 4 | Falló la copia a B2/S3 | `sudo scripts/backup/restic-test-connection.sh` indica la causa (`docs/operations/ALERTAS_BACKUPS.md §4`) |
| `E_REPO_LOCKED` tras un corte | Bloqueo huérfano de Restic | `sudo scripts/backup/restic-check.sh --unlock` |
| `check-backup.sh` dice "tiene N h" | El timer no se ejecutó o falló | `systemctl status servicedesk-backup.timer`; `journalctl -u servicedesk-backup -n 100` |
| nginx no arranca tras renderizar | Certificado ausente con la plantilla TLS | Usar la de arranque: `scripts/install-server.sh --nginx-tls` solo tras emitir el certificado |
| La app Android no carga datos | El APK apunta a otro dominio | Reconstruir con `VITE_API_URL=https://<dominio>` |
| Técnico no ve tickets disponibles | Rol `user` o área equivocada | `manage-user.sh list-staff` / `set-role <correo> technician\|dtic` |
| Un técnico recibe 403 al abrir un ticket | El ticket es de la **otra área** (correcto desde la Fase R) | Reescalar al área correcta o asignarlo desde administración |
| Todo responde 403 `password_change_required` | La cuenta tiene una contraseña temporal | Cambiarla en la pantalla "Cambia tu contraseña" |
| Login responde 429 | Limitación de intentos (5 fallos por cuenta o 20 por IP) | Esperar los minutos indicados en `Retry-After`; no hay bloqueo permanente |
| SSO vuelve a `/login?error=auth_failed` | El código de un solo uso caducó (>60 s) o ya se usó | Repetir el inicio de sesión |
| Llamadas a `/api/tickets/level`, `/status`, `/routing/*` responden 410 | Endpoints del modelo por niveles retirados | Usar el flujo vigente (ver ARQUITECTURA §5) |
| Tras un logout, otro servicio acepta el token unos segundos | Caché de introspección (30 s) | Comportamiento esperado; queda invalidado al expirar la caché |

Logs: `dc logs -f --tail 100 <servicio>` · Estado: `dc ps` · Recursos: `docker stats --no-stream`.
