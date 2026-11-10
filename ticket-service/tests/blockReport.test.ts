// =============================================================================
// Fase T — Reporte por bloque físico (Bloque 1 / Bloque 2). Filtrado en el
// backend, DTIC excluido, totales reales y validación digital real.
// =============================================================================
import jwt from "jsonwebtoken";

const mockTicketFindMany = jest.fn();
const mockEventFindMany = jest.fn();
const mockAccFindMany = jest.fn();
const mockFetchTechnicians = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: { findMany: (...a: unknown[]) => mockTicketFindMany(...a) },
    ticketEvent: { findMany: (...a: unknown[]) => mockEventFindMany(...a) },
    solutionAcceptance: { findMany: (...a: unknown[]) => mockAccFindMany(...a) },
  },
}));
jest.mock("../src/services/authClient", () => ({
  fetchUsersByIds: jest.fn().mockResolvedValue([]),
  fetchTechnicians: (...a: unknown[]) => mockFetchTechnicians(...a),
}));

import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();
const tok = (role: string, userId = "11111111-1111-4111-8111-111111111111") =>
  jwt.sign({ userId, email: `${role}@uta.edu.ec`, name: role, role }, process.env.JWT_SECRET!, { expiresIn: "1h" });

const B1A = "aaaaaaaa-0000-4000-8000-000000000001";
const B1B = "aaaaaaaa-0000-4000-8000-000000000002";
const B2A = "bbbbbbbb-0000-4000-8000-000000000001";
const DT = "dddddddd-0000-4000-8000-000000000001";
const ALL_TECHS = [
  { id: B1A, name: "Ana Bloque1", email: "ana@uta.edu.ec", role: "technician", block: "BLOQUE_1", isActive: true },
  { id: B1B, name: "Bruno Bloque1", email: "bruno@uta.edu.ec", role: "technician", block: "BLOQUE_1", isActive: true },
  { id: B2A, name: "Carla Bloque2", email: "carla@uta.edu.ec", role: "technician", block: "BLOQUE_2", isActive: true },
  // Defensa en profundidad: aunque auth-service devolviera un DTIC con bloque, no entra.
  { id: DT, name: "Diego DTIC", email: "diego@uta.edu.ec", role: "dtic", block: "BLOQUE_1", isActive: true },
];
const ticket = (id: string, o: Record<string, unknown>) => ({
  id, number: `TK-${id.slice(-3)}`, userId: "uuuuuuuu-0000-4000-8000-000000000001", userName: "Usuario Uno", userEmail: "u1@uta.edu.ec",
  serviceId: "ssssssss-0000-4000-8000-000000000001", serviceName: "Proyector", detail: "No enciende el proyector",
  responsibleArea: "TECHNICIANS", status: "en_proceso", assignedTechnicianId: B1A, resolvedById: null, resolutionSummary: null,
  createdAt: new Date("2026-10-10T10:00:00Z"), acceptedAt: new Date("2026-10-10T11:00:00Z"), resolvedAt: null, ...o,
});
const acc = (ticketId: string, decision: string, at: string) => ({
  id: `${ticketId}-${at}`, code: `VD-20261011-${decision.slice(0, 4)}0000`, ticketId, decision, userId: "u", userName: "Usuario Uno",
  userEmail: "u1@uta.edu.ec", userRole: "user", decidedAt: new Date(at), termsVersion: "1.0", termsSha256: "h", solutionEventId: null,
  solutionSummary: "Cable cambiado", technicianId: B1A, technicianName: "Ana Bloque1", reason: decision === "REJECTED" ? "Sigue fallando" : null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchTechnicians.mockImplementation(async (_t: string, opts: { block?: string }) =>
    ALL_TECHS.filter((t) => !opts?.block || t.block === opts.block)
  );
  mockTicketFindMany.mockResolvedValue([
    ticket("t-001", { status: "cerrado", resolvedById: B1A, resolutionSummary: "Cable cambiado", location: "Laboratorio 3", resolvedAt: new Date("2026-10-11T09:00:00Z") }),
    ticket("t-002", { status: "pendiente_validacion", resolvedById: B1B, assignedTechnicianId: B1B }),
    ticket("t-003", { status: "en_proceso", assignedTechnicianId: B1A }),
    ticket("t-004", { status: "cerrado", assignedTechnicianId: B1B, resolvedById: B1B }), // cerrado antes de la Fase T
  ]);
  mockEventFindMany.mockResolvedValue([
    { ticketId: "t-001", action: "RESOLVED", title: "Solución propuesta", workDone: "Reinicio + cable", performedByName: "Ana Bloque1", reason: null, createdAt: new Date("2026-10-11T08:00:00Z") },
    { ticketId: "t-001", action: "INTERNAL_NOTE_X", title: "no relevante", workDone: null, performedByName: "Ana", reason: null, createdAt: new Date("2026-10-11T08:30:00Z") },
  ]);
  mockAccFindMany.mockResolvedValue([
    acc("t-001", "REJECTED", "2026-10-10T20:00:00Z"),
    acc("t-001", "ACCEPTED", "2026-10-11T10:00:00Z"),
  ]);
});

const get = (q: string, role = "admin") => request(app).get(`/admin/reports/block?${q}`).set("Authorization", `Bearer ${tok(role)}`);

describe("GET /admin/reports/block", () => {
  it("solo admin: técnico y DTIC → 403 (no consultan reportes administrativos)", async () => {
    expect((await get("block=BLOQUE_1", "technician")).status).toBe(403);
    expect((await get("block=BLOQUE_1", "dtic")).status).toBe(403);
    expect((await get("block=BLOQUE_1", "user")).status).toBe(403);
  });

  it("validación de filtros: bloque obligatorio y válido, fechas coherentes", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("block=DTIC")).status).toBe(400);
    expect((await get("block=BLOQUE_1&from=2026-10-31&to=2026-10-01")).status).toBe(400);
    expect((await get("block=BLOQUE_1&status=inventado")).status).toBe(400);
  });

  it("Bloque 1: técnicos del bloque (sin DTIC ni Bloque 2), totales reales y validación digital", async () => {
    const r = await get("block=BLOQUE_1&from=2026-10-01&to=2026-10-31");
    expect(r.status).toBe(200);
    expect(r.body.blockLabel).toBe("Bloque 1");
    expect(r.body.technicians.map((t: { name: string }) => t.name)).toEqual(["Ana Bloque1", "Bruno Bloque1"]);
    expect(r.body.totals).toEqual({ technicians: 2, tickets: 4, closed: 2, pendingAcceptance: 1, rejectedByUser: 1, inProgress: 1 });
    // El backend consulta SOLO tickets del área TECHNICIANS de los técnicos del bloque, en el periodo
    const where = mockTicketFindMany.mock.calls[0][0].where;
    expect(where.responsibleArea).toBe("TECHNICIANS");
    expect(where.OR[0].assignedTechnicianId.in.sort()).toEqual([B1A, B1B].sort());
    expect(where.OR[0].assignedTechnicianId.in).not.toContain(DT);
    expect(where.createdAt.gte.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    const ana = r.body.technicians.find((t: { id: string }) => t.id === B1A);
    const t1 = ana.activities.find((a: { ticketId: string }) => a.ticketId === "t-001");
    expect(t1.validation.status).toBe("ACEPTADO_DIGITALMENTE");
    expect(t1.validation.record.code).toBe("VD-20261011-ACCE0000");
    expect(t1.validation.history).toHaveLength(2);
    expect(t1.solution).toContain("Reinicio + cable");
    expect(t1.history.map((h: { action: string }) => h.action)).toEqual(["RESOLVED"]); // solo eventos relevantes
    const bruno = r.body.technicians.find((t: { id: string }) => t.id === B1B);
    const statuses = bruno.activities.map((a: { validation: { status: string } }) => a.validation.status).sort();
    expect(statuses).toEqual(["CERRADO_SIN_CONSTANCIA", "PENDIENTE_VALIDACION"]); // nunca una aceptación inventada
  });

  it("cada ticket trae el nombre de la solución utilizada y su ubicación; sin datos, null (no se inventan)", async () => {
    const r = await get("block=BLOQUE_1");
    const all = r.body.technicians.flatMap((t: { activities: unknown[] }) => t.activities);
    const t1 = all.find((a: { ticketId: string }) => a.ticketId === "t-001");
    expect(t1.solutionName).toBe("Reinicio + cable");
    expect(t1.solutionNote).toBe("Cable cambiado");
    expect(t1.location).toBe("Laboratorio 3");
    const t3 = all.find((a: { ticketId: string }) => a.ticketId === "t-003");
    expect(t3.solutionName).toBeNull();
    expect(t3.location).toBeNull();
  });

  it("Bloque 2: pide a auth-service los técnicos de ESE bloque", async () => {
    mockTicketFindMany.mockResolvedValue([]);
    const r = await get("block=BLOQUE_2");
    expect(r.status).toBe(200);
    expect(mockFetchTechnicians.mock.calls[0][1]).toEqual({ block: "BLOQUE_2" });
    expect(r.body.technicians.map((t: { id: string }) => t.id)).toEqual([B2A]);
    expect(r.body.totals.tickets).toBe(0);
  });

  it("reporte individual: solo ese técnico; uno de otro bloque o DTIC → 404", async () => {
    const r = await get(`block=BLOQUE_1&technicianId=${B1B}`);
    expect(r.status).toBe(200);
    expect(r.body.technicians.map((t: { id: string }) => t.id)).toEqual([B1B]);
    expect(mockTicketFindMany.mock.calls[0][0].where.OR[0].assignedTechnicianId.in).toEqual([B1B]);
    expect((await get(`block=BLOQUE_1&technicianId=${B2A}`)).status).toBe(404);
    expect((await get(`block=BLOQUE_1&technicianId=${DT}`)).status).toBe(404);
  });

  it("filtros opcionales de estado y servicio llegan a la consulta", async () => {
    await get("block=BLOQUE_1&status=cerrado&serviceId=aaaaaaaa-0000-4000-8000-000000000001");
    const where = mockTicketFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("cerrado");
    expect(where.serviceId).toBe("aaaaaaaa-0000-4000-8000-000000000001");
  });
});
