# Monitoreo del servidor

Escrito para: el operador del servidor.

## 1. Comando único

```bash
sudo scripts/operations/server-health.sh           # informe completo
sudo scripts/operations/server-health.sh --brief   # solo avisos y fallos (lo usa el instalador al terminar)
```

Termina con `0` si no hay ningún FALLO (puede haber avisos) y con `1` si hay alguno. **No muestra secretos**: lo comprueba la simulación de la Fase T.

| Bloque | Qué revisa | FALLO si… | AVISO si… |
|---|---|---|---|
| Host | Carga, RAM disponible, disco de `/`, Docker y backups | RAM < 10 %, disco ≥ 90 % | Carga > nº de vCPU, RAM < 20 %, disco ≥ 80 % |
| Contenedores | Estado, health, reinicios e imagen de los 6 servicios; puertos publicados | Un servicio no está *running/healthy*, o hay un puerto en 0.0.0.0 | Más de 3 reinicios |
| SQL Server | Edición y versión, 3 bases ONLINE, tamaño y recovery model, conexiones, memoria y rutas | No responde, una base no está ONLINE, o Developer fuera de un servidor de pruebas | — |
| Aplicación | Gateway `/health/ready`, frontend, nginx `https://<dominio>/healthz`, volumen de imágenes escribible | El gateway o el frontend no responden 200, o el volumen no es escribible | nginx no responde |
| Red y seguridad | Puertos escuchando en interfaces públicas (`ss`), UFW, SSH endurecido, días de certificado | Puertos que no sean 22, 80 o 443; certificado < 7 días | UFW inactivo, SSH con contraseña, certificado < 21 días |
| Backups | `last-status`, `last-restic-check`, `last-retention`, `last-drill` | Último backup antiguo (> 26 h) o fallido; revisión, retención o drill fallidos | Sin copia externa o sin backups todavía |
| Timers | Los 5 timers de `servicedesk-*` y las unidades en fallo | Hay alguna unidad en fallo | Algún timer inactivo |
| Logs | logrotate, rotación de Docker, alertas de hoy | — | Hay alertas hoy |

## 2. Vigilancia automática

| Qué | Cuándo | Cómo avisa |
|---|---|---|
| `servicedesk-backup-check.timer` | Cada 6 h | `OnFailure` → `servicedesk-alert@` (journal, log, correo y webhook opcionales) |
| Healthchecks de Docker | Cada 10-15 s | `docker ps` / `server-health.sh`. Docker **no** reinicia por *unhealthy*: lo hace si el proceso muere (`restart: unless-stopped`) |
| Latido externo (`BACKUP_HEARTBEAT_URL`) | Cada backup | El servicio externo avisa si el latido deja de llegar, aunque el servidor entero haya caído |
| Monitor externo de disponibilidad (recomendado) | Cada 1-5 min | Comprobar `https://<dominio>/healthz` (readiness real) desde fuera |

Recomendado: ejecutar `server-health.sh` a diario desde cron o un timer y enviar la salida por correo, o integrarlo con el monitor que use la DTIC. **No** se instala automáticamente.

## 3. Comandos útiles

```bash
docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env ps
docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env logs --tail 100 ticket-service
docker stats --no-stream
curl -s http://127.0.0.1:8080/health/ready        # {"status":"ready", "checks": {...}}
systemctl list-timers 'servicedesk-*'
journalctl -t servicedesk-alert --since -7d
sudo du -sh /var/lib/docker/volumes/servicedesk_*
```

## 4. Endpoints de salud

| Endpoint | Tipo | Comprueba |
|---|---|---|
| `/health` (cada servicio y el gateway) | Liveness | El proceso HTTP responde |
| `/health/ready` (auth, catalog) | Readiness | `SELECT 1` a SQL Server con un límite de 3 s |
| `/health/ready` (ticket) | Readiness | Lo anterior + el volumen de imágenes escribible |
| `/health/ready` (gateway) | Readiness | Los 3 servicios devuelven 200 en su `/health/ready` |
| `https://<dominio>/healthz` | Readiness | El `/health/ready` del gateway a través de nginx |

Las respuestas solo dicen `ok`/`fail` por componente, **sin** detalles internos (ni errores, ni hosts, ni puertos).
