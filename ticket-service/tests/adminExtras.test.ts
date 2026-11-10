// Sprint 2 (rev) - Tests para los endpoints admin nuevos:
//   GET /admin/technicians      -> proxy a auth-service, enriquecido con áreas.
//   GET /admin/tickets/history  -> historial general filtrable + paginado.

import jwt from "jsonwebtoken";

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock("../src/services/authClient", () => ({
  fetchUsersByIds: jest.fn().mockResolvedValue([]),
  fetchTechnicians: jest.fn(),
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";
import { fetchTechnicians } from "../src/services/authClient";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TECH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeToken(role: string, userId = ADMIN_ID, name = "Admin") {
  return jwt.sign({ userId, email: "a@uta.edu.ec", name, role }, SECRET, { expiresIn: "1h" });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// GET /admin/technicians
// =============================================================================
describe("GET /admin/technicians", () => {
  it("admin obtiene técnicos con áreas enriquecidas", async () => {
    (fetchTechnicians as jest.Mock).mockResolvedValue([
      { id: TECH_ID, name: "Téc N1", email: "n1@uta.edu.ec", role: "tech_n1", isActive: true },
      { id: "tec3", name: "Téc N3", email: "n3@uta.edu.ec", role: "tech_n3", isActive: true },
    ]);
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/technicians")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.technicians).toHaveLength(2);
    expect(res.body.technicians[0]).toMatchObject({
      id: TECH_ID,
      role: "technician",
      areas: ["TECHNICIANS"],
    });
    expect(res.body.technicians[1].areas).toEqual(["DTIC"]);
  });

  it("403 si no es admin", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/admin/technicians")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(fetchTechnicians).not.toHaveBeenCalled();
  });

  it("401 sin JWT", async () => {
    const res = await request(app).get("/admin/technicians");
    expect(res.status).toBe(401);
  });

  it("502 si auth-service falla", async () => {
    (fetchTechnicians as jest.Mock).mockRejectedValueOnce(new Error("upstream down"));
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/technicians")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(502);
  });
});

// =============================================================================
// GET /admin/tickets/history
// =============================================================================
describe("GET /admin/tickets/history", () => {
  beforeEach(() => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
  });

  it("admin obtiene historial paginado por defecto", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/tickets/history")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, page: 1, limit: 20 });
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 20,
      })
    );
  });

  it("filtra por status, technicianId, serviceId, responsibleArea, priority", async () => {
    const token = makeToken("admin");
    const SERVICE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const res = await request(app)
      .get(
        `/admin/tickets/history?status=resuelto&technicianId=${TECH_ID}&serviceId=${SERVICE_ID}&responsibleArea=DTIC&priority=alta`
      )
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "resuelto",
          assignedTechnicianId: TECH_ID,
          serviceId: SERVICE_ID,
          responsibleArea: "DTIC",
          priority: "alta",
        },
      })
    );
  });

  it("filtra por rango de fechas", async () => {
    const token = makeToken("admin");
    const from = "2026-01-01T00:00:00.000Z";
    const to = "2026-12-31T23:59:59.000Z";
    await request(app)
      .get(`/admin/tickets/history?from=${from}&to=${to}`)
      .set("Authorization", `Bearer ${token}`);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: new Date(from), lte: new Date(to) } },
      })
    );
  });

  it("paginación con page y limit", async () => {
    const token = makeToken("admin");
    await request(app)
      .get("/admin/tickets/history?page=3&limit=10")
      .set("Authorization", `Bearer ${token}`);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
  });

  it("400 si status inválido", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/tickets/history?status=blah")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("400 si technicianId no es UUID", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/tickets/history?technicianId=not-uuid")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("403 si no es admin", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/admin/tickets/history")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("401 sin JWT", async () => {
    const res = await request(app).get("/admin/tickets/history");
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GET /tickets/history/:id - filtro de eventos internos para solicitante
// =============================================================================
describe("GET /tickets/history/:id - visibility filter", () => {
  const TICKET_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const REQ_USER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

  beforeEach(() => {
    // Reusamos el mismo mock del módulo. Lo casteamos al any para añadir métodos
    // que adminExtras no listó.
    (prisma as unknown as { ticket: { findUnique: jest.Mock } }).ticket.findUnique = jest
      .fn()
      .mockResolvedValue({
        id: TICKET_ID,
        number: "TK-X",
        userId: REQ_USER_ID,
        serviceId: "svc",
        levelAssigned: "N1",
        status: "en_proceso",
        priority: "media",
        createdAt: new Date(),
      });
    (prisma as unknown as { ticketEvent: { findMany: jest.Mock } }).ticketEvent = {
      findMany: jest.fn().mockResolvedValue([]),
    };
  });

  it("solicitante: where incluye visibility=public", async () => {
    const token = makeToken("user", REQ_USER_ID);
    const res = await request(app)
      .get(`/tickets/history/${TICKET_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ticketEvent = (prisma as unknown as { ticketEvent: { findMany: jest.Mock } })
      .ticketEvent;
    expect(ticketEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ticketId: TICKET_ID, visibility: "public" }),
      })
    );
  });

  it("staff (admin): no filtra por visibility", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .get(`/tickets/history/${TICKET_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ticketEvent = (prisma as unknown as { ticketEvent: { findMany: jest.Mock } })
      .ticketEvent;
    const call = ticketEvent.findMany.mock.calls[0][0];
    expect(call.where.visibility).toBeUndefined();
  });
});
