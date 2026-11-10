// HU-06 - Motor de enrutamiento automático de tickets.
// Función pura: dada una regla de enrutamiento + una prioridad, devuelve el
// nivel técnico que debe atender el ticket. Sin acceso a BD para que sea
// testeable de forma aislada.

// Sprint B: Level / Priority viven en src/domain/enums.ts.
import { Level, Priority } from "../domain/enums";

// Forma mínima de una regla de enrutamiento tal como la expone catalog-service.
// Coincide con el modelo `RoutingRule` de catalog-service.
export interface RoutingRuleSnapshot {
  levelEntry: Level;
  priorityHigh: Level | null;
  priorityCritical: Level | null;
  isCritical: boolean;
}

export class NoRoutingRuleError extends Error {
  constructor(serviceId: string) {
    super(`El servicio ${serviceId} no tiene regla de enrutamiento configurada`);
    this.name = "NoRoutingRuleError";
  }
}

export class InvalidLevelError extends Error {
  constructor(value: unknown) {
    super(`El nivel técnico "${String(value)}" no es válido`);
    this.name = "InvalidLevelError";
  }
}

const VALID_LEVELS: ReadonlySet<Level> = new Set<Level>([
  Level.N1,
  Level.N2,
  Level.N3,
  Level.N4,
]);

const LEVEL_ORDER: Record<Level, number> = {
  N1: 1,
  N2: 2,
  N3: 3,
  N4: 4,
};

function assertValidLevel(value: Level | null | undefined): Level | null {
  if (value === null || value === undefined) return null;
  if (!VALID_LEVELS.has(value)) {
    throw new InvalidLevelError(value);
  }
  return value;
}

function higher(a: Level, b: Level): Level {
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b;
}

// Decide el nivel técnico final según prioridad + regla:
//   - prioridad `critica` → usa priorityCritical, si no priorityHigh, si no levelEntry.
//   - prioridad `alta`    → usa priorityHigh, si no levelEntry.
//   - prioridad `media`/`baja` o ausente → levelEntry.
// Adicional: si la regla marca el servicio como `isCritical` y la prioridad es
// alta o crítica, se escala al mayor nivel definido (al menos N3, idealmente
// priorityCritical o priorityHigh si están).
export function resolveLevel(
  rule: RoutingRuleSnapshot | null | undefined,
  priority: Priority | null | undefined,
  serviceIdForError = "unknown"
): Level {
  if (!rule) {
    throw new NoRoutingRuleError(serviceIdForError);
  }

  const base = assertValidLevel(rule.levelEntry);
  if (!base) {
    throw new InvalidLevelError(rule.levelEntry);
  }
  const high = assertValidLevel(rule.priorityHigh);
  const critical = assertValidLevel(rule.priorityCritical);

  let level: Level = base;

  if (priority === Priority.critica) {
    level = critical ?? high ?? base;
  } else if (priority === Priority.alta) {
    level = high ?? base;
  }

  // Reforzamiento: servicio marcado como crítico con prioridad alta/crítica
  // garantiza escalamiento mínimo a N3 (o al nivel ya calculado si es mayor).
  if (rule.isCritical && (priority === Priority.alta || priority === Priority.critica)) {
    level = higher(level, Level.N3);
  }

  return level;
}
