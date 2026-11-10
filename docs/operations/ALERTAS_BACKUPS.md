# Alertas de backups

Escrito para: el operador del servidor y quien reciba los avisos.

## 1. Qué se detecta

Cada tarea escribe un archivo de estado (`key=value`, sin secretos) y termina con error si algo falla. El error activa `servicedesk-alert@.service`.

| Situación | Lo detecta | Código |
|---|---|---|
| Falla `BACKUP DATABASE` de cualquiera de las 3 bases | backup diario | `E_BACKUP` |
| `RESTORE VERIFYONLY` falla | backup diario | `E_VERIFYONLY` |
| SHA-256 incorrecto (conjunto local o snapshot) | backup diario, verificación cada 6 h | `E_CHECKSUM` / `E_SNAPSHOT_VERIFY` |
| Falta de espacio (volumen SQL o `BACKUP_DIR`) | backup diario, antes de empezar | `E_NO_SPACE` |
| SQL Server no está en marcha | backup diario | `E_NO_CONTAINER` |
| Repositorio externo no accesible (red, DNS, endpoint) | backup, verificación, retención | `E_REPO_UNREACHABLE` |
| Credenciales S3 inválidas o sin permiso | ídem | `E_REPO_CREDENTIALS` |
| La clave Restic no abre el repositorio | ídem | `E_REPO_PASSWORD` |
| Error TLS | ídem | `E_REPO_TLS` |
| Falla la copia a S3 | backup diario (código 4) | `E_S3_UPLOAD` |
| No hay copia externa configurada | backup diario (código 3) | `E_NO_OFFSITE` |
| El último snapshot externo tiene más de 26 h | verificación cada 6 h | `E_NO_RECENT_SNAPSHOT` |
| `restic check` encuentra errores | revisión semanal | `E_REPO_CHECK` |
| Falla la restauración de prueba | restore drill mensual | `E_DRILL` |

Los códigos de repositorio se probaron provocando cada error en el laboratorio (Fase S §3).

## 2. Canales

`scripts/operations/alert.sh` es **independiente del sistema de backup**: no usa Restic, ni el repositorio, ni la base de datos. Solo lee los archivos de estado.

| Canal | Configuración | Siempre activo |
|---|---|---|
| journal de systemd (prioridad `err`, etiqueta `servicedesk-alert`) | — | Sí |
| `/var/log/servicedesk-alerts.log` | — (rotado por `deploy/logrotate/servicedesk`) | Sí |
| Correo | `BACKUP_ALERT_EMAIL` en `deploy/server/.env` + comando `mail` (p. ej. `apt install mailutils` con un relay SMTP de la UTA) | Opcional |
| Webhook (Teams, Slack, ntfy, Google Chat…) | `BACKUP_ALERT_WEBHOOK_URL` en `deploy/server/.env`. Envía `{"text": "..."}` | Opcional |
| **Latido externo** | `BACKUP_HEARTBEAT_URL` en `/etc/servicedesk/backup.env` | Opcional, **recomendado** |

El latido es la única alerta que funciona aunque **el servidor entero** haya desaparecido. Cada backup correcto llama a la URL; cada fallo llama a `<url>/fail`. El servicio externo (healthchecks.io, Uptime Kuma *push*, el monitor de la DTIC) avisa si no recibe el latido en el plazo configurado: 26 h para un backup diario.

Ejemplo de mensaje (sin secretos):

```text
ServiceDesk UTA en srv-servicedesk: 'servicedesk-backup.service' FALLÓ a las 2026-11-05T03:16:02Z —
credenciales S3 inválidas. Detalle: backup local correcto; falló la copia cifrada externa
```

## 3. Consultar y probar

```bash
journalctl -t servicedesk-alert --since -7d
sudo tail -n 20 /var/log/servicedesk-alerts.log
for f in last-status last-restic-check last-retention last-drill; do echo "== $f"; sudo cat /var/backups/servicedesk/$f 2>/dev/null; done
sudo systemctl start servicedesk-alert@prueba-manual.service    # envía un aviso de prueba por todos los canales
systemctl list-units --failed 'servicedesk-*'
```

## 4. Qué hacer ante cada alerta

| Código | Primera acción |
|---|---|
| `E_NO_SPACE` | `df -h /var/backups /var/lib/docker`. Reduce `BACKUP_LOCAL_KEEP` o amplía el disco. **No** borres conjuntos a mano sin revisar antes `last-status` |
| `E_VERIFYONLY` / `E_CHECKSUM` | Posible fallo de disco o de memoria. Repite el backup, revisa `dmesg` y el `DBCC CHECKDB` de la base afectada |
| `E_REPO_*` | `sudo scripts/backup/restic-test-connection.sh` indica la causa exacta ([CONFIGURACION_BACKBLAZE.md §7](CONFIGURACION_BACKBLAZE.md)) |
| `E_REPO_LOCKED` | Comprueba que no haya otra tarea en curso. Un bloqueo huérfano (p. ej. tras un corte de luz) se libera con `sudo scripts/backup/restic-check.sh --unlock`, que solo elimina bloqueos sin proceso vivo |
| `E_NO_RECENT_SNAPSHOT` | Mira por qué falló el backup diario: `journalctl -u servicedesk-backup` |
| `E_REPO_CHECK` | **Grave.** `sudo scripts/backup/restic-check.sh --full` y avisa al responsable. No ejecutes `prune` hasta aclararlo |
| `E_DRILL` | Lee `/var/backups/servicedesk/drills/drill-<último>.json` (`failures`). Un backup que no se restaura no es un backup |
