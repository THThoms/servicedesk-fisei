# Conectar los backups a Backblaze B2

Escrito para: el administrador que dará de alta el almacenamiento externo, con acceso a la cuenta de Backblaze y root en el servidor.

> **Estado:** nada de esto se ha hecho todavía. La integración S3 se probó con MinIO en laboratorio (Fase S). **Hasta completar esta guía y ver un snapshot verificado en B2, los backups externos NO están activos.**

Se usa la **API compatible con S3** de B2: Restic recomienda su backend S3 para B2. Restic cifra todo **antes** de enviarlo, así que Backblaze solo recibe datos cifrados.

## Dos secretos distintos

| Secreto | Para qué | Dónde vive | Si se pierde |
|---|---|---|---|
| **Application Key de B2** (keyID + applicationKey) | Leer y escribir en el bucket | `/etc/servicedesk/backup.env` (600) | Se crea otra en B2; los backups siguen intactos |
| **Clave Restic** | Descifrar los backups | `/etc/servicedesk/restic.pass` (600) **y** custodia fuera del servidor | Si se pierden **todas** las copias, los backups son **irrecuperables** |

No uses nunca el mismo valor para ambos, ni los guardes juntos fuera del servidor.

## 1. Crear el bucket privado

En la consola de Backblaze: **B2 Cloud Storage → Buckets → Create a Bucket**.

- **Nombre:** único en todo B2, por ejemplo `uta-fisei-servicedesk-backups-prod`. No reutilices un bucket de otro sistema.
- **Files in Bucket are:** **Private**. Nunca Public.
- **Default Encryption:** puedes activar el cifrado del lado de B2 (SSE-B2). Es una capa adicional; la protección real es el cifrado de Restic.
- **Object Lock:** desactivado. `restic prune` necesita borrar objetos; la inmutabilidad exige otro diseño. Ver §8.

## 2. Región y endpoint

La región se elige al crear la **cuenta** de Backblaze. En el detalle del bucket aparece el **Endpoint** S3, con la forma `s3.<región>.backblazeb2.com`.

**Copia el valor exacto** que muestra la consola. No lo deduzcas ni uses uno de un ejemplo.

## 3. Reglas de ciclo de vida (Lifecycle Settings)

Cuando Restic borra algo (`prune`), B2 lo **oculta** y conserva versiones anteriores según la regla del bucket. Configúralo así:

- **Recomendado:** *Keep prior versions for this number of days* = **30**. Deja 30 días para recuperar algo borrado por error o por un atacante, y después libera espacio.
- **Prohibido:** cualquier regla que **borre archivos vigentes por antigüedad**. Restic reutiliza paquetes antiguos en snapshots nuevos, y una regla así destruiría backups válidos sin aviso.

## 4. Application Key limitada al bucket

En **Application Keys → Add a New Application Key**:

- **Name:** `servicedesk-restic-prod`, una clave distinta por entorno.
- **Allow access to Bucket(s):** **solo** el bucket del paso 1. Nunca *All*.
- **Type of Access:** **Read and Write**. Restic necesita listar, leer, escribir y borrar dentro del bucket.
- **File name prefix:** opcional (`servicedesk/`).
- **No** uses la *Master Application Key* de la cuenta.

B2 muestra el **keyID** y la **applicationKey** **una sola vez**. Pégalos directamente en el servidor (paso 5): nunca por chat, correo ni tickets.

## 5. Configurar el servidor

```bash
sudo install -d -m 700 /etc/servicedesk
sudo test -f /etc/servicedesk/backup.env || sudo install -m 600 /opt/servicedesk/deploy/backup/backup.env.example /etc/servicedesk/backup.env
sudo nano /etc/servicedesk/backup.env
```

Rellena (los valores entre `< >` salen de la consola de B2):

```ini
RESTIC_REPOSITORY=s3:https://<Endpoint del paso 2>/<bucket>/servicedesk
AWS_ACCESS_KEY_ID=<keyID>
AWS_SECRET_ACCESS_KEY=<applicationKey>
B2_REGION=<región, tal como aparece en el endpoint>
RESTIC_PASSWORD_FILE=/etc/servicedesk/restic.pass
RESTIC_SNAPSHOT_HOST=servicedesk-prod
```

Los scripts exigen `https://` y permisos 600 en `backup.env` y en la clave; si no se cumplen, se niegan a ejecutarse.

## 6. Generar la clave Restic y ponerla en custodia

```bash
cd /opt/servicedesk
sudo scripts/backup/restic-init.sh --generate-password      # 64 caracteres aleatorios, 600, no se muestra
```

**Antes de seguir**, haz la custodia: copia del servidor a la custodia principal y clave independiente del custodio de recuperación. Ver [CUSTODIA_CLAVE_BACKUPS.md §2-3](CUSTODIA_CLAVE_BACKUPS.md).

## 7. Inicializar y verificar el repositorio

```bash
sudo scripts/backup/restic-test-connection.sh   # esperado: código 10 "accesible pero NO inicializado"
sudo scripts/backup/restic-init.sh              # crea el repositorio cifrado (v2, con compresión)
sudo scripts/backup/restic-test-connection.sh   # esperado: ✔ Conexión correcta … snapshots: 0
```

Si la prueba de conexión falla, el motivo aparece entre corchetes:

| Código | Qué revisar |
|---|---|
| `E_REPO_CREDENTIALS` | keyID o applicationKey incorrectos, o la clave no tiene acceso a ese bucket |
| `E_REPO_UNREACHABLE` | Endpoint mal copiado, DNS o salida HTTPS (443) bloqueada |
| `E_REPO_TLS` | Certificado: hora del servidor desajustada o un proxy que intercepta TLS |
| `E_REPO_PASSWORD` | La clave Restic no corresponde a este repositorio |

## 8. Primer backup y verificación

```bash
sudo systemctl start servicedesk-backup.service
sudo journalctl -u servicedesk-backup -n 60 --no-pager   # esperado: "snapshot verificado" y "Backup completo"
sudo cat /var/backups/servicedesk/last-status            # status=OK
sudo scripts/backup/restic-restore.sh --list             # el snapshot aparece
sudo scripts/backup/restic-check.sh --full               # lee y descifra todo (la primera vez)
```

## 9. Probar la restauración (obligatorio antes de declarar activos los backups)

```bash
sudo scripts/backup/restore-drill.sh
```

Esperado: `RESTORE DRILL PASS` y el informe en `/var/backups/servicedesk/drills/`. Solo entonces los backups externos pueden darse por **activos y verificados**. Anota la fecha en el registro de custodia.

Prueba también la clave del custodio desde su propio equipo: [CUSTODIA_CLAVE_BACKUPS.md §6](CUSTODIA_CLAVE_BACKUPS.md).

## 10. Recomendaciones

- **Latido externo:** configura `BACKUP_HEARTBEAT_URL` (healthchecks.io o el monitor que use la UTA). Si el servidor entero cae, el servicio externo avisa porque deja de recibir el latido. Ver [ALERTAS_BACKUPS.md](ALERTAS_BACKUPS.md).
- **Coste:** cada restore drill mensual descarga el snapshot completo. Revisa la tarifa de descarga (*egress*) vigente de B2. Si el volumen crece mucho, usa `DRILL_MODE=instance` o un drill trimestral.
- **Inmutabilidad (mejora futura):** contra un atacante con root en el servidor, que tendría la Application Key, la defensa es la regla de versiones del §3 (30 días) más el latido externo. Si se quiere más protección, se puede añadir una segunda Application Key sin permiso de borrado, junto con *Object Lock*, como proyecto aparte.
