// =============================================================================
// Fase T — Aceptación digital de la solución por el usuario solicitante.
// Términos versionados, casilla obligatoria, constancia independiente e
// inmutable, solo el propietario, motivo obligatorio al rechazar, ciclo repetible.
// =============================================================================
import jwt from "jsonwebtoken";

const mockFindUnique = jest.fn();
const mockUpdateMany = jest.fn();
const mockAccCreate = jest.fn();
const mockAccFindMany = jest.fn();
const mockEventCreate = jest.fn();
const mockPush = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: { findUnique: (...a: unknown[]) => mockFindUnique(...a) },
    solutionAcceptance: { findMany: (...a: unknown[]) => mockAccFindMany(...a) },
    $transaction: jest.fn((fn) =>
      fn({
        ticket: {
          updateMany: (...a: unknown[]) => mockUpdateMany(...a),
          findUniqueOrThrow: jest.fn(async () => ({ id: TID, number: "TK-1", status: mockUpdateMany.mock.calls.at(-1)?.[0].data.status })),
        },
        ticketEvent: {
          create: (...a: unknown[]) => mockEventCreate(...a),
          findFirst: jest.fn().mockResolvedValue({ id: SOLUTION_EVENT, workDone: "Reinicio del proyector", description: "Se cambió el cable HDMI" }),
        },
        solutionAcceptance: { create: (...a: unknown[]) => mockAccCreate(...a) },
      })
    ),
  },
}));
jest.mock("../src/services/fcmService", () => ({
  ...jest.requireActual("../src/services/fcmService"),
  dispatchPushInBackground: (...a: unknown[]) => mockPush(...a),
}));

import request from "supertest";
import { createApp } from "../src/app";
import { CURRENT_TERMS, termsSha256 } from "../src/domain/acceptanceTerms";
import { __setTermsReady, digitalValidation, acceptanceCode } from "../src/services/acceptanceService";

var TID = "77777777-7777-4777-8777-777777777777";
var SOLUTION_EVENT = "99999999-9999-4999-8999-999999999999";
const OWNER = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const TECH = "88888888-8888-4888-8888-888888888888";
const app = createApp();
const tok = (role: string, userId = OWNER, email = "duenio@uta.edu.ec", name = "Dueña del Ticket") =>
  jwt.sign({ userId, email, name, role }, process.env.JWT_SECRET!, { expiresIn: "1h" });
const TERMS = { termsAccepted: true, termsVersion: CURRENT_TERMS.version };
const pending = (o: Record<string, unknown> = {}) =>
  mockFindUnique.mockResolvedValue({
    id: TID, number: "TK-1", userId: OWNER, status: "pendiente_validacion", responsibleArea: "TECHNICIANS",
    assignedTechnicianId: TECH, assignedTechnicianName: "Técnico B1", resolvedById: TECH, resolvedByName: "Técnico B1",
    resolutionSummary: "Se cambió el cable HDMI", ...o,
  });

beforeEach(() => {
  jest.clearAllMocks();
  __setTermsReady(true);
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockAccCreate.mockImplementation(async ({ data }) => ({ id: "acc-id", decidedAt: new Date("2026-11-05T15:30:00Z"), ...data }));
});

const accept = (token: string, body: object = TERMS) =>
  request(app).post(`/tickets/${TID}/user-accept`).set("Authorization", `Bearer ${token}`).send(body);
const reject = (token: string, body: object) =>
  request(app).post(`/tickets/${TID}/user-reject`).set("Authorization", `Bearer ${token}`).send(body);

describe("términos de aceptación", () => {
  it("GET /tickets/acceptance-terms devuelve versión, texto y SHA-256; sin presentarlo como firma certificada", async () => {
    const r = await request(app).get("/tickets/acceptance-terms").set("Authorization", `Bearer ${tok("user")}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ version: CURRENT_TERMS.version, sha256: termsSha256(CURRENT_TERMS), available: true });
    expect(r.body.text).toMatch(/constancia de aceptación digital/i);
    expect(r.body.text).toMatch(/no es una firma electrónica certificada/i);
  });
});

describe("aceptar la solución", () => {
  it("con casilla y versión vigente: constancia ACCEPTED completa + ticket cerrado + evento en el historial", async () => {
    pending();
    const r = await accept(tok("user"));
    expect(r.status).toBe(200);
    expect(r.body.ticket.status).toBe("cerrado");
    const data = mockAccCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      ticketId: TID, decision: "ACCEPTED", userId: OWNER, userName: "Dueña del Ticket", userEmail: "duenio@uta.edu.ec",
      userRole: "user", termsVersion: CURRENT_TERMS.version, termsSha256: termsSha256(CURRENT_TERMS),
      solutionEventId: SOLUTION_EVENT, technicianId: TECH, technicianName: "Técnico B1",
    });
    expect(data.code).toMatch(/^VD-\d{8}-[0-9A-F]{8}$/);
    expect(data.solutionSummary).toContain("Reinicio del proyector");
    expect(r.body.acceptance.code).toBe(data.code);
    const ev = mockEventCreate.mock.calls[0][0].data;
    expect(ev).toMatchObject({ action: "USER_ACCEPTED", newStatus: "cerrado" });
    expect(ev.title).toContain(data.code);
  });

  it("sin casilla, casilla en false o sin versión → 400 y nada se registra", async () => {
    pending();
    for (const body of [{}, { termsAccepted: false, termsVersion: "1.0" }, { termsAccepted: "true", termsVersion: "1.0" }, { termsAccepted: true }]) {
      expect((await accept(tok("user"), body)).status).toBe(400);
    }
    expect(mockAccCreate).not.toHaveBeenCalled();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("versión de términos desactualizada → 409 (el usuario debe revisar el texto vigente)", async () => {
    pending();
    const r = await accept(tok("user"), { termsAccepted: true, termsVersion: "0.9" });
    expect(r.status).toBe(409);
    expect(r.body.currentVersion).toBe(CURRENT_TERMS.version);
  });

  it("nadie acepta en nombre del usuario: otro usuario, el técnico, DTIC y admin → 403", async () => {
    pending();
    expect((await accept(tok("user", OTHER))).status).toBe(403);
    expect((await accept(tok("technician", TECH))).status).toBe(403);
    expect((await accept(tok("dtic", OTHER))).status).toBe(403);
    expect((await accept(tok("admin", OTHER))).status).toBe(403);
    expect(mockAccCreate).not.toHaveBeenCalled();
  });

  it("el propietario se reconoce aunque el GUID venga en mayúsculas desde SQL Server", async () => {
    pending({ userId: OWNER.toUpperCase() });
    expect((await accept(tok("user"))).status).toBe(200);
  });

  it("doble aceptación simultánea → la segunda recibe 409 y no crea otra constancia", async () => {
    pending();
    mockUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const [a, b] = await Promise.all([accept(tok("user")), accept(tok("user"))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(mockAccCreate).toHaveBeenCalledTimes(1);
  });

  it("ticket ya cerrado → 409; términos no publicados → 503", async () => {
    pending({ status: "cerrado" });
    expect((await accept(tok("user"))).status).toBe(409);
    pending();
    __setTermsReady(false);
    expect((await accept(tok("user"))).status).toBe(503);
  });
});

describe("rechazar la solución", () => {
  it("la casilla no sustituye al motivo: sin motivo o motivo corto → 400", async () => {
    pending();
    expect((await reject(tok("user"), { ...TERMS })).status).toBe(400);
    expect((await reject(tok("user"), { ...TERMS, reason: "no" })).status).toBe(400);
    expect((await reject(tok("user"), { reason: "La pantalla sigue en negro" })).status).toBe(400); // sin casilla
    expect(mockAccCreate).not.toHaveBeenCalled();
  });

  it("con motivo: constancia REJECTED con motivo, ticket en_proceso y aviso al técnico responsable", async () => {
    pending();
    const r = await reject(tok("user"), { ...TERMS, reason: "La pantalla sigue en negro" });
    expect(r.status).toBe(200);
    expect(r.body.ticket.status).toBe("en_proceso");
    expect(mockAccCreate.mock.calls[0][0].data).toMatchObject({ decision: "REJECTED", reason: "La pantalla sigue en negro", userId: OWNER, technicianId: TECH });
    expect(mockEventCreate.mock.calls[0][0].data).toMatchObject({ action: "USER_REJECTED_RESOLUTION", reason: "La pantalla sigue en negro" });
    expect(mockPush).toHaveBeenCalledWith([TECH], expect.objectContaining({ data: expect.objectContaining({ eventType: "TICKET_USER_REJECTED" }) }));
  });

  it("otro usuario no puede rechazar un ticket ajeno → 403", async () => {
    pending();
    expect((await reject(tok("user", OTHER), { ...TERMS, reason: "No me gusta la solución" })).status).toBe(403);
  });
});

describe("estado de la validación digital (solo registros reales)", () => {
  const rec = (decision: string, at: string, extra: Record<string, unknown> = {}) => ({
    id: at, code: acceptanceCode(new Date(at)), ticketId: TID, decision, userId: OWNER, userName: "Dueña", userEmail: "d@uta.edu.ec",
    userRole: "user", decidedAt: new Date(at), termsVersion: "1.0", termsSha256: "x", solutionEventId: null, solutionSummary: null,
    technicianId: TECH, technicianName: "Técnico B1", reason: decision === "REJECTED" ? "motivo" : null, ...extra,
  });

  it("ciclo repetido: rechazo → nueva solución pendiente → aceptación; el historial conserva ambas decisiones", () => {
    const rejected = rec("REJECTED", "2026-11-01T10:00:00Z");
    expect(digitalValidation({ status: "en_proceso" }, [rejected]).status).toBe("SOLUCION_RECHAZADA");
    expect(digitalValidation({ status: "pendiente_validacion" }, [rejected])).toMatchObject({ status: "PENDIENTE_VALIDACION", record: null });
    const accepted = rec("ACCEPTED", "2026-11-02T10:00:00Z");
    const v = digitalValidation({ status: "cerrado" }, [rejected, accepted]);
    expect(v.status).toBe("ACEPTADO_DIGITALMENTE");
    expect(v.record?.decision).toBe("ACCEPTED");
    expect(v.history.map((h) => h.decision)).toEqual(["ACCEPTED", "REJECTED"]);
  });

  it("nunca inventa una aceptación: cerrado sin constancia → CERRADO_SIN_CONSTANCIA; en proceso sin solución → SIN_SOLUCION", () => {
    expect(digitalValidation({ status: "cerrado" }, [])).toMatchObject({ status: "CERRADO_SIN_CONSTANCIA", record: null });
    expect(digitalValidation({ status: "resuelto" }, []).status).toBe("CERRADO_SIN_CONSTANCIA");
    expect(digitalValidation({ status: "en_proceso" }, [])).toMatchObject({ status: "SIN_SOLUCION", record: null });
    expect(digitalValidation({ status: "pendiente_validacion" }, []).label).toBe("PENDIENTE DE VALIDACIÓN DEL USUARIO");
  });

  it("GET /tickets/:id/acceptances: el propietario y el técnico asignado ven las constancias; un ajeno no", async () => {
    mockFindUnique.mockResolvedValue({ id: TID, userId: OWNER, status: "cerrado", responsibleArea: "TECHNICIANS", assignedTechnicianId: TECH });
    mockAccFindMany.mockResolvedValue([rec("ACCEPTED", "2026-11-02T10:00:00Z")]);
    const own = await request(app).get(`/tickets/${TID}/acceptances`).set("Authorization", `Bearer ${tok("user")}`);
    expect(own.status).toBe(200);
    expect(own.body.validation.status).toBe("ACEPTADO_DIGITALMENTE");
    expect((await request(app).get(`/tickets/${TID}/acceptances`).set("Authorization", `Bearer ${tok("technician", TECH)}`)).status).toBe(200);
    expect((await request(app).get(`/tickets/${TID}/acceptances`).set("Authorization", `Bearer ${tok("user", OTHER)}`)).status).toBe(403);
  });

  it("no existe ninguna ruta para modificar o borrar una constancia", async () => {
    for (const m of ["put", "patch", "delete"] as const) {
      const r = await request(app)[m](`/tickets/${TID}/acceptances`).set("Authorization", `Bearer ${tok("admin", OTHER)}`).send({ decision: "ACCEPTED" });
      expect([404, 405, 410]).toContain(r.status);
    }
  });
});

describe("ensureAcceptanceSchema (arranque)", () => {
  it("crea los triggers como SQL dinámico EXEC(N'…') — CREATE TRIGGER debe abrir su propio lote en SQL Server", async () => {
    const { ensureAcceptanceSchema, isTermsReady } = jest.requireActual("../src/services/acceptanceService");
    const exec = jest.fn().mockResolvedValue(0);
    const fake = {
      acceptanceTerms: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      $executeRawUnsafe: exec,
    };
    await ensureAcceptanceSchema(fake);
    expect(exec).toHaveBeenCalledTimes(2);
    for (const [sql] of exec.mock.calls) {
      expect(sql).toMatch(/^EXEC\(N'CREATE OR ALTER TRIGGER dbo\.trg_\w+_immutable ON dbo\.\w+ INSTEAD OF UPDATE, DELETE AS /);
      expect(sql).toContain("THROW 51000, N''Registro inmutable");
    }
    expect(fake.acceptanceTerms.create).toHaveBeenCalled();
    expect(isTermsReady()).toBe(true);
  });

  it("si el texto de una versión publicada cambió, deshabilita las aceptaciones (no reescribe la versión)", async () => {
    const { ensureAcceptanceSchema, isTermsReady } = jest.requireActual("../src/services/acceptanceService");
    const fake = {
      acceptanceTerms: { findUnique: jest.fn().mockResolvedValue({ version: "1.0", sha256: "otro-hash" }), create: jest.fn() },
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    };
    await ensureAcceptanceSchema(fake);
    expect(fake.acceptanceTerms.create).not.toHaveBeenCalled();
    expect(isTermsReady()).toBe(false);
  });
});
