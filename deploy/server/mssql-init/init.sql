-- =============================================================================
-- ServiceDesk UTA — bootstrap idempotente (servidor nuevo)
--   · Crea auth_db / catalog_db / ticket_db si no existen.
--   · Crea cada login, o SINCRONIZA su contraseña con .env (rotación segura).
--   · Crea el usuario de base, o lo RE-MAPEA al login (usuarios huérfanos tras
--     un RESTORE desde otro servidor: el SID del login cambia).
--   · Cada login es db_owner SOLO de su propia base (Prisma db push necesita DDL).
--   · RECOVERY SIMPLE: el modelo de backup es FULL diario (RPO 24 h). Sin backups
--     de log, FULL haría crecer el .ldf indefinidamente.
-- Variables sqlcmd: *_DB_NAME, *_DB_USER, *_DB_PASSWORD. Nada se imprime.
-- =============================================================================
:on error exit
SET NOCOUNT ON;
GO

-- ---------------------------------------------------------------- auth
IF DB_ID(N'$(AUTH_DB_NAME)') IS NULL
  CREATE DATABASE [$(AUTH_DB_NAME)] COLLATE SQL_Latin1_General_CP1_CI_AS;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(AUTH_DB_USER)')
  CREATE LOGIN [$(AUTH_DB_USER)] WITH PASSWORD = N'$(AUTH_DB_PASSWORD)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF,
    DEFAULT_DATABASE = [$(AUTH_DB_NAME)];
ELSE
  ALTER LOGIN [$(AUTH_DB_USER)] WITH PASSWORD = N'$(AUTH_DB_PASSWORD)';
GO
ALTER DATABASE [$(AUTH_DB_NAME)] SET RECOVERY SIMPLE;
ALTER AUTHORIZATION ON DATABASE::[$(AUTH_DB_NAME)] TO [sa];
GO
USE [$(AUTH_DB_NAME)];
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(AUTH_DB_USER)')
  ALTER USER [$(AUTH_DB_USER)] WITH LOGIN = [$(AUTH_DB_USER)];
ELSE
  CREATE USER [$(AUTH_DB_USER)] FOR LOGIN [$(AUTH_DB_USER)];
ALTER ROLE db_owner ADD MEMBER [$(AUTH_DB_USER)];
GO
USE [master];
GO

-- ---------------------------------------------------------------- catalog
IF DB_ID(N'$(CATALOG_DB_NAME)') IS NULL
  CREATE DATABASE [$(CATALOG_DB_NAME)] COLLATE SQL_Latin1_General_CP1_CI_AS;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(CATALOG_DB_USER)')
  CREATE LOGIN [$(CATALOG_DB_USER)] WITH PASSWORD = N'$(CATALOG_DB_PASSWORD)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF,
    DEFAULT_DATABASE = [$(CATALOG_DB_NAME)];
ELSE
  ALTER LOGIN [$(CATALOG_DB_USER)] WITH PASSWORD = N'$(CATALOG_DB_PASSWORD)';
GO
ALTER DATABASE [$(CATALOG_DB_NAME)] SET RECOVERY SIMPLE;
ALTER AUTHORIZATION ON DATABASE::[$(CATALOG_DB_NAME)] TO [sa];
GO
USE [$(CATALOG_DB_NAME)];
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(CATALOG_DB_USER)')
  ALTER USER [$(CATALOG_DB_USER)] WITH LOGIN = [$(CATALOG_DB_USER)];
ELSE
  CREATE USER [$(CATALOG_DB_USER)] FOR LOGIN [$(CATALOG_DB_USER)];
ALTER ROLE db_owner ADD MEMBER [$(CATALOG_DB_USER)];
GO
USE [master];
GO

-- ---------------------------------------------------------------- ticket
IF DB_ID(N'$(TICKET_DB_NAME)') IS NULL
  CREATE DATABASE [$(TICKET_DB_NAME)] COLLATE SQL_Latin1_General_CP1_CI_AS;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(TICKET_DB_USER)')
  CREATE LOGIN [$(TICKET_DB_USER)] WITH PASSWORD = N'$(TICKET_DB_PASSWORD)', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF,
    DEFAULT_DATABASE = [$(TICKET_DB_NAME)];
ELSE
  ALTER LOGIN [$(TICKET_DB_USER)] WITH PASSWORD = N'$(TICKET_DB_PASSWORD)';
GO
ALTER DATABASE [$(TICKET_DB_NAME)] SET RECOVERY SIMPLE;
ALTER AUTHORIZATION ON DATABASE::[$(TICKET_DB_NAME)] TO [sa];
GO
USE [$(TICKET_DB_NAME)];
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(TICKET_DB_USER)')
  ALTER USER [$(TICKET_DB_USER)] WITH LOGIN = [$(TICKET_DB_USER)];
ELSE
  CREATE USER [$(TICKET_DB_USER)] FOR LOGIN [$(TICKET_DB_USER)];
ALTER ROLE db_owner ADD MEMBER [$(TICKET_DB_USER)];
GO
USE [master];
GO
PRINT '==> [mssql-init] 3 bases, 3 logins y 3 usuarios verificados.';
GO
