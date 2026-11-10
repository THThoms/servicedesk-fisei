// Variables de entorno para los tests. Se ejecuta antes de cargar módulos
// que leen process.env (como src/config/env.ts).
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-min-32-chars-aaaaaaaaaa";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "1h";
// Sprint F: SQL Server como motor único. DSN dummy — los tests mockean Prisma.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "sqlserver://test:1433;database=test_db;user=test;password=test;encrypt=true;trustServerCertificate=true";
process.env.CATALOG_SERVICE_URL =
  process.env.CATALOG_SERVICE_URL ?? "http://catalog-service:3002";
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";
