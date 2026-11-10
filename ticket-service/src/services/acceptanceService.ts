// =============================================================================
// Fase T — Aceptación digital de la solución: utilidades compartidas por las
// rutas (aceptar/rechazar), el historial y los reportes.
// =============================================================================
import crypto from "crypto";
import type { Prisma, PrismaClient, SolutionAcceptance } from "@prisma/client";
import { ALL_TERMS, CURRENT_TERMS, termsSha256 } from "../domain/acceptanceTerms";
import { TicketStatus } from "../domain/enums";

export const AcceptanceDecision = { ACCEPTED: "ACCEPTED", REJECTED: "REJECTED" } as const;

/** true cuando los términos vigentes están publicados e íntegros en la BD. */
let termsReady = false;
export const isTermsReady = (): boolean => termsReady;
/** Solo para tests. */
export const __setTermsReady = (v: boolean): void => {
  termsReady = v;
};

/**
 * Al arrancar ticket-service (después de `prisma db push`):
 *   1. publica en acceptance_terms las versiones que falten;
 *   2. comprueba que ninguna versión publicada haya cambiado de texto (SHA-256):
 *      si cambió, NO se admiten aceptaciones (hay que crear una versión nueva);
 *   3. crea los triggers que impiden UPDATE/DELETE en las constancias.
 * Idempotente. Nunca modifica ni borra registros existentes.
 */
export async function ensureAcceptanceSchema(prisma: PrismaClient): Promise<void> {
  let ok = true;
  for (const t of ALL_TERMS) {
    const sha = termsSha256(t);
    const existing = await prisma.acceptanceTerms.findUnique({ where: { version: t.version } });
    if (!existing) {
      await prisma.acceptanceTerms.create({ data: { version: t.version, title: t.title, text: t.text, sha256: sha } });
      console.log(`[acceptance] términos versión ${t.version} publicados`);
    } else if (existing.sha256 !== sha) {
      ok = false;
      console.error(
        `[acceptance] ERROR: el texto de los términos ${t.version} difiere del publicado. ` +
          "Una versión publicada no se modifica: crea una versión nueva. Aceptaciones deshabilitadas."
      );
    }
  }
  for (const [table, trigger] of [
    ["solution_acceptances", "trg_solution_acceptances_immutable"],
    ["acceptance_terms", "trg_acceptance_terms_immutable"],
  ]) {
    // CREATE TRIGGER debe ser la primera sentencia de su lote; Prisma envía la
    // consulta dentro de otro lote, así que se ejecuta como SQL dinámico.
    const ddl =
      `CREATE OR ALTER TRIGGER dbo.${trigger} ON dbo.${table} INSTEAD OF UPDATE, DELETE AS ` +
      `BEGIN SET NOCOUNT ON; THROW 51000, N'Registro inmutable: las constancias de aceptación digital no se modifican ni se borran', 1; END`;
    await prisma.$executeRawUnsafe(`EXEC(N'${ddl.replace(/'/g, "''")}')`);
  }
  termsReady = ok;
}

export function currentTerms() {
  return { ...CURRENT_TERMS, sha256: termsSha256(CURRENT_TERMS) };
}

/** Código legible y único de la constancia: VD-AAAAMMDD-XXXXXXXX. */
export function acceptanceCode(now: Date = new Date()): string {
  const d = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `VD-${d}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

/**
 * Solución vigente del ticket: el último evento RESOLVED. Devuelve su id y una
 * instantánea legible (título de la solución + nota final).
 */
export async function currentSolution(
  client: Prisma.TransactionClient | PrismaClient,
  ticketId: string,
  resolutionSummary: string | null
): Promise<{ eventId: string | null; summary: string | null }> {
  const ev = await client.ticketEvent.findFirst({
    where: { ticketId, action: "RESOLVED" },
    orderBy: { createdAt: "desc" },
  });
  const parts = [ev?.workDone, ev?.description ?? resolutionSummary].filter((x): x is string => !!x && x.trim() !== "");
  return { eventId: ev?.id ?? null, summary: parts.length ? Array.from(new Set(parts)).join(" — ") : null };
}

// -----------------------------------------------------------------------------
// Estado de la validación digital (para el detalle, el historial y los reportes)
// -----------------------------------------------------------------------------
export type ValidationStatus =
  | "ACEPTADO_DIGITALMENTE"
  | "SOLUCION_RECHAZADA"
  | "PENDIENTE_VALIDACION"
  | "SIN_SOLUCION"
  | "CERRADO_SIN_CONSTANCIA";

export const VALIDATION_LABELS: Record<ValidationStatus, string> = {
  ACEPTADO_DIGITALMENTE: "ACEPTADO DIGITALMENTE",
  SOLUCION_RECHAZADA: "SOLUCIÓN RECHAZADA",
  PENDIENTE_VALIDACION: "PENDIENTE DE VALIDACIÓN DEL USUARIO",
  SIN_SOLUCION: "SIN SOLUCIÓN REGISTRADA",
  CERRADO_SIN_CONSTANCIA: "CERRADO SIN CONSTANCIA DIGITAL (anterior al registro de aceptaciones)",
};

export interface DigitalValidation {
  status: ValidationStatus;
  label: string;
  /** La decisión que respalda el estado (null si no existe un registro real). */
  record: SerializedAcceptance | null;
  /** Todas las decisiones del ticket, de la más reciente a la más antigua. */
  history: SerializedAcceptance[];
}

export interface SerializedAcceptance {
  id: string;
  code: string;
  decision: string;
  userName: string;
  userEmail: string;
  userRole: string;
  decidedAt: Date;
  termsVersion: string;
  termsSha256: string;
  solutionEventId: string | null;
  solutionSummary: string | null;
  technicianId: string | null;
  technicianName: string | null;
  reason: string | null;
}

export function serializeAcceptance(a: SolutionAcceptance): SerializedAcceptance {
  return {
    id: a.id,
    code: a.code,
    decision: a.decision,
    userName: a.userName,
    userEmail: a.userEmail,
    userRole: a.userRole,
    decidedAt: a.decidedAt,
    termsVersion: a.termsVersion,
    termsSha256: a.termsSha256,
    solutionEventId: a.solutionEventId,
    solutionSummary: a.solutionSummary,
    technicianId: a.technicianId,
    technicianName: a.technicianName,
    reason: a.reason,
  };
}

/**
 * Deriva el estado SOLO de registros reales. Nunca inventa una aceptación:
 *   · pendiente_validacion            → PENDIENTE (aunque haya rechazos previos)
 *   · última decisión ACCEPTED         → ACEPTADO DIGITALMENTE
 *   · última decisión REJECTED         → SOLUCIÓN RECHAZADA (vuelve a atención)
 *   · cerrado/resuelto sin decisiones  → CERRADO SIN CONSTANCIA (tickets antiguos)
 *   · resto                            → SIN SOLUCIÓN REGISTRADA
 */
export function digitalValidation(
  ticket: { status: string },
  acceptances: SolutionAcceptance[]
): DigitalValidation {
  const history = [...acceptances]
    .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime())
    .map(serializeAcceptance);
  const latest = history[0] ?? null;
  let status: ValidationStatus;
  let record: SerializedAcceptance | null = null;
  if (ticket.status === TicketStatus.pendiente_validacion) {
    status = "PENDIENTE_VALIDACION";
  } else if (latest?.decision === AcceptanceDecision.ACCEPTED) {
    status = "ACEPTADO_DIGITALMENTE";
    record = latest;
  } else if (latest?.decision === AcceptanceDecision.REJECTED) {
    status = "SOLUCION_RECHAZADA";
    record = latest;
  } else if (ticket.status === TicketStatus.cerrado || ticket.status === TicketStatus.resuelto) {
    status = "CERRADO_SIN_CONSTANCIA";
  } else {
    status = "SIN_SOLUCION";
  }
  return { status, label: VALIDATION_LABELS[status], record, history };
}
