-- =============================================================================
-- Migración Sprint 3+ — ticket_db
-- 1. Reasignar tickets y eventos con área GENERAL → TECHNICIANS.
-- 2. Renombrar valor de enum TICS → DTIC (preserva referencias).
-- 3. Reemplazar el tipo enum para eliminar el valor GENERAL.
-- Idempotente.
-- =============================================================================

BEGIN;

-- Paso 1a · Reasignación de tickets.
UPDATE tickets
   SET responsible_area = 'TECHNICIANS'
 WHERE responsible_area = 'GENERAL';

-- Paso 1b · Reasignación de eventos de historial.
UPDATE ticket_events
   SET previous_area = 'TECHNICIANS'
 WHERE previous_area = 'GENERAL';

UPDATE ticket_events
   SET new_area = 'TECHNICIANS'
 WHERE new_area = 'GENERAL';

-- Paso 2 · Rename TICS → DTIC.
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
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
     WHERE t.typname = 'ResponsibleArea' AND e.enumlabel = 'GENERAL'
  ) THEN
    ALTER TYPE "ResponsibleArea" RENAME TO "ResponsibleArea_old";
    CREATE TYPE "ResponsibleArea" AS ENUM ('TECHNICIANS', 'DTIC');
    ALTER TABLE tickets ALTER COLUMN responsible_area DROP DEFAULT;
    ALTER TABLE tickets
      ALTER COLUMN responsible_area TYPE "ResponsibleArea"
        USING responsible_area::text::"ResponsibleArea";
    ALTER TABLE tickets ALTER COLUMN responsible_area SET DEFAULT 'TECHNICIANS';
    ALTER TABLE ticket_events
      ALTER COLUMN previous_area TYPE "ResponsibleArea"
        USING previous_area::text::"ResponsibleArea";
    ALTER TABLE ticket_events
      ALTER COLUMN new_area TYPE "ResponsibleArea"
        USING new_area::text::"ResponsibleArea";
    DROP TYPE "ResponsibleArea_old";
  END IF;
END$$;

COMMIT;
