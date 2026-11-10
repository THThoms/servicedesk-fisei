# Recuperación del servidor: qué guía usar

Escrito para: el administrador ante cualquier incidente que afecte al servidor de ServiceDesk.

Este documento solo indica **qué procedimiento** aplicar. Los pasos detallados están en las guías enlazadas.

| Situación | Procedimiento | Guía |
|---|---|---|
| Un contenedor está *unhealthy* o se reinicia | `scripts/operations/server-health.sh` → `docker compose … logs <servicio>`. Si SQL Server cayó, los servicios vuelven solos al recuperarse (probado) | [MONITOREO_SERVIDOR.md](../operations/MONITOREO_SERVIDOR.md) |
| El host se reinicia | Nada: `restart: unless-stopped` + `live-restore` + los timers con `Persistent=true` | — |
| Actualización de la aplicación fallida | Rollback al paquete anterior | [RESTAURACION_Y_ROLLBACK.md §3](../operations/RESTAURACION_Y_ROLLBACK.md) |
| Datos borrados o corruptos, el servidor sigue vivo | Restaurar el último conjunto local, o un snapshot anterior al incidente, con `--replace` | [RESTAURACION_Y_ROLLBACK.md §1](../operations/RESTAURACION_Y_ROLLBACK.md) |
| **Servidor perdido** (disco, proveedor, ataque) | Servidor nuevo + snapshot cifrado + clave de custodia | [RESTAURACION_SERVIDOR_NUEVO.md](../operations/RESTAURACION_SERVIDOR_NUEVO.md) |
| Migración desde el VPS anterior | `install-server.sh --mode restore` desde un backup del VPS (requiere autorización sobre el VPS) | [INSTALACION_SERVIDOR_NUEVO.md §6B](INSTALACION_SERVIDOR_NUEVO.md) |
| Clave Restic perdida o comprometida | Clave del custodio o rotación | [CUSTODIA_CLAVE_BACKUPS.md](../operations/CUSTODIA_CLAVE_BACKUPS.md) |
| Fallo del firewall o de SSH tras instalar | Consola web del proveedor → `ufw disable` o quitar el *drop-in* de SSH | [SEGURIDAD_SERVIDOR.md §2](SEGURIDAD_SERVIDOR.md) |

## Garantías del instalador en modo `restore`

- No crea un administrador inicial; los administradores vienen en el backup.
- **No ejecuta seeds** (`RUN_SEED=false`).
- No restaura encima de bases existentes sin `--replace` y la confirmación `RESTAURAR`.
- Genera **credenciales nuevas** de SQL y JWT; los usuarios de base se remapean a los logins nuevos.
- Verifica el SHA-256, `RESTORE VERIFYONLY`, la versión compatible y `DBCC CHECKDB`. Restaura las imágenes en el volumen nuevo.
- Usa las rutas de datos y log de la instancia nueva, con volúmenes separados.

**Probado en local:**

| Prueba | Resultado |
|---|---|
| Restauración de un conjunto en otro proyecto (Fases P/R/T, simulación de servidor nuevo) | OK |
| Recuperación completa desde un snapshot cifrado con la clave del custodio (Fase S) | 60/60, RTO de 125 s en el laboratorio |
| Ubuntu real | **NOT TESTED** |

## Objetivos

| Objetivo | Valor | Origen |
|---|---|---|
| **RPO** | ≤ 24 h | Backup diario, recovery SIMPLE |
| **RTO** | Minutos en el laboratorio (125 s con bases pequeñas) | [MEDIDO, Fase S] |

Con un servidor real, súmale la preparación del sistema, la descarga de B2 y la reemisión del certificado: del orden de 1-2 horas con el procedimiento documentado [ESTIMADO].
