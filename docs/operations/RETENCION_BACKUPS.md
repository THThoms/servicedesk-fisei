# Retención de backups

Escrito para: el operador del servidor.

## 1. Política

| Nivel | Se conservan | Variable (`/etc/servicedesk/backup.env`) |
|---|---|---|
| Diaria | Los últimos **14** días con backup (el más reciente de cada día) | `RESTIC_KEEP_DAILY=14` |
| Semanal | Las últimas **8** semanas (el más reciente de cada semana) | `RESTIC_KEEP_WEEKLY=8` |
| Mensual | Los últimos **12** meses (el más reciente de cada mes) | `RESTIC_KEEP_MONTHLY=12` |
| Siempre | El **último** snapshot, pase lo que pase | `--keep-last 1` (fijo) |

Los niveles se solapan: el backup de hoy cuenta como diario, semanal y mensual a la vez. Con un backup diario, el resultado estable son unos **29 snapshots** que cubren un año. En el disco local se conservan además los 3 últimos conjuntos (`BACKUP_LOCAL_KEEP`) para restauraciones rápidas.

La retención agrupa por el nombre lógico del servidor (`RESTIC_SNAPSHOT_HOST`) y por la ruta del snapshot. Si se reinstala el servidor, mantén el **mismo** `RESTIC_SNAPSHOT_HOST` para que el historial siga en el mismo grupo.

## 2. Cómo se aplica

Lo hace `scripts/backup/restic-retention.sh`, que lanza `servicedesk-backup-retention.timer` cada domingo a las 04:30. **Antes** de tocar nada comprueba lo siguiente; si algo falla, **no aplica la política** y salta la alerta:

1. El repositorio es accesible y `restic check` (estructura) es correcto.
2. Hay snapshots de ServiceDesk.
3. El último tiene **menos de 26 h** y está **completo** (`manifest.json`, `SHA256SUMS` y las 3 bases).

Después ejecuta `restic forget` con la política y `--prune` (libera el espacio de los datos que ya no usa ningún snapshot), y **verifica** el resultado: el último snapshot sigue existiendo, el número de snapshots es coherente y `restic check` vuelve a pasar.

Nunca se borra nada a mano en el bucket. Las versiones que `prune` oculta en B2 se conservan 30 días más por la regla del bucket ([CONFIGURACION_BACKBLAZE.md §3](CONFIGURACION_BACKBLAZE.md)).

## 3. Comandos

```bash
sudo scripts/backup/restic-retention.sh --dry-run     # qué se olvidaría, sin cambiar nada
sudo scripts/backup/restic-retention.sh --prune       # aplicar ahora (lo mismo que el timer)
sudo scripts/backup/restic-retention.sh --prune --allow-stale   # solo tras una parada larga conocida: sin backup reciente
sudo scripts/backup/restic-restore.sh --list          # snapshots que quedan
```

## 4. Prueba realizada (Fase S, laboratorio)

En un repositorio de prueba se crearon **400 snapshots diarios** con fechas reales hacia atrás (de diciembre de 2025 a noviembre de 2026) y se aplicó la política:

| Comprobación | Resultado |
|---|---|
| Snapshots tras la retención | 400 → **29** |
| Hay un snapshot de cada uno de los últimos 14 días | Sí |
| Hay uno de cada una de las últimas 8 semanas | Sí |
| Hay uno de cada uno de los últimos 12 meses | Sí |
| Snapshots de hace más de 12 meses | 0 |
| El último snapshot se conserva | Sí |
| Último snapshot antiguo (más de 26 h) | **No se aplica** la retención |
| Último snapshot incompleto (sin bases) | **No se aplica** la retención |

## 5. Cambiar la política

Edita las tres variables en `/etc/servicedesk/backup.env` y comprueba primero con `--dry-run`. **Ampliar** la retención es inmediato y seguro. **Reducirla** borra historial de forma definitiva (salvo la ventana de versiones de B2): requiere la aprobación del responsable del proyecto.
