# Gestión de usuarios y roles

Escrito para: el administrador del servidor.

## Roles oficiales (Fase R)

| Rol | Área | Qué puede hacer |
|---|---|---|
| `user` | — | Crear tickets y ver o validar solo los suyos |
| `technician` | **Técnicos** (TECHNICIANS) | Atender los tickets de su área |
| `dtic` | **DTIC** | Atender los tickets de su área. **No es administrador** |
| `admin` | Ambas | Administración general |

Un técnico **no ve** los tickets, el historial ni las imágenes de la otra área, salvo el ticket que tenga asignado. El control se hace en el backend.

**Limitación de la aplicación:** no hay pantalla ni API para crear usuarios o cambiar roles. Los usuarios entran por Microsoft SSO con rol `user`; los correos de `ADMIN_EMAILS` reciben `admin` en su primer acceso. Mientras no exista esa pantalla, se usa `scripts/operations/manage-user.sh`. Se ejecuta desde `/opt/servicedesk` y no requiere SQL a mano.

## Administrador inicial (bootstrap seguro)

Lo ejecuta el instalador en modo limpio. A mano:

```bash
sudo scripts/operations/manage-user.sh bootstrap-admin admin.servicedesk@uta.edu.ec "Administración ServiceDesk"
sudo cat deploy/server/.initial-admin-secret          # contraseña TEMPORAL: léela una vez
sudo shred -u deploy/server/.initial-admin-secret     # y bórrala
```

- Solo funciona si **no existe ningún administrador**: nunca crea un segundo admin automáticamente (código 3).
- La contraseña temporal es aleatoria. En la base solo se guarda su hash bcrypt; **no se muestra en pantalla, ni en logs, ni en variables de entorno**.
- El primer inicio de sesión **obliga a cambiarla** (pantalla "Cambia tu contraseña"). Hasta entonces, el resto de la aplicación responde 403.
- Con SSO configurado: `bootstrap-admin <correo> "<Nombre>" --sso-only` crea la cuenta sin contraseña local.

## Operaciones habituales

```bash
# Asignar un rol a alguien que ya entró una vez con Microsoft (revoca sus sesiones)
sudo scripts/operations/manage-user.sh set-role ana.perez@uta.edu.ec dtic
sudo scripts/operations/manage-user.sh set-role luis.mora@uta.edu.ec technician

# Crear una cuenta solo-SSO por adelantado
sudo scripts/operations/manage-user.sh create ana.perez@uta.edu.ec dtic "Ana Pérez"

# Crear una cuenta con contraseña local (la pide sin mostrarla)
sudo scripts/operations/manage-user.sh create soporte@uta.edu.ec technician "Soporte FISEI" --password

# Recuperar el acceso de una cuenta: contraseña temporal nueva + cambio obligatorio
sudo scripts/operations/manage-user.sh reset-password soporte@uta.edu.ec
sudo cat deploy/server/.reset-password-secret && sudo shred -u deploy/server/.reset-password-secret

# Ver el personal (sin correos)
sudo scripts/operations/manage-user.sh list-staff
```

`set-role` **revoca las sesiones** del usuario, así que el rol nuevo se aplica en su próximo inicio de sesión. Se aceptan los nombres antiguos (`tech_n1`…`tech_n4`) como alias.

Política de contraseña: ≥ 12 caracteres, con mayúscula, minúscula, número y símbolo.

## Protección del inicio de sesión

- 5 fallos seguidos sobre una cuenta producen un enfriamiento de 1, 2, 4… minutos (máximo 15). Nunca hay bloqueo permanente, y un acceso correcto reinicia el contador.
- 20 fallos desde una misma IP en 15 minutos bloquean esa IP durante 15 minutos.
- El mensaje es el mismo exista o no la cuenta.
- Los eventos quedan en el log de auth-service como `[security] {...}`, con el correo enmascarado y sin contraseñas ni tokens: `docker compose … logs auth-service | grep '\[security\]'`.

## Cuentas demo

Las cuentas de prueba del laboratorio **no se crean** en producción: el seed solo las carga con `SEED_DEMO_USERS=true` **y** `NODE_ENV≠production`, y sus datos no forman parte de este paquete.
