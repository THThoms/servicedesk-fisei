# api-gateway

Único punto de entrada al backend del ServiceDesk UTA. Expone el puerto `8080` al host; los demás microservicios solo son accesibles dentro de la red Docker `servicedesk-net`.

## Rutas

| Prefijo | Destino interno | Reescritura |
|---------|-----------------|-------------|
| `/api/auth/**`    | `http://auth-service:3001`    | `/api/auth/x` → `/auth/x` |
| `/api/catalog/**` | `http://catalog-service:3002` | `/api/catalog/x` → `/x` |
| `/api/tickets/**` | `http://ticket-service:3003`  | `/api/tickets/x` → `/tickets/x` |
| `/health`         | local                         | healthcheck del propio gateway |

## Variables de entorno

- `PORT` (default `8080`).
- `AUTH_SERVICE_URL`, `CATALOG_SERVICE_URL`, `TICKET_SERVICE_URL`.
- `FRONTEND_URL` para CORS.

## Notas

- No consumimos `express.json()` antes de los proxies para no romper el body multipart de creación de tickets.
- El gateway NO valida JWT — cada microservicio downstream lo hace. Esto evita acoplar el gateway a la lógica de auth.
