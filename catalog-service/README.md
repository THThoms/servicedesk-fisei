# catalog-service

Catálogo de servicios institucionales (UTA) y reglas de enrutamiento por nivel técnico.

## Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET    | `/health`             | público | Healthcheck |
| GET    | `/services`           | público | Lista de servicios activos (combobox del formulario de tickets) |
| GET    | `/services/:id`       | público | Detalle de un servicio (usado por ticket-service) |
| POST   | `/services`           | admin  | Crear servicio |
| PATCH  | `/services/:id`       | admin  | Actualizar servicio |
| DELETE | `/services/:id`       | admin  | Soft delete (`is_active = false`) |

A través del API Gateway: `/api/catalog/services/...`.

## Variables de entorno

- `DATABASE_URL` apuntando a `catalog_db`.
- `JWT_SECRET` (mismo que el auth-service).

## Datos iniciales (seed)

| Servicio | Nivel |
|----------|-------|
| Internet / Conectividad | N3 |
| Correo Electrónico | N2 |
| Equipos / Hardware | N1 |
| Software Institucional | N2 |
| MOODLE | N3 |
| Calificaciones (SGA) | N3 |
