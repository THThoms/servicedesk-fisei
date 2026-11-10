-- ============================================================================
-- ServiceDesk UTA - Bootstrap del laboratorio SQL Server 2022.
--
-- Crea 3 bases aisladas (auth_db, catalog_db, ticket_db) con un login+user
-- propios cada una (principio de privilegio mínimo). Idempotente: se puede
-- ejecutar N veces sin efectos colaterales.
--
-- Variables externas (sqlcmd :setvar) que debe inyectar el runner:
--   $(AUTH_DB_NAME)    $(AUTH_DB_USER)    $(AUTH_DB_PASSWORD)
--   $(CATALOG_DB_NAME) $(CATALOG_DB_USER) $(CATALOG_DB_PASSWORD)
--   $(TICKET_DB_NAME)  $(TICKET_DB_USER)  $(TICKET_DB_PASSWORD)
--
-- NO tocar producción. NO usar contra el SQL Server de la universidad.
-- ============================================================================
:on error exit

-- ---------------------------------------------------------------------------
-- Bases de datos
-- ---------------------------------------------------------------------------
IF DB_ID('$(AUTH_DB_NAME)') IS NULL
    CREATE DATABASE [$(AUTH_DB_NAME)]
        COLLATE SQL_Latin1_General_CP1_CI_AS;
GO
IF DB_ID('$(CATALOG_DB_NAME)') IS NULL
    CREATE DATABASE [$(CATALOG_DB_NAME)]
        COLLATE SQL_Latin1_General_CP1_CI_AS;
GO
IF DB_ID('$(TICKET_DB_NAME)') IS NULL
    CREATE DATABASE [$(TICKET_DB_NAME)]
        COLLATE SQL_Latin1_General_CP1_CI_AS;
GO

-- ---------------------------------------------------------------------------
-- Server logins (SQL auth). Uno por base para aislar credenciales.
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(AUTH_DB_USER)')
    CREATE LOGIN [$(AUTH_DB_USER)] WITH PASSWORD = N'$(AUTH_DB_PASSWORD)',
        CHECK_POLICY = OFF, CHECK_EXPIRATION = OFF;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(CATALOG_DB_USER)')
    CREATE LOGIN [$(CATALOG_DB_USER)] WITH PASSWORD = N'$(CATALOG_DB_PASSWORD)',
        CHECK_POLICY = OFF, CHECK_EXPIRATION = OFF;
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(TICKET_DB_USER)')
    CREATE LOGIN [$(TICKET_DB_USER)] WITH PASSWORD = N'$(TICKET_DB_PASSWORD)',
        CHECK_POLICY = OFF, CHECK_EXPIRATION = OFF;
GO

-- ---------------------------------------------------------------------------
-- auth_db: user + rol db_owner (Prisma db push necesita crear/alterar tablas).
-- ---------------------------------------------------------------------------
USE [$(AUTH_DB_NAME)];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(AUTH_DB_USER)')
    CREATE USER [$(AUTH_DB_USER)] FOR LOGIN [$(AUTH_DB_USER)];
GO
ALTER ROLE db_owner ADD MEMBER [$(AUTH_DB_USER)];
GO

-- ---------------------------------------------------------------------------
-- catalog_db
-- ---------------------------------------------------------------------------
USE [$(CATALOG_DB_NAME)];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(CATALOG_DB_USER)')
    CREATE USER [$(CATALOG_DB_USER)] FOR LOGIN [$(CATALOG_DB_USER)];
GO
ALTER ROLE db_owner ADD MEMBER [$(CATALOG_DB_USER)];
GO

-- ---------------------------------------------------------------------------
-- ticket_db
-- ---------------------------------------------------------------------------
USE [$(TICKET_DB_NAME)];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(TICKET_DB_USER)')
    CREATE USER [$(TICKET_DB_USER)] FOR LOGIN [$(TICKET_DB_USER)];
GO
ALTER ROLE db_owner ADD MEMBER [$(TICKET_DB_USER)];
GO

PRINT '==> Bases y usuarios ServiceDesk (lab MSSQL) creados/verificados.';
GO
