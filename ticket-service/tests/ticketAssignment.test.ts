// Sprint 2 (rev) - Tests del flujo por categoría/área:
//   GET /tickets/my, /available, /accepted
//   POST /tickets/:id/accept, /:id/contributions
//   PUT /tickets/:id/escalate
//   POST /admin/tickets/:id/assign, GET /admin/stats/tickets

import jwt from "jsonwebtoken";

const mockTicketUpdate = jest.fn();
const mockEventCreate = jest.fn();
const mockOutboxCreate = jest.fn().mockResolvedValue({ id: "outbox-1" });

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
    },
    ticketEvent: { create: jest.fn(), findMany: jest.fn() },
    // HU-15: el outbox vive en este mismo cliente. Lo mockeamos para que
    // notifyTicket* no falle. dispatchInBackground hace findUnique → null y termina.
    emailOutbox: {
      create: (...a: unknown[]) => mockOutboxCreate(...a),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: "outbox-1" }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((fn) =>
      fn({
        ticket: { update: mockTicketUpdate },
        ticketEvent: { create: mockEventCreate },
        emailOutbox: { create: mockOutboxCreate },
      })
    ),
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ avg_secs: 120 }]),
  },
}));

jest.mock("../src/services/authClient", () => ({
  fetchUsersByIds: jest.fn().mockResolvedValue([]),
}));
jest.mock("../src/services/catalogClient", () => {
  const actual = jest.requireActual("../src/services/catalogClient");
  return { ...actual, fetchAllServices: jest.fn().mockResolvedValue([]), fetchService: jest.fn() };
});

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";
import { fetchUsersByIds } from "../src/services/authClient";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const TICKET_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const TECH_ID = "22222222-2222-4222-8222-bbbbbbbbbbbb";

function makeToken(role: string, userId = USER_ID, name = "Test User") {
  return jwt.sign({ userId, email: "u@uta.edu.ec", name, role }, SECRET, { expiresIn: "1h" });
}

function mockTicket(overrides: Partial<{
  status: string;
  responsibleArea: string;
  assignmentStatus: string;
  assignedTechnicianId: string | null;
  userId: string;
  levelAssigned: string;
}> = {}) {
  (prisma.ticket.findUnique as jest.Mock).mockResolvedValue({
    id: TICKET_ID,
    number: "TK-1",
    userId: overrides.userId ?? USER_ID,
    userName: "Test User",
    serviceId: "ss",
    serviceName: "Red e Internet",
    detail: "x",
    levelAssigned: overrides.levelAssigned ?? "N1",
    status: overrides.status ?? "abierto",
    priority: "media",
    responsibleArea: overrides.responsibleArea ?? "TECHNICIANS",
    assignmentStatus: overrides.assignmentStatus ?? "available",
    assignedTechnicianId: overrides.assignedTechnicianId ?? null,
    assignedTechnicianName: null,
    acceptedAt: null,
    createdAt: new Date(),
  });
  mockTicketUpdate.mockImplementation(async ({ data }) => ({
    id: TICKET_ID,
    number: "TK-1",
    status: "abierto",
    responsibleArea: "TECHNICIANS",
    assignmentStatus: "available",
    ...data,
  }));
  mockEventCreate.mockResolvedValue({ id: "ev" });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTicketUpdate.mockReset();
  mockEventCreate.mockReset();
  mockOutboxCreate.mockReset();
  mockOutboxCreate.mockResolvedValue({ id: "outbox-1" });
  (prisma.$transaction as jest.Mock).mockImplementation((fn) =>
    fn({
      ticket: { update: mockTicketUpdate },
      ticketEvent: { create: mockEventCreate },
      emailOutbox: { create: mockOutboxCreate },
    })
  );
});

// =============================================================================
// GET /tickets/my
// =============================================================================
describe("GET /tickets/my", () => {
  it("usuario ve solo sus tickets", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
    const token = makeToken("user", USER_ID);
    const res = await request(app).get("/tickets/my").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID }) })
    );
  });

  it("401 sin JWT", async () => {
    const res = await request(app).get("/tickets/my");
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GET /tickets/available
// =============================================================================
describe("GET /tickets/available", () => {
  it("tech_n1 ve solo área TECHNICIANS (Sprint 3+: sin GENERAL)", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/tickets/available")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.areas).toEqual(["TECHNICIANS"]);
    const call = (prisma.ticket.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.assignmentStatus).toBe("available");
    expect(call.where.assignedTechnicianId).toBeNull();
    expect(call.where.status).toEqual({ notIn: ["resuelto", "cerrado"] });
    expect(call.where.responsibleArea.in).toEqual(["TECHNICIANS"]);
    expect(call.where.responsibleArea.in).not.toContain("DTIC");
  });

  it("tech_n3 ve solo área DTIC (Sprint 3+: sin GENERAL, sin TECHNICIANS)", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
    const token = makeToken("tech_n3");
    const res = await request(app)
      .get("/tickets/available")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.areas).not.toContain("TECHNICIANS");
    expect(res.body.areas).toEqual(["DTIC"]);
    const call = (prisma.ticket.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.responsibleArea.in).not.toContain("TECHNICIANS");
  });

  it("403 si user normal", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .get("/tickets/available")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// POST /tickets/:id/accept
// =============================================================================
describe("POST /tickets/:id/accept", () => {
  it("tech acepta ticket compatible con su área", async () => {
    mockTicket({ responsibleArea: "TECHNICIANS" });
    const token = makeToken("tech_n1", TECH_ID, "Tec N1");
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignmentStatus: "available",
          assignedTechnicianId: null,
          status: { notIn: ["resuelto", "cerrado"] },
          responsibleArea: { in: ["TECHNICIANS"] },
        }),
        data: expect.objectContaining({
          assignedTechnicianId: TECH_ID,
          assignmentStatus: "accepted",
          status: "en_proceso",
        }),
      })
    );
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "ACCEPTED", newTechnicianId: TECH_ID }),
      })
    );
  });

  it("409 si ya fue aceptado por otro técnico", async () => {
    mockTicket({ assignedTechnicianId: "otro-tec-id" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it("409 si ya no está disponible aunque no tenga técnico asignado", async () => {
    mockTicket({ assignmentStatus: "assigned_by_admin", assignedTechnicianId: null });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it("tech_n3 acepta ticket del área DTIC", async () => {
    mockTicket({ responsibleArea: "DTIC" });
    const token = makeToken("tech_n3", TECH_ID, "Tec DTIC");
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockTicketUpdate).toHaveBeenCalled();
  });

  it("409 si otro técnico toma el ticket durante la aceptación", async () => {
    mockTicket({ responsibleArea: "TECHNICIANS" });
    mockTicketUpdate.mockRejectedValueOnce({ code: "P2025" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(mockEventCreate).not.toHaveBeenCalled();
  });

  it("403 si la categoría está fuera del área del técnico", async () => {
    mockTicket({ responsibleArea: "DTIC" });
    const token = makeToken("tech_n1", TECH_ID); // tech_n1 NO atiende DTIC
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("403 si role user", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("403 si admin (debe usar /admin/assign)", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("404 ticket inexistente", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(null);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("409 si ticket cerrado", async () => {
    mockTicket({ status: "cerrado" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });
});

// =============================================================================
// GET /tickets/accepted
// =============================================================================
describe("GET /tickets/accepted", () => {
  it("tech ve solo los tickets asignados a sí mismo (excluye resueltos y cerrados)", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("tech_n1", TECH_ID);
    await request(app).get("/tickets/accepted").set("Authorization", `Bearer ${token}`);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignedTechnicianId: TECH_ID,
          status: { notIn: ["resuelto", "cerrado"] },
        },
      })
    );
  });

  it("admin ve todos los asignados activos por defecto", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("admin");
    await request(app).get("/tickets/accepted").set("Authorization", `Bearer ${token}`);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignedTechnicianId: { not: null },
          status: { notIn: ["resuelto", "cerrado"] },
        },
      })
    );
  });

  it("?includeResolved=true&includeClosed=true incluye todos", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("tech_n1", TECH_ID);
    await request(app)
      .get("/tickets/accepted?includeResolved=true&includeClosed=true")
      .set("Authorization", `Bearer ${token}`);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assignedTechnicianId: TECH_ID } })
    );
  });
});

// =============================================================================
// GET /tickets/my-assigned
// =============================================================================
describe("GET /tickets/my-assigned", () => {
  it("tech ve solo activos (excluye resuelto y cerrado por defecto)", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .get("/tickets/my-assigned")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignedTechnicianId: TECH_ID,
          status: { notIn: ["resuelto", "cerrado"] },
        },
      })
    );
    expect(res.body.filters).toMatchObject({
      technicianId: TECH_ID,
      includeClosed: false,
      history: false,
    });
  });

  it("includeClosed=true incluye tickets cerrados (sigue excluyendo resueltos)", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("tech_n1", TECH_ID);
    await request(app)
      .get("/tickets/my-assigned?includeClosed=true")
      .set("Authorization", `Bearer ${token}`);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignedTechnicianId: TECH_ID, status: { notIn: ["resuelto"] } },
      })
    );
  });

  it("history=true devuelve resueltos/cerrados del técnico", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .get("/tickets/my-assigned?history=true")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ["resuelto", "cerrado"] },
          OR: [
            { assignedTechnicianId: TECH_ID },
            { resolvedById: TECH_ID },
          ],
        },
      })
    );
    expect(res.body.filters).toMatchObject({ history: true });
  });

  it("admin sin technicianId ve los suyos propios", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    const ADMIN_ID = "99999999-9999-4999-8999-999999999999";
    const token = makeToken("admin", ADMIN_ID);
    await request(app)
      .get("/tickets/my-assigned")
      .set("Authorization", `Bearer ${token}`);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignedTechnicianId: ADMIN_ID }),
      })
    );
  });

  it("admin puede auditar tickets de otro técnico vía ?technicianId=...", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    const token = makeToken("admin");
    await request(app)
      .get(`/tickets/my-assigned?technicianId=${TECH_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignedTechnicianId: TECH_ID }),
      })
    );
  });

  it("técnico NO puede usar ?technicianId para ver tickets ajenos (ignora el query)", async () => {
    (prisma.ticket.findMany as jest.Mock).mockResolvedValue([]);
    const otroTecnico = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const token = makeToken("tech_n1", TECH_ID);
    await request(app)
      .get(`/tickets/my-assigned?technicianId=${otroTecnico}`)
      .set("Authorization", `Bearer ${token}`);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assignedTechnicianId: TECH_ID }),
      })
    );
  });

  it("403 si usuario normal intenta consultar", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .get("/tickets/my-assigned")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(prisma.ticket.findMany).not.toHaveBeenCalled();
  });

  it("401 sin JWT", async () => {
    const res = await request(app).get("/tickets/my-assigned");
    expect(res.status).toBe(401);
  });

  it("400 si technicianId no es UUID", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .get("/tickets/my-assigned?technicianId=not-a-uuid")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// POST /tickets/:id/contributions
// =============================================================================
describe("POST /tickets/:id/contributions", () => {
  it("técnico asignado puede aportar", async () => {
    mockTicket({ assignedTechnicianId: TECH_ID });
    const token = makeToken("tech_n1", TECH_ID, "Tec N1");
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/contributions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "Reinicié el router del bloque B" });
    expect(res.status).toBe(201);
  });

  it("403 si técnico NO es el asignado", async () => {
    mockTicket({ assignedTechnicianId: "otro" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/contributions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "Quiero aportar pero no es mío" });
    expect(res.status).toBe(403);
  });

  it("400 si description está vacío", async () => {
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/contributions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "    " });
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// PUT /tickets/:id/escalate (v2)
// =============================================================================
describe("PUT /tickets/:id/escalate", () => {
  it("escala con reason + workDone + targetArea", async () => {
    mockTicket({ assignedTechnicianId: TECH_ID, responsibleArea: "TECHNICIANS" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .put(`/tickets/${TICKET_ID}/escalate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "El problema requiere plataforma institucional",
        workDone: "Se revisó conectividad y credenciales locales",
        targetArea: "DTIC",
        description: "Pasa a DITIC",
      });
    expect(res.status).toBe(200);
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ESCALATED",
          previousArea: "TECHNICIANS",
          newArea: "DTIC",
          reason: "El problema requiere plataforma institucional",
          workDone: "Se revisó conectividad y credenciales locales",
        }),
      })
    );
    // Cambia de área -> debe volver a estar disponible.
    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "escalado",
          responsibleArea: "DTIC",
          assignedTechnicianId: null,
          assignmentStatus: "available",
        }),
      })
    );
  });

  it("400 si falta workDone", async () => {
    mockTicket({ assignedTechnicianId: TECH_ID });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .put(`/tickets/${TICKET_ID}/escalate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "motivo valido aqui" });
    expect(res.status).toBe(400);
  });

  it("400 si falta reason", async () => {
    mockTicket({ assignedTechnicianId: TECH_ID });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .put(`/tickets/${TICKET_ID}/escalate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ workDone: "trabajo previo", targetArea: "DTIC" });
    expect(res.status).toBe(400);
  });

  it("400 si el área destino no es válida", async () => {
    mockTicket({ assignedTechnicianId: TECH_ID });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .put(`/tickets/${TICKET_ID}/escalate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "motivo valido", workDone: "trabajo previo", targetArea: "OTRA" });
    expect(res.status).toBe(400);
  });

  it("403 si tech no asignado", async () => {
    mockTicket({ assignedTechnicianId: "otro" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .put(`/tickets/${TICKET_ID}/escalate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "motivo valido", workDone: "trabajo previo" });
    expect(res.status).toBe(403);
  });

  it("409 si ticket resuelto", async () => {
    mockTicket({ status: "resuelto", assignedTechnicianId: TECH_ID });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .put(`/tickets/${TICKET_ID}/escalate`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "motivo valido", workDone: "trabajo previo" });
    expect(res.status).toBe(409);
  });

  it("admin puede derivar un ticket a otra área", async () => {
    mockTicket({ assignedTechnicianId: TECH_ID, responsibleArea: "DTIC" });
    const token = makeToken("admin", USER_ID, "Administrador");
    const res = await request(app)
      .put(`/tickets/${TICKET_ID}/escalate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "Redistribución administrativa",
        workDone: "Se verificó el alcance de soporte",
        targetArea: "TECHNICIANS",
      });
    expect(res.status).toBe(200);
    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          responsibleArea: "TECHNICIANS",
          assignedTechnicianId: null,
          assignmentStatus: "available",
        }),
      })
    );
  });
});

// =============================================================================
// POST /admin/tickets/:id/assign
// =============================================================================
describe("POST /admin/tickets/:id/assign", () => {
  it("admin asigna técnico válido con área compatible", async () => {
    mockTicket({ responsibleArea: "TECHNICIANS" });
    (fetchUsersByIds as jest.Mock).mockResolvedValueOnce([
      { id: TECH_ID, name: "Téc N1", email: "tec@uta.edu.ec", role: "tech_n1" },
    ]);
    const token = makeToken("admin");
    const res = await request(app)
      .post(`/admin/tickets/${TICKET_ID}/assign`)
      .set("Authorization", `Bearer ${token}`)
      .send({ technicianId: TECH_ID, note: "Carga de trabajo" });
    expect(res.status).toBe(200);
    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assignedTechnicianId: TECH_ID,
          assignmentStatus: "assigned_by_admin",
        }),
      })
    );
  });

  it("400 si técnico no atiende esa área", async () => {
    mockTicket({ responsibleArea: "DTIC" });
    (fetchUsersByIds as jest.Mock).mockResolvedValueOnce([
      { id: TECH_ID, name: "Téc N1", email: "tec@uta.edu.ec", role: "tech_n1" },
    ]);
    const token = makeToken("admin");
    const res = await request(app)
      .post(`/admin/tickets/${TICKET_ID}/assign`)
      .set("Authorization", `Bearer ${token}`)
      .send({ technicianId: TECH_ID });
    expect(res.status).toBe(400);
  });

  it("400 si el usuario destino no es técnico", async () => {
    mockTicket();
    (fetchUsersByIds as jest.Mock).mockResolvedValueOnce([
      { id: TECH_ID, name: "Usuario", email: "u@uta.edu.ec", role: "user" },
    ]);
    const token = makeToken("admin");
    const res = await request(app)
      .post(`/admin/tickets/${TICKET_ID}/assign`)
      .set("Authorization", `Bearer ${token}`)
      .send({ technicianId: TECH_ID });
    expect(res.status).toBe(400);
  });

  it("403 si no es admin", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .post(`/admin/tickets/${TICKET_ID}/assign`)
      .set("Authorization", `Bearer ${token}`)
      .send({ technicianId: TECH_ID });
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// GET /admin/stats/tickets
// =============================================================================
describe("GET /admin/stats/tickets", () => {
  it("admin obtiene agregados (sin fechas) y comportamiento general", async () => {
    (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
    (prisma.ticket.groupBy as jest.Mock).mockResolvedValue([]);
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/stats/tickets")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totals");
    expect(res.body).toHaveProperty("byService");
    expect(res.body).toHaveProperty("byResponsibleArea");
    expect(res.body).toHaveProperty("byPriority");
    expect(res.body).toHaveProperty("byTechnician");
    expect(res.body).toHaveProperty("resolvedByTechnician");
    expect(res.body).toHaveProperty("createdByDay");
    expect(res.body).toHaveProperty("avgAcceptSeconds");
    expect(res.body).toHaveProperty("avgResolveSeconds");
    // HU-12: filters presente, sin rango.
    expect(res.body.filters).toEqual({ dateFrom: null, dateTo: null });
    // El primer count (totalAll) ahora recibe where vacío (sin rango).
    expect(prisma.ticket.count).toHaveBeenCalledWith({ where: {} });
  });

  it("403 si no es admin", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/admin/stats/tickets")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("401 sin JWT", async () => {
    const res = await request(app).get("/admin/stats/tickets");
    expect(res.status).toBe(401);
  });

  // ---- HU-12: filtros por fecha ----
  it("dateFrom filtra desde el inicio de ese día (gte)", async () => {
    (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
    (prisma.ticket.groupBy as jest.Mock).mockResolvedValue([]);
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/stats/tickets?dateFrom=2026-05-01")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.filters).toEqual({ dateFrom: "2026-05-01", dateTo: null });
    expect(prisma.ticket.count).toHaveBeenCalledWith({
      where: { createdAt: { gte: new Date("2026-05-01T00:00:00.000Z") } },
    });
  });

  it("dateTo filtra hasta el final de ese día (lte)", async () => {
    (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
    (prisma.ticket.groupBy as jest.Mock).mockResolvedValue([]);
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/stats/tickets?dateTo=2026-05-31")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.filters).toEqual({ dateFrom: null, dateTo: "2026-05-31" });
    expect(prisma.ticket.count).toHaveBeenCalledWith({
      where: { createdAt: { lte: new Date("2026-05-31T23:59:59.999Z") } },
    });
  });

  it("dateFrom + dateTo filtra el rango (gte/lte) y se aplica a groupBy", async () => {
    (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
    (prisma.ticket.groupBy as jest.Mock).mockResolvedValue([]);
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/stats/tickets?dateFrom=2026-05-01&dateTo=2026-05-31")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.filters).toEqual({ dateFrom: "2026-05-01", dateTo: "2026-05-31" });
    const expectedRange = {
      gte: new Date("2026-05-01T00:00:00.000Z"),
      lte: new Date("2026-05-31T23:59:59.999Z"),
    };
    expect(prisma.ticket.count).toHaveBeenCalledWith({ where: { createdAt: expectedRange } });
    // groupBy por servicio también lleva el rango.
    expect(prisma.ticket.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: expectedRange } })
    );
  });

  it("400 si dateFrom > dateTo", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/stats/tickets?dateFrom=2026-06-01&dateTo=2026-05-01")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/posterior/i);
  });

  it("400 si dateFrom tiene formato inválido", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/stats/tickets?dateFrom=01-05-2026")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("400 si dateTo es una fecha calendario imposible", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/stats/tickets?dateTo=2026-13-40")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("rango sin tickets devuelve totales en cero y arrays vacíos", async () => {
    (prisma.ticket.count as jest.Mock).mockResolvedValue(0);
    (prisma.ticket.groupBy as jest.Mock).mockResolvedValue([]);
    const token = makeToken("admin");
    const res = await request(app)
      .get("/admin/stats/tickets?dateFrom=2000-01-01&dateTo=2000-01-02")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totals.tickets).toBe(0);
    expect(res.body.byService).toEqual([]);
    expect(res.body.byPriority).toEqual([]);
    expect(res.body.byTechnician).toEqual([]);
  });
});
