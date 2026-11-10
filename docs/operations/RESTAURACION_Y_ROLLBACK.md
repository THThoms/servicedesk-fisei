# Restauración y rollback

Escrito para: el operador del servidor ante una pérdida de datos, una migración o una actualización fallida.

Si el servidor original **ya no existe**, sigue [RESTAURACION_SERVIDOR_NUEVO.md](RESTAURACION_SERVIDOR_NUEVO.md). Para restaurar desde un snapshot cifrado (más antiguo que los 3 conjuntos locales), primero recupera los archivos con `sudo scripts/backup/restic-restore.sh --snapshot <id> --target /root/restore/sd` y usa ese directorio como `--from`.

## 1. Restaurar en el MISMO servidor (desastre parcial)

Desde `/opt/servicedesk`, como root. **Es destructivo**: sobrescribe las bases actuales.

```bash
# 0. Backup de lo que hay ahora, por si acaso
systemctl start servicedesk-backup.service

# 1. Validar el backup elegido sin tocar nada
scripts/restore-mssql.sh --from /var/backups/servicedesk/sets/<ID> --dry-run

# 2. Parar la aplicación (SQL Server sigue en marcha)
docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env stop auth-service catalog-service ticket-service api-gateway frontend

# 3. Restaurar bases + imágenes (pide escribir RESTAURAR)
scripts/restore-mssql.sh --from /var/backups/servicedesk/sets/<ID> --replace --with-uploads

# 4. Arrancar SIN seed y comprobar
RUN_SEED=false docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env up -d
scripts/operations/smoke-server.sh
```

Qué hace `restore-mssql.sh`: verifica SHA-256 y `RESTORE VERIFYONLY`, comprueba que la versión del backup sea compatible, restaura con `MOVE` a las rutas estándar, ejecuta `DBCC CHECKDB`, re-mapea los usuarios de base a los logins de **este** servidor (`mssql-init`) y muestra los conteos.

## 2. Simulacro de recuperación

Automático cada mes: `servicedesk-restore-drill.timer` → `scripts/backup/restore-drill.sh` restaura el último snapshot cifrado en un SQL Server temporal y compara conteos, relaciones e imágenes ([BACKUPS_MSSQL.md §4](BACKUPS_MSSQL.md)). Simulacro **completo** de la aplicación (manual, cada trimestre):

Restaura en un **proyecto Docker aislado**, sin tocar producción. En el mismo servidor, si hay RAM (unos 2 GB extra), o en otro:

```bash
mkdir -p /opt/servicedesk-drill && tar -xzf servicedesk-uta-server-<VERSION>.tar.gz -C /opt/servicedesk-drill --strip-components=1
cd /opt/servicedesk-drill
cp /opt/servicedesk/deploy/server/.env deploy/server/.env
sed -i 's/^GATEWAY_BIND_PORT=.*/GATEWAY_BIND_PORT=48080/; s/^FRONTEND_BIND_PORT=.*/FRONTEND_BIND_PORT=43000/' deploy/server/.env
scripts/install-server.sh --mode restore --from /var/backups/servicedesk/sets/<ID> --project sddrill --skip-nginx --skip-systemd --yes
# … comprobar conteos y smoke …
docker compose -p sddrill -f deploy/server/compose.yaml --env-file deploy/server/.env down -v   # borra SOLO el simulacro
```

Así se probó en la Fase P (proyectos `sdsimclean` y `sdsimrestore`).

## 3. Rollback de una actualización de la aplicación

Antes de actualizar: `systemctl start servicedesk-backup.service` y conserva el paquete anterior.

```bash
# Volver al código anterior
cd /opt && mv servicedesk servicedesk-fallido && mkdir servicedesk
tar -xzf servicedesk-uta-server-<VERSION_ANTERIOR>.tar.gz -C servicedesk --strip-components=1
cp servicedesk-fallido/deploy/server/.env servicedesk/deploy/server/.env
cp servicedesk-fallido/deploy/server/.install-state* servicedesk/deploy/server/ 2>/dev/null || true
cd servicedesk && RUN_SEED=false docker compose -p servicedesk -f deploy/server/compose.yaml --env-file deploy/server/.env up -d --build
scripts/operations/smoke-server.sh
```

Los volúmenes (`servicedesk_*`) no cambian. Si la versión fallida modificó el esquema, restaura además el backup previo (§1). Con `PRISMA_ACCEPT_DATA_LOSS=false`, un cambio de esquema destructivo **no** se aplica: el servicio no arranca y el log de `prisma db push` lo indica.

## 4. Rollback de la migración desde el VPS anterior

Mientras el DNS apunte al VPS anterior, este sigue siendo producción, así que no hay nada que deshacer. Si ya se cambió el DNS y hay que volver:

1. Restablece el registro DNS a la IP anterior.
2. Los datos creados en el servidor nuevo **no** existen en el VPS anterior. Antes de volver, haz un backup del nuevo y decide si hay que trasladarlos.
3. No borres el servidor nuevo ni sus volúmenes hasta cerrar la decisión.

## 5. Nunca

- `docker compose down -v` sobre el proyecto de producción.
- `docker volume rm servicedesk_mssql-data` o `servicedesk_ticket-uploads`.
- `DROP DATABASE` o `TRUNCATE` como "solución".
- Restaurar con `RUN_SEED=true`.
