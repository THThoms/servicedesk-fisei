// Variables de entorno para los tests del catalog-service.
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-min-32-chars-aaaaaaaaaa";
// Sprint F: SQL Server como motor único. DSN dummy — los tests mockean Prisma.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "sqlserver://test:1433;database=test_catalog_db;user=test;password=test;encrypt=true;trustServerCertificate=true";
