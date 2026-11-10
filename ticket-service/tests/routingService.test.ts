// Sprint B: enums desde el módulo de dominio.
import { Level, Priority } from "../src/domain/enums";
import {
  resolveLevel,
  NoRoutingRuleError,
  InvalidLevelError,
  RoutingRuleSnapshot,
} from "../src/services/routingService";

// HU-06 - Tests del motor puro de enrutamiento. Sin BD, sin HTTP, sin Express.

describe("routingService.resolveLevel", () => {
  // -------------------------------------------------------------------------
  // AC1: Ticket de "Red e Internet" se asigna a N1 automáticamente.
  // -------------------------------------------------------------------------
  it("AC1: 'Red e Internet' (levelEntry=N1) asigna N1 sin prioridad", () => {
    const rule: RoutingRuleSnapshot = {
      levelEntry: Level.N1,
      priorityHigh: Level.N2,
      priorityCritical: Level.N3,
      isCritical: false,
    };
    expect(resolveLevel(rule, null)).toBe(Level.N1);
    expect(resolveLevel(rule, Priority.media)).toBe(Level.N1);
    expect(resolveLevel(rule, Priority.baja)).toBe(Level.N1);
  });

  it("AC1: 'Red e Internet' con prioridad alta sube a N2 según regla", () => {
    const rule: RoutingRuleSnapshot = {
      levelEntry: Level.N1,
      priorityHigh: Level.N2,
      priorityCritical: Level.N3,
      isCritical: false,
    };
    expect(resolveLevel(rule, Priority.alta)).toBe(Level.N2);
    expect(resolveLevel(rule, Priority.critica)).toBe(Level.N3);
  });

  // -------------------------------------------------------------------------
  // AC2: Categoría crítica + prioridad alta/crítica → escalamiento configurado.
  // -------------------------------------------------------------------------
  it("AC2: servicio isCritical + prioridad crítica usa priorityCritical (N4)", () => {
    const rule: RoutingRuleSnapshot = {
      levelEntry: Level.N3,
      priorityHigh: Level.N3,
      priorityCritical: Level.N4,
      isCritical: true,
    };
    expect(resolveLevel(rule, Priority.critica)).toBe(Level.N4);
  });

  it("AC2: servicio isCritical + prioridad alta usa priorityHigh y nunca baja de N3", () => {
    const rule: RoutingRuleSnapshot = {
      levelEntry: Level.N3,
      priorityHigh: Level.N3,
      priorityCritical: Level.N4,
      isCritical: true,
    };
    expect(resolveLevel(rule, Priority.alta)).toBe(Level.N3);
  });

  it("AC2: servicio isCritical fuerza mínimo N3 incluso si priorityHigh fuera menor", () => {
    // Regla mal configurada: marca crítico pero deja priorityHigh en N1.
    // El motor debe igualmente escalar a N3.
    const rule: RoutingRuleSnapshot = {
      levelEntry: Level.N1,
      priorityHigh: Level.N1,
      priorityCritical: Level.N4,
      isCritical: true,
    };
    expect(resolveLevel(rule, Priority.alta)).toBe(Level.N3);
    expect(resolveLevel(rule, Priority.critica)).toBe(Level.N4);
    // Pero prioridad media en servicio crítico mantiene level base.
    expect(resolveLevel(rule, Priority.media)).toBe(Level.N1);
  });

  // -------------------------------------------------------------------------
  // Fallbacks: prioridades sin nivel configurado caen al nivel base.
  // -------------------------------------------------------------------------
  it("fallback: prioridad alta sin priorityHigh usa levelEntry", () => {
    const rule: RoutingRuleSnapshot = {
      levelEntry: Level.N2,
      priorityHigh: null,
      priorityCritical: null,
      isCritical: false,
    };
    expect(resolveLevel(rule, Priority.alta)).toBe(Level.N2);
  });

  it("fallback: prioridad crítica usa priorityHigh si no hay priorityCritical", () => {
    const rule: RoutingRuleSnapshot = {
      levelEntry: Level.N1,
      priorityHigh: Level.N3,
      priorityCritical: null,
      isCritical: false,
    };
    expect(resolveLevel(rule, Priority.critica)).toBe(Level.N3);
  });

  // -------------------------------------------------------------------------
  // Errores controlados.
  // -------------------------------------------------------------------------
  it("error: lanza NoRoutingRuleError si la regla es null", () => {
    expect(() => resolveLevel(null, Priority.alta, "svc-123")).toThrow(NoRoutingRuleError);
    expect(() => resolveLevel(undefined, null, "svc-123")).toThrow(NoRoutingRuleError);
  });

  it("error: lanza InvalidLevelError si levelEntry tiene un valor fuera del enum", () => {
    const rule = {
      // forzamos un valor inválido para simular regla corrupta en BD
      levelEntry: "N9" as unknown as Level,
      priorityHigh: null,
      priorityCritical: null,
      isCritical: false,
    };
    expect(() => resolveLevel(rule, Priority.media)).toThrow(InvalidLevelError);
  });

  it("error: lanza InvalidLevelError si priorityHigh tiene un valor inválido", () => {
    const rule = {
      levelEntry: Level.N1,
      priorityHigh: "BAD" as unknown as Level,
      priorityCritical: null,
      isCritical: false,
    };
    expect(() => resolveLevel(rule, Priority.alta)).toThrow(InvalidLevelError);
  });
});
