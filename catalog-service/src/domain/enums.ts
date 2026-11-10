// =============================================================================
// catalog-service - Enums de dominio (Sprint B / preparación MSSQL).
// Ver comentario en auth-service/src/domain/enums.ts.
// =============================================================================

export const Level = {
  N1: "N1",
  N2: "N2",
  N3: "N3",
  N4: "N4",
} as const;
export type Level = string;

export const ResponsibleArea = {
  TECHNICIANS: "TECHNICIANS",
  DTIC: "DTIC",
} as const;
export type ResponsibleArea = string;
