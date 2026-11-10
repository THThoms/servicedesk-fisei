# Custodia de la clave de cifrado de los backups

Escrito para: el responsable del proyecto y la persona designada como custodio de recuperación.

**Por qué importa:** los backups en Backblaze están cifrados con Restic. **Sin una clave válida son irrecuperables**: ni Backblaze, ni la UTA, ni el equipo de desarrollo pueden descifrarlos. Si la clave solo existe en el servidor y el servidor se pierde, los backups se pierden con él.

## 1. Roles

| Rol | Quién | Qué custodia |
|---|---|---|
| **Responsable principal** | Propietario o administrador autorizado del proyecto (a designar por la UTA) | Copia de la clave del servidor + acceso a la consola de Backblaze |
| **Responsable de recuperación** | Segundo custodio autorizado, otra persona (a designar) | Su **propia clave independiente** del repositorio |

Registra en el acta de entrega los nombres, la fecha y la ubicación de cada copia, **nunca** la clave.

## 2. Cómo funcionan las claves de Restic

Un repositorio Restic admite **varias claves**. Cada una abre por separado la clave maestra interna, así que el servidor y cada custodio tienen claves **distintas** y se revocan por separado:

```text
            ┌── clave del servidor     /etc/servicedesk/restic.pass (600)
repositorio ┼── clave del custodio 1   gestor de contraseñas del responsable principal
            └── clave del custodio 2   gestor de contraseñas del responsable de recuperación
```

Todo se gestiona con `scripts/backup/restic-keys.sh`, que **nunca** muestra claves.

## 3. Generación y alta (una vez, al configurar B2)

1. **Clave del servidor:** `sudo scripts/backup/restic-init.sh --generate-password` (64 caracteres aleatorios, permisos 600, no se muestra).
2. **Copia de la clave del servidor para la custodia principal.** El responsable la lee **una vez**, en una sesión SSH propia, directamente hacia su gestor de contraseñas (Bitwarden, KeePassXC, 1Password…):
   ```bash
   sudo cat /etc/servicedesk/restic.pass; echo
   ```
   No la copies a archivos, chats, correos ni capturas. Limpia la terminal después (`clear`).
3. **Clave independiente del responsable de recuperación.** La genera **él mismo** en su gestor (al menos 32 caracteres), la deja en un archivo temporal en el servidor con permisos 600 y la registra:
   ```bash
   sudo install -m 600 /dev/null /root/custodio.pass && sudo nano /root/custodio.pass   # pega la clave
   sudo scripts/backup/restic-keys.sh add --new-password-file /root/custodio.pass --user custodio-recuperacion
   sudo shred -u /root/custodio.pass
   sudo scripts/backup/restic-keys.sh list      # aparecen la clave del servidor y la del custodio
   ```
4. **Segunda copia de respaldo** (recomendada): un sobre cerrado con la clave impresa, en una caja fuerte institucional, o un USB cifrado en otro edificio, bajo la responsabilidad del principal. Debe estar en una ubicación física distinta del servidor y de la primera copia.

Probado en laboratorio (Fase S): la clave del custodio abre el repositorio y permite recuperar el sistema completo sin la clave del servidor.

## 4. Reglas

- La clave **no** se guarda en Git, en `deploy/server/.env`, en el propio repositorio de backups, en tickets, en chats ni en correos sin cifrar.
- **No** se pide ni se comparte por chat. Nadie del equipo de desarrollo necesita conocerla.
- Las credenciales de B2 (Application Key) son **otro** secreto y no se guardan junto a la clave Restic.
- Los scripts nunca la imprimen ni la pasan por la línea de comandos: se monta como archivo de solo lectura.

## 5. Recuperación con la clave del custodio (servidor perdido)

En el servidor nuevo, sigue [RESTAURACION_SERVIDOR_NUEVO.md](RESTAURACION_SERVIDOR_NUEVO.md). El custodio crea `/etc/servicedesk/restic.pass` (600) con **su** clave. Funciona exactamente igual que la del servidor. Cuando el sistema esté recuperado, rota la clave del servidor (§7).

## 6. Prueba periódica (cada 6 meses y cuando cambie un custodio)

Cada custodio comprueba que **su** clave sigue abriendo el repositorio, sin restaurar nada:

```bash
sudo install -m 600 /dev/null /root/k.pass && sudo nano /root/k.pass   # pega la clave del custodio
sudo scripts/backup/restic-keys.sh verify --password-file /root/k.pass   # ✔ La clave abre el repositorio
sudo shred -u /root/k.pass
```

Anota la fecha y el resultado en el registro. Si falla, da de alta una clave nueva para ese custodio (§3.3) **ese mismo día**.

## 7. Rotación

| Situación | Acción |
|---|---|
| Rotación programada (anual) o tras un incidente en el servidor | `sudo scripts/backup/restic-keys.sh rotate-server-key`: crea una clave nueva del servidor, comprueba que abre el repositorio, la instala y **revoca** la anterior. Después, el responsable principal actualiza su copia (§3.2) |
| Un custodio deja el cargo | `restic-keys.sh list` → `restic-keys.sh remove <id de su clave>` → alta del nuevo custodio (§3.3) |
| Sospecha de que una clave se ha filtrado | Revocar esa clave (`remove`) y rotar la del servidor. Los datos ya subidos siguen cifrados con la misma clave maestra: si el atacante pudo **descargar el repositorio y conocer una clave válida**, la única protección completa es crear un repositorio nuevo, hacer un backup completo y, tras verificarlo, retirar el antiguo |

`rotate-server-key` no puede revocar la clave en uso por error: `remove` se niega a eliminarla.

## 8. Pérdida de claves

| Se pierde | Consecuencia | Qué hacer |
|---|---|---|
| La clave del servidor (disco dañado) | Ninguna para los datos | Restaurar con la clave de un custodio; después `rotate-server-key` |
| La clave de un custodio | Ninguna | Revocarla (`remove`) y dar de alta una nueva |
| **Todas** las claves | **Backups irrecuperables** | No hay recuperación posible. Mientras el servidor exista: crear de inmediato un repositorio nuevo con claves nuevas y custodia correcta |
