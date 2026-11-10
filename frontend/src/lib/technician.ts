// Helper único de presentación de técnicos en la UI.
//
// El flujo del Sprint 2 modificado funciona por ÁREA RESPONSABLE; los niveles
// N1-N4 y los roles internos (`tech_n1..n4`) son detalle de implementación y
// NUNCA deben aparecer en pantalla. El backend sigue usándolos para mapear
// rol → áreas (areaService.ts), pero el cliente muestra identidad + área.
//
// Reglas de visualización:
//   1. Mostrar el nombre personal del técnico; "Técnico" queda como fallback.
//   2. El área sale de `technician.areas[]`:
//        TECHNICIANS -> "Técnicos"
//        DTIC        -> "DTIC"
//   3. Email opcional como desambiguador (fuera de filtros de técnicos).

export interface TechnicianRef {
  id: string;
  name?: string;
  email?: string;
  /** Áreas que cubre el técnico, derivadas en el backend desde el rol. */
  areas?: string[];
  /** No usar en UI: rol interno (tech_n1..n4 / admin). */
  role?: string;
}

export type ResponsibleAreaRef = "TECHNICIANS" | "DTIC";

const RESPONSIBLE_AREA_LABEL: Record<ResponsibleAreaRef, string> = {
  TECHNICIANS: "Técnicos",
  DTIC: "DTIC",
};

export function getResponsibleAreaLabel(area: ResponsibleAreaRef | string): string {
  return RESPONSIBLE_AREA_LABEL[area as ResponsibleAreaRef] ?? area;
}

export function getTechnicianNameLabel(name: string | null | undefined): string {
  if (!name || /^T[eé]cnico\b/i.test(name)) return "Técnico";
  return name;
}

export function getAccountNameLabel(user: { name?: string; role?: string } | null | undefined): string {
  return user?.name ?? "";
}

export function getTechnicianAreaLabel(technician: TechnicianRef): string {
  const areas = technician.areas ?? [];
  if (areas.includes("DTIC")) return getResponsibleAreaLabel("DTIC");
  if (areas.includes("TECHNICIANS")) return getResponsibleAreaLabel("TECHNICIANS");
  return "Sin área";
}

/**
 * Etiqueta para mostrar en selects/dropdowns. Formato:
 *   "<nombre> — <área>"                        (sin email)
 *   "<nombre> — <área> — <email>"              (con email para desambiguar)
 *
 * Nunca expone technician.role.
 */
export function getTechnicianDisplayLabel(
  technician: TechnicianRef,
  options: { includeEmail?: boolean } = { includeEmail: true }
): string {
  const area = getTechnicianAreaLabel(technician);
  const base = `${getTechnicianNameLabel(technician.name)} — ${area}`;
  if (options.includeEmail && technician.email) {
    return `${base} — ${technician.email}`;
  }
  return base;
}
