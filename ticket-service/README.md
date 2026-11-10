# ticket-service

Microservicio de creación y consulta de tickets de soporte. Maneja adjuntos en `/uploads` (volumen Docker `ticket-uploads`).

## Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET    | `/health`              | público | Healthcheck |
| POST   | `/tickets`             | JWT  | Crear ticket (multipart/form-data) |
| GET    | `/tickets`             | JWT  | Tickets del usuario autenticado |
| GET    | `/tickets/:id`         | JWT  | Detalle de un ticket (dueño o staff) |
| POST   | `/routing/assign`      | JWT  | Recalcula y persiste el nivel de un ticket (solo staff) |
| POST   | `/routing/preview`     | JWT  | Calcula el nivel que se asignaría sin persistir |
| GET    | `/uploads/:file`       | JWT  | Servir imagen adjunta |

A través del API Gateway: `/api/tickets/...`.

## Crear ticket (POST /tickets)

Multipart/form-data:

| Campo | Tipo | Requerido | Notas |
|-------|------|-----------|-------|
| `serviceId`    | string (UUID) | sí | ID de servicio del catalog-service |
| `detail`       | string        | sí | 5..5000 chars |
| `priority`     | enum          | no | `baja`, `media`, `alta`, `critica`. Si no se envía, se usa la regla base |
| `attachments`  | file[]        | no | Hasta 5 imágenes JPG/PNG, 5 MB c/u |

Respuesta 201: `{ ticket: { id, number: "TK-YYYYMMDD-NNN", status: "abierto", ... } }`

## Reglas de validación

- Si el servicio no existe en el catálogo → 400.
- Si el servicio no tiene `routingRule` configurada → 400.
- Si un archivo > 5 MB → 413.
- Si > 5 archivos → 400.
- Si tipo MIME no es JPG/PNG → 400.
- Si `serviceId` o `detail` faltan → 400.

## Variables de entorno

- `DATABASE_URL` apuntando a `ticket_db`.
- `JWT_SECRET` (mismo que el auth-service).
- `CATALOG_SERVICE_URL` (interno, p. ej. `http://catalog-service:3002`).
