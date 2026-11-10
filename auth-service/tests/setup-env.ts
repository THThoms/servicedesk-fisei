// Variables de entorno para los tests. Se ejecuta antes de cargar módulos que
// leen process.env (como src/config/env.ts, que requiere JWT_SECRET).
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-min-32-chars-aaaaaaaaaa";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "1h";
// Sprint F: SQL Server es el motor único del runtime. Este DSN no se conecta
// realmente (los tests mockean Prisma), pero se actualiza para paridad con el
// stack productivo MSSQL. Ningún test lo usa para abrir conexión.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "sqlserver://test:1433;database=test_db;user=test;password=test;encrypt=true;trustServerCertificate=true";
process.env.ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN ?? "uta.edu.ec";
process.env.AUTH_DEV_LOGIN = process.env.AUTH_DEV_LOGIN ?? "true";
// Fase P: el login Microsoft simulado ahora es opt-in explícito (y nunca en
// NODE_ENV=production). Los tests existentes del flujo simulado lo activan aquí.
process.env.AUTH_MICROSOFT_SIMULATE = process.env.AUTH_MICROSOFT_SIMULATE ?? "true";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS ?? "admin@uta.edu.ec";
