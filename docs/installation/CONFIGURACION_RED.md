# Configuración de red del servidor

Escrito para: el administrador del servidor y de la red de la UTA.

## 1. Zonas

| Zona | Qué contiene | Entrada | Salida a Internet |
|---|---|---|---|
| **Pública (host)** | nginx del host | 80 y 443 desde Internet; 22 para SSH | Sí: ACME y actualizaciones |
| **edge** (Docker) | frontend, api-gateway | Solo desde nginx del host, vía `127.0.0.1:3000` y `127.0.0.1:8080` | Sí (red estándar) |
| **app** (Docker) | api-gateway, auth, catalog, ticket | Solo desde el gateway | Sí: Microsoft SSO, SMTP, FCM |
| **data** (Docker, `internal: true`) | mssql + los 3 microservicios | Solo desde los microservicios | **No** |

| Quién | Qué puede alcanzar |
|---|---|
| Frontend | **Nada interno**: no ve a los microservicios ni a SQL Server |
| Gateway | Los microservicios; **no** ve SQL Server |
| SQL Server | Sin salida a Internet y sin puerto publicado |

Las cuatro restricciones se verifican en la simulación de la Fase T.

## 2. Puertos

| Puerto | Escucha en | Abierto en UFW | Uso |
|---|---|---|---|
| 22/tcp | 0.0.0.0 | Sí (si es posible, restringido a la red de la UTA) | SSH con clave |
| 80/tcp | 0.0.0.0 (nginx) | Sí | Redirección a HTTPS y desafío ACME |
| 443/tcp | 0.0.0.0 (nginx) | Sí | Aplicación |
| 8080/tcp | **127.0.0.1** (Docker) | No | api-gateway |
| 3000/tcp | **127.0.0.1** (Docker) | No | frontend |
| 1433/tcp | **No se publica** | No | SQL Server, solo en la red `data` |

Si 8080 o 3000 están ocupados en el host, cambia `GATEWAY_BIND_PORT` / `FRONTEND_BIND_PORT` en `deploy/server/.env`; el instalador ajusta nginx.

## 3. UFW

El instalador (`scripts/install-server.sh`, sección 3b) aplica estas reglas, salvo con `--skip-firewall`. Antes pide confirmación.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp          # o el puerto SSH real: --ssh-port N (no se inventa ninguno)
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

**Para no bloquear el acceso administrativo:**
- Ejecuta el instalador desde una sesión SSH abierta y **no la cierres** hasta comprobar desde **otra** terminal que entras: `ssh usuario@servidor`.
- Si el proveedor tiene firewall propio (*security groups*), ábrele también 22, 80 y 443.
- Ten a mano la **consola web** del proveedor (VNC/serial): sirve para entrar aunque SSH o UFW fallen. Recuperación: `ufw disable` desde esa consola.

## 4. Docker frente a UFW: lo que UFW NO protege

Docker inserta sus propias reglas de iptables (cadenas `DOCKER` / `DOCKER-USER`, DNAT en `PREROUTING`). Esas reglas se procesan **antes** que las de UFW. Por tanto, **un puerto publicado como `-p 8080:8080` (0.0.0.0) queda accesible desde Internet aunque UFW lo deniegue.** Eso le pasaba al VPS anterior con 8080 y 3000.

Defensa en el servidor nuevo:
1. Todos los puertos se publican **solo en `127.0.0.1`**. SQL Server no publica ninguno.
2. `server-health.sh` falla si algún contenedor del proyecto publica en `0.0.0.0` o `::`, o si hay puertos escuchando en interfaces públicas que no sean 22, 80 o 443.
3. **Docker Engine ≥ 28.** El `daemon.json` desactiva `userland-proxy`. Con Docker anterior a la 28, esa combinación podía dejar alcanzables desde la **red local** los puertos publicados en 127.0.0.1 (`route_localnet`). Docker 28 añadió reglas que lo impiden. El instalador avisa si la versión es menor.

**Cómo comprobarlo:**

```bash
# 1) Qué escucha en interfaces públicas (esperado: solo 22, 80, 443)
sudo ss -tlnp | awk '$4 !~ /^(127\.|\[::1\])/'
# 2) Qué publica Docker (esperado: 127.0.0.1:8080 y 127.0.0.1:3000; nada para mssql)
docker ps --format '{{.Names}}\t{{.Ports}}'
# 3) Reglas de UFW
sudo ufw status verbose
# 4) DESDE OTRO EQUIPO (fuera del servidor): solo 22, 80 y 443 abiertos
nmap -Pn -p 22,80,443,1433,3000,8080 <IP_PUBLICA>
# 5) Resumen automático
sudo scripts/operations/server-health.sh
```

La comprobación definitiva es la **4**: escanear desde fuera. Las demás miran el servidor desde dentro.

## 5. DNS y dominio

- Un registro **A** (y AAAA si hay IPv6) del dominio elegido hacia la IP del servidor.
- El dominio se define **solo** en `PUBLIC_DOMAIN` (`deploy/server/.env`). De ahí salen nginx, `FRONTEND_URL`, CORS, `VITE_API_URL` del frontend web y la Redirect URI esperada del SSO.
- **No se modifica el DNS del dominio actual** mientras el servidor anterior siga en servicio.
