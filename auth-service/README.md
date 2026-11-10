# auth-service

Microservicio de autenticación SSO con Microsoft Azure AD para ServiceDesk UTA. Emite JWT propios validados por el resto de microservicios.

## Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET    | `/health`                    | público | Healthcheck |
| GET    | `/auth/config`               | público | Métodos de login habilitados (SSO / dev-login) |
| GET    | `/auth/microsoft`            | público | Redirige al login de Microsoft (MSAL) |
| GET    | `/auth/microsoft/callback`   | público | Callback de Azure AD; valida tenant `@uta.edu.ec`, emite JWT y redirige al frontend |
| POST   | `/auth/dev-login`            | público (solo si `AUTH_DEV_LOGIN=true`) | Emite JWT para un usuario sembrado, sin pasar por Microsoft |
| GET    | `/auth/me`                   | JWT | Devuelve datos del usuario autenticado |
| POST   | `/auth/logout`               | JWT | Revoca la sesión activa |
| POST   | `/auth/verify`               | JWT | Validación interna usada por otros microservicios |

A través del API Gateway: prefijo `/api/auth/...` (p. ej. `http://localhost:8080/api/auth/microsoft`).

## Variables de entorno

Ver `.env.example` raíz. Requiere:

- `DATABASE_URL` — apuntando a `auth_db`.
- `JWT_SECRET`, `JWT_EXPIRES_IN`.
- `AZURE_AD_CLIENT_ID`, `AZURE_AD_TENANT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_REDIRECT_URI`.
- `ALLOWED_DOMAIN` (default `uta.edu.ec`).
- `FRONTEND_URL` para los redirects post-login.

## Configuración Azure AD

1. Portal Azure → Azure AD → App registrations → New registration.
2. Redirect URI (Web): `http://localhost:8080/api/auth/microsoft/callback`.
3. Certificates & secrets → New client secret.
4. API permissions → Microsoft Graph → `openid`, `profile`, `email`, `User.Read`.

## Roles

`admin`, `tech_n1`, `tech_n2`, `tech_n3`, `tech_n4`, `user`. Los nuevos usuarios se crean con rol `user`; los demás se asignan manualmente vía SQL/admin panel.

## Desarrollo local

```bash
npm install
npx prisma migrate dev
npm run dev
```
