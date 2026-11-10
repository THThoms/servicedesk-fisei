// HU-16 - Tests para GET /admin/reports/technicians/:technicianId
//
//   - Solo admin (403 tech/user, 401 sin JWT)
//   - Técnico inexistente -> 404
//   - technicianId no UUID -> 400
//   - Filtro por fechas se aplica a where.createdAt
//   - No mezcla tickets/eventos de otro técnico
//   - Técnico sin actividad -> summary en cero, arrays vacíos
//   - Filtros de fecha inválidos -> 400
//
// El servicio de reporte (buildTechnicianReport) se ejecuta con prisma mockeado.

import jwt from "jsonwebtoken";

const mockTicketFindMany = jest.fn();
const mockTicketGroupBy = jest.fn();
const mockEventFindMany = jest.fn();
const mockEventCount = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: {
      findMany: (...a: unknown[]) => mockTicketFindMany(...a),
      findUnique: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
      groupBy: (...a: unknown[]) => mockTicketGroupBy(...a),
    },
    ticketEvent: {
      create: jest.fn(),
      findMany: (...a: unknown[]) => mockEventFindMany(...a),
      count: (...a: unknown[]) => mockEventCount(...a),
    },
    emailOutbox: {
      create: jest.fn().mockResolvedValue({ id: "o" }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((fn) =>
      fn({
        ticket: { update: jest.fn() },
        ticketEvent: { create: jest.fn() },
        emailOutbox: { create: jest.fn() },
      })
    ),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock("../src/services/authClient", () => ({
  fetchUsersByIds: jest.fn().mockResolvedValue([]),
  fetchTechnicians: jest.fn(),
}));

import request from "supertest";
import { createApp } from "../src/app";
import { fetchTechnicians } from "../src/services/authClient";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TECH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_TECH_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeToken(role: string, userId: string, name = "T"): string {
  return jwt.sign({ userId, email: "t@uta.edu.ec", name, role }, SECRET, { expiresIn: "1h" });
}

const TECH = {
  id: TECH_ID,
  name: "Técnico de Reportes",
  email: "tecnico.reportes@uta.edu.ec",
  role: "tech_n1",
  isActive: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  (fetchTechnicians as jest.Mock).mockResolvedValue([TECH]);
  mockTicketFindMany.mockResolvedValue([]);
  mockTicketGroupBy.mockResolvedValue([]);
  mockEventFindMany.mockResolvedValue([]);
  mockEventCount.mockResolvedValue(0);
});

describe("GET /admin/reports/technicians/:technicianId - permisos", () => {
  it("401 sin JWT", async () => {
    const res = await request(app).get(`/admin/reports/technicians/${TECH_ID}`);
    expect(res.status).toBe(401);
  });
  it("403 con técnico", async () => {
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .get(`/admin/reports/technicians/${TECH_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
  it("403 con usuario normal", async () => {
    const token = makeToken("user", "userid");
    const res = await request(app)
      .get(`/admin/reports/technicians/${TECH_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/reports/technicians/:technicianId - validación", () => {
  it("400 si technicianId no es UUID", async () => {
    const token = makeToken("admin", ADMIN_ID);
    const res = await request(app)
      .get(`/admin/reports/technicians/no-es-uuid`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
  it("404 si técnico no existe en auth-service", async () => {
    (fetchTechnicians as jest.Mock).mockResolvedValueOnce([]);
    const token = makeToken("admin", ADMIN_ID);
    const res = await request(app)
      .get(`/admin/reports/technicians/${TECH_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no encontrado/i);
  });
  it("400 si from posterior a to", async () => {
    const token = makeToken("admin", ADMIN_ID);
    const res = await request(app)
      .get(`/admin/reports/technicians/${TECH_ID}?from=2026-06-01&to=2026-05-01`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/posterior/i);
  });
  it("400 si formato de fecha inválido", async () => {
    const token = makeToken("admin", ADMIN_ID);
    const res = await request(app)
      .get(`/admin/reports/technicians/${TECH_ID}?from=2026/05/01`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/reports/technicians/:technicianId - reporte real", () => {
  it("admin obtiene reporte con estructura completa y datos del técnico", async () => {
    const token = makeToken("admin", ADMIN_ID);
    const res = await request(app)
      .get(`/admin/reports/technicians/${TECH_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Estructura mínima
    expect(res.body.technician).toMatchObject({ id: TECH_ID, name: "Técnico de Reportes" });
    expect(res.body.summary).toHaveProperty("ticketsAssigned");
    expect(res.body).toHaveProperty("tickets");
    expect(res.body).toHaveProperty("activity");
    expect(res.body).toHaveProperty("escalations");
    expect(res.body).toHaveProperty("resolutions");
    expect(res.body).toHaveProperty("contributions");
    expect(res.body).toHaveProperty("byService");
    expect(res.body).toHaveProperty("byStatus");
    expect(res.body).toHaveProperty("byPriority");
    expect(res.body).toHaveProperty("byMonth");
    // Áreas deducidas del rol (Sprint 3+: tech_n1 -> solo TECHNICIANS)
    expect(res.body.technician.areas).toEqual(["TECHNICIANS"]);
  });

  it("filtra tickets por rango de createdAt cuando se pasan from/to", async () => {
    const token = makeToken("admin", ADMIN_ID);
    await request(app)
      .get(`/admin/reports/technicians/${TECH_ID}?from=2026-05-01&to=2026-05-31`)
      .set("Authorization", `Bearer ${token}`);
    // Where en findMany incluye createdAt gte/lte
    const call = mockTicketFindMany.mock.calls[0][0];
    expect(call.where.createdAt).toEqual({
      gte: new Date("2026-05-01T00:00:00.000Z"),
      lte: new Date("2026-05-31T23:59:59.999Z"),
    });
    // Y el where sigue teniendo el OR por assignedTechnicianId / resolvedById
    expect(call.where.OR).toEqual([
      { assignedTechnicianId: TECH_ID },
      { resolvedById: TECH_ID },
    ]);
  });

  it("no mezcla tickets de otro técnico (where SIEMPRE filtra por el id solicitado)", async () => {
    const token = makeToken("admin", ADMIN_ID);
    await request(app)
      .get(`/admin/reports/technicians/${TECH_ID}`)
      .set("Authorization", `Bearer ${token}`);
    const call = mockTicketFindMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { assignedTechnicianId: TECH_ID },
      { resolvedById: TECH_ID },
    ]);
    // Nunca aparece OTHER_TECH_ID
    expect(JSON.stringify(call.where)).not.toContain(OTHER_TECH_ID);
    // Eventos también con performedBy=TECH_ID
    const evCall = mockEventFindMany.mock.calls[0][0];
    expect(evCall.where.performedBy).toBe(TECH_ID);
  });

  it("técnico sin actividad devuelve summary en cero y arrays vacíos", async () => {
    // mocks ya vacíos por default
    const token = makeToken("admin", ADMIN_ID);
    const res = await request(app)
      .get(`/admin/reports/technicians/${TECH_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      ticketsAssigned: 0,
      ticketsAccepted: 0,
      ticketsInProgress: 0,
      ticketsResolved: 0,
      ticketsClosed: 0,
      contributions: 0,
      reescalations: 0,
      distinctServices: 0,
    });
    expect(res.body.tickets).toEqual([]);
    expect(res.body.activity).toEqual([]);
  });

  it("estadísticas por servicio/estado/prioridad se calculan a partir del groupBy real", async () => {
    mockTicketGroupBy.mockImplementation(async (args: { by: string[] }) => {
      if (args.by[0] === "status") {
        return [{ status: "resuelto", _count: { _all: 3 } }];
      }
      if (args.by[0] === "priority") {
        return [{ priority: "alta", _count: { _all: 2 } }];
      }
      if (args.by[0] === "serviceName") {
        return [{ serviceName: "WiFi", _count: { _all: 5 } }];
      }
      return [];
    });
    const token = makeToken("admin", ADMIN_ID);
    const res = await request(app)
      .get(`/admin/reports/technicians/${TECH_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.byStatus).toEqual([{ label: "resuelto", count: 3 }]);
    expect(res.body.byPriority).toEqual([{ label: "alta", count: 2 }]);
    expect(res.body.byService).toEqual([{ label: "WiFi", count: 5 }]);
  });
});
