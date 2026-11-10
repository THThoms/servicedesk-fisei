# nginx y TLS del servidor

Escrito para: el administrador del servidor.

nginx corre en el **host** (paquete de Ubuntu), no en Docker. Termina TLS y pasa el tráfico a los puertos de loopback del gateway y del frontend.

## 1. Plantillas

| Archivo | Cuándo |
|---|---|
| `deploy/nginx/servicedesk-bootstrap-http.conf.template` | Primera vez: solo HTTP y el desafío ACME, para emitir el certificado |
| `deploy/nginx/servicedesk.conf.template` | Con certificado: HTTPS completo |

Marcadores que sustituye el instalador; **ningún dominio está fijo** en el repositorio:

| Marcador | Valor |
|---|---|
| `__SERVER_NAME__` | `PUBLIC_DOMAIN` |
| `__UPSTREAM_GATEWAY__` | `127.0.0.1:GATEWAY_BIND_PORT` |
| `__UPSTREAM_FRONTEND__` | `127.0.0.1:FRONTEND_BIND_PORT` |
| `__CERT_DIR__` | `/etc/letsencrypt/live/<dominio>` |

## 2. Qué hace la configuración HTTPS

| Ruta | Destino | Detalle |
|---|---|---|
| `:80` | `301 → https` | Salvo `/.well-known/acme-challenge/` (renovación) |
| `= /api/auth/login` | gateway | Límite de 10 peticiones/min por IP (ráfaga 5) → 429. Se suma al límite por cuenta de la aplicación |
| `/api/` | gateway | Incluye el callback SSO y las imágenes autenticadas `/api/tickets/:id/attachments/:aid` |
| `= /healthz` | gateway `/health/ready` | Readiness real para monitores externos; sin log |
| `^~ /uploads/` | **404** | Las imágenes nunca se sirven como archivos |
| `/` | frontend | SPA; `/assets/` con caché inmutable (nginx del contenedor) |

**Cabeceras y límites:**
- TLS 1.2 y 1.3.
- HSTS (1 año), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` y `Permissions-Policy`.
- `server_tokens off`.
- `client_max_body_size 30m`: 5 imágenes de 5 MB más el margen multipart.
- Timeouts: proxy de 60 s; cabecera de cliente de 15 s; cuerpo de 60 s; *keepalive* de 65 s.
- gzip para CSS, JS, JSON y SVG.

**WebSocket:** no se usa en la aplicación, así que no se configura.

## 3. Certificado (Let's Encrypt)

**Requisito previo:** el DNS del dominio ya apunta al servidor y el puerto 80 está abierto. **No ejecutes certbot contra un dominio que no controles o que siga en el VPS anterior.**

```bash
# 1) El instalador deja la configuración de arranque (solo HTTP + ACME)
sudo certbot certonly --webroot -w /var/www/certbot -d <dominio> --email <correo-admin> --agree-tos --no-eff-email
# 2) Activar HTTPS con la plantilla completa
sudo scripts/install-server.sh --nginx-tls
# 3) Verificar
sudo nginx -t && curl -sI https://<dominio>/healthz
```

**Renovación:**
- `certbot.timer` de Ubuntu la hace automáticamente. El instalador comprueba que esté activo.
- El *deploy hook* `deploy/certbot/servicedesk-reload-nginx.sh` se instala en `/etc/letsencrypt/renewal-hooks/deploy/` y ejecuta `nginx -t && systemctl reload nginx` tras cada renovación.
- Prueba sin emitir nada: `sudo certbot renew --dry-run`.
- `server-health.sh` avisa si quedan menos de 21 días y falla si quedan menos de 7.

**Permisos:** `/etc/letsencrypt/live` y `archive` son de root y la clave privada tiene modo 600, como deja certbot. **Los certificados no van en el paquete** (el empaquetador excluye `*.pem` y `*.key`) **ni en el backup**: se vuelven a emitir.

## 4. Validación hecha

- `nginx -t` con la plantilla real, nginx 1.28.3, TLS autofirmado y smoke a través de TLS: simulación de las Fases P/R/T.
- `/uploads/` devuelve 404.
- La cabecera HSTS está presente.
- **NOT TESTED:** el nginx 1.24 de Ubuntu real, certbot contra un dominio real y la renovación real.
