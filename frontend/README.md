# frontend

Aplicación React + Vite + Tailwind del ServiceDesk UTA. Toda comunicación con el backend pasa por el API Gateway (`http://localhost:8080`).

## Páginas (Sprint 1)

| Ruta | Acceso | Descripción |
|------|--------|-------------|
| `/login`            | público | Botón "Iniciar sesión con Microsoft" + dev-login condicional |
| `/auth/callback`    | público | Recibe el JWT del backend y redirige según rol |
| `/tickets/nuevo`    | autenticado | Formulario de ticket con drag & drop de imágenes |
| `/admin/catalogo`   | rol `admin` | CRUD del catálogo de servicios |

## Variables de entorno (build-time)

Vite incrusta `VITE_API_URL` en el bundle al hacer `npm run build`. En Docker se pasa como build-arg desde `docker-compose.yml`.

| Variable | Default | Notas |
|----------|---------|-------|
| `VITE_API_URL` | `http://localhost:8080` | URL pública del API Gateway |

## Desarrollo local

```bash
npm install
npm run dev   # http://localhost:3000
```

Asegúrate de que el API Gateway esté corriendo en `http://localhost:8080`.

## Paleta institucional UTA

| Token Tailwind | Hex | Uso |
|----------------|-----|-----|
| `uta-50`  | `#FEF2F2` | Fondo de contenido |
| `uta-100` | `#FEE2E2` | Bordes suaves, hover |
| `uta-300` | `#FCA5A5` | Bordes de inputs |
| `uta-500` | `#DC2626` | Botones primarios |
| `uta-700` | `#991B1B` | Subnav |
| `uta-900` | `#5C0A0A` | Barra superior, foot |
| `ok-50` / `ok-900` | `#D1FAE5` / `#14532D` | Badges de estado |
