-- =============================================================================
-- Migración Sprint 3+ — catalog_db
-- 1. Reasignar servicios con área GENERAL → TECHNICIANS (documentado).
-- 2. Renombrar valor de enum TICS → DTIC (preserva referencias).
-- 3. Reemplazar el tipo enum para eliminar el valor GENERAL.
-- Idempotente: cada bloque comprueba estado antes de actuar.
-- =============================================================================

BEGIN;

-- Paso 1 · Reasignación de servicios que apuntan a GENERAL.
-- Justificación: TECHNICIANS es el área operativa que cualquier técnico N1/N2
-- puede tomar según areaService.ts (mapping rol→área). Reasignar preserva la
-- accesibilidad para los mismos técnicos que hoy ven GENERAL.
UPDATE services
   SET responsible_area = 'TECHNICIANS'
 WHERE responsible_area = 'GENERAL';

-- Paso 2 · Rename TICS → DTIC (Postgres 12+: no requiere reescritura de tablas).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
     WHERE t.typname = 'ResponsibleArea' AND e.enumlabel = 'TICS'
  ) THEN
    ALTER TYPE "ResponsibleArea" RENAME VALUE 'TICS' TO 'DTIC';
  END IF;
END$$;

-- Paso 3 · Reemplazar el tipo para eliminar el valor GENERAL.
-- Postgres no permite DROP VALUE en un enum; se hace swap seguro.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
     WHERE t.typname = 'ResponsibleArea' AND e.enumlabel = 'GENERAL'
  ) THEN
    ALTER TYPE "ResponsibleArea" RENAME TO "ResponsibleArea_old";
    CREATE TYPE "ResponsibleArea" AS ENUM ('TECHNICIANS', 'DTIC');
    ALTER TABLE services ALTER COLUMN responsible_area DROP DEFAULT;
    ALTER TABLE services
      ALTER COLUMN responsible_area TYPE "ResponsibleArea"
        USING responsible_area::text::"ResponsibleArea";
    ALTER TABLE services ALTER COLUMN responsible_area SET DEFAULT 'TECHNICIANS';
    DROP TYPE "ResponsibleArea_old";
  END IF;
END$$;

COMMIT;
