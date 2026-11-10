// Sprint 2 (rev) - Tests para POST /tickets/:id/resolve.
// Cubre los modos existingKnowledge y newKnowledge, permisos, estados y la
// integración con el cliente del catálogo (mockeado).

import jwt from "jsonwebtoken";

const mockTicketUpdate = jest.fn();
const mockEventCreate = jest.fn();
const mockOutboxCreate = jest.fn().mockResolvedValue({ id: "outbox-resolve" });

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    ticketEvent: { create: jest.fn() },
    emailOutbox: {
      create: (...a: unknown[]) => mockOutboxCreate(...a),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: "outbox-resolve" }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((fn) =>
      fn({
        ticket: { update: mockTicketUpdate },
        ticketEvent: { create: mockEventCreate },
        emailOutbox: { create: mockOutboxCreate },
      })
    ),
  },
}));

jest.mock("../src/services/knowledgeClient", () => ({
  fetchKnowledgeById: jest.fn(),
  createKnowledgeArticle: jest.fn(),
  KnowledgeNotFoundError: class extends Error {
    constructor(id: string) {
      super(`Solución ${id} no encontrada en la base de conocimiento`);
      this.name = "KnowledgeNotFoundError";
    }
  },
  KnowledgeServiceError: class extends Error {
    public readonly status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = "KnowledgeServiceError";
      this.status = status;
    }
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";
import {
  fetchKnowledgeById,
  createKnowledgeArticle,
  KnowledgeNotFoundError,
  KnowledgeServiceError,
} from "../src/services/knowledgeClient";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const TICKET_ID = "66666666-6666-4666-8666-666666666666";
const TECH_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_TECH = "88888888-8888-4888-8888-888888888888";
const SERVICE_ID = "99999999-9999-4999-8999-999999999999";
const KB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeToken(role: string, userId = TECH_ID, name = "Téc N1") {
  return jwt.sign({ userId, email: "t@uta.edu.ec", name, role }, SECRET, { expiresIn: "1h" });
}

function mockTicket(
  overrides: Partial<{
    status: string;
    assignedTechnicianId: string | null;
    responsibleArea: string;
  }> = {}
) {
  (prisma.ticket.findUnique as jest.Mock).mockResolvedValue({
    id: TICKET_ID,
    number: "TK-RESOLVE",
    userId: "user-id",
    userName: "Solicitante",
    serviceId: SERVICE_ID,
    serviceName: "Red e Internet",
    detail: "x",
    levelAssigned: "N1",
    status: overrides.status ?? "en_proceso",
    priority: "media",
    responsibleArea: overrides.responsibleArea ?? "TECHNICIANS",
    assignmentStatus: "accepted",
    assignedTechnicianId:
      overrides.assignedTechnicianId === undefined
        ? TECH_ID
        : overrides.assignedTechnicianId,
    assignedTechnicianName: "Téc N1",
    acceptedAt: new Date(),
    createdAt: new Date(),
  });
  mockTicketUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: TICKET_ID,
    number: "TK-RESOLVE",
    // Sprint I · P4 — el técnico deja el ticket en pendiente_validacion, no
    // en resuelto. Solo tras user-accept pasa a resuelto.
    status: "pendiente_validacion",
    ...data,
  }));
  mockEventCreate.mockResolvedValue({ id: "ev-resolved" });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTicketUpdate.mockReset();
  mockEventCreate.mockReset();
  mockOutboxCreate.mockReset();
  mockOutboxCreate.mockResolvedValue({ id: "outbox-resolve" });
  (prisma.$transaction as jest.Mock).mockImplementation((fn) =>
    fn({
      ticket: { update: mockTicketUpdate },
      ticketEvent: { create: mockEventCreate },
      emailOutbox: { create: mockOutboxCreate },
    })
  );
});

describe("POST /tickets/:id/resolve - existingKnowledge", () => {
  it("resuelve usando una solución existente y NO crea otra", async () => {
    mockTicket();
    (fetchKnowledgeById as jest.Mock).mockResolvedValue({
      id: KB_ID,
      title: "Error de conexión VPN institucional",
      problemDescription: "x",
      solution: "y",
      keywords: ["vpn"],
      service: null,
    });

    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        mode: "existingKnowledge",
        knowledgeArticleId: KB_ID,
        finalNote: "El usuario confirmó que ya tiene conexión",
      });

    expect(res.status).toBe(200);
    expect(createKnowledgeArticle).not.toHaveBeenCalled();
    expect(fetchKnowledgeById).toHaveBeenCalledWith(KB_ID, expect.any(String));

    // Actualiza ticket con status=resuelto + vínculo KB
    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TICKET_ID },
        data: expect.objectContaining({
          status: "pendiente_validacion",
          resolvedById: TECH_ID,
          resolvedByName: "Téc N1",
          knowledgeArticleId: KB_ID,
          resolutionSummary: "El usuario confirmó que ya tiene conexión",
        }),
      })
    );
    expect(mockTicketUpdate.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);

    // Registra evento RESOLVED en historial
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "RESOLVED",
          previousStatus: "en_proceso",
          // Sprint I · P4 — RESOLVED marca pendiente_validacion; el estado
          // final resuelto llega tras USER_ACCEPTED.
          newStatus: "pendiente_validacion",
          performedBy: TECH_ID,
          visibility: "public",
        }),
      })
    );
    expect(res.body.knowledge).toMatchObject({ id: KB_ID, mode: "existingKnowledge" });
  });

  it("404 si la solución no existe en catalog", async () => {
    mockTicket();
    (fetchKnowledgeById as jest.Mock).mockRejectedValueOnce(new KnowledgeNotFoundError(KB_ID));
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "existingKnowledge", knowledgeArticleId: KB_ID });
    expect(res.status).toBe(404);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it("400 si knowledgeArticleId no es UUID", async () => {
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "existingKnowledge", knowledgeArticleId: "not-uuid" });
    expect(res.status).toBe(400);
  });

  it("400 si falta knowledgeArticleId", async () => {
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "existingKnowledge" });
    expect(res.status).toBe(400);
  });
});

describe("POST /tickets/:id/resolve - newKnowledge", () => {
  it("crea solución nueva en catalog y resuelve el ticket", async () => {
    mockTicket();
    (createKnowledgeArticle as jest.Mock).mockResolvedValue({
      id: KB_ID,
      title: "Solución nueva WiFi",
      problemDescription: "x",
      solution: "y",
      keywords: ["wifi"],
      service: null,
    });

    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        mode: "newKnowledge",
        title: "Solución nueva WiFi",
        problemDescription: "El usuario no podía conectarse a la red institucional.",
        solution:
          "Se reinició el punto de acceso, se validaron credenciales y se renovó la configuración.",
        keywords: ["wifi", "red"],
        finalNote: "Resuelto",
      });

    expect(res.status).toBe(200);
    expect(createKnowledgeArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Solución nueva WiFi",
        // Se fallback al serviceId del ticket cuando el body no lo trae
        serviceId: SERVICE_ID,
        keywords: ["wifi", "red"],
      }),
      expect.any(String)
    );
    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "pendiente_validacion",
          knowledgeArticleId: KB_ID,
        }),
      })
    );
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "RESOLVED" }),
      })
    );
  });

  it("400 si faltan campos obligatorios (sin keywords)", async () => {
    mockTicket();
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        mode: "newKnowledge",
        title: "Solución",
        problemDescription: "Descripción del problema válida",
        solution: "Solución aplicada válida y con texto",
        // keywords falta
      });
    expect(res.status).toBe(400);
    expect(createKnowledgeArticle).not.toHaveBeenCalled();
  });

  it("502 si catalog-service falla al crear la solución", async () => {
    mockTicket();
    (createKnowledgeArticle as jest.Mock).mockRejectedValueOnce(
      new KnowledgeServiceError("upstream offline")
    );
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        mode: "newKnowledge",
        title: "Solución X",
        problemDescription: "Descripción del problema",
        solution: "Solución aplicada y validada",
        keywords: ["x"],
      });
    expect(res.status).toBe(502);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /tickets/:id/resolve - permisos y estado", () => {
  it("401 sin JWT", async () => {
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .send({ mode: "existingKnowledge", knowledgeArticleId: KB_ID });
    expect(res.status).toBe(401);
  });

  it("403 usuario normal no puede resolver", async () => {
    const token = makeToken("user", "user-id");
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "existingKnowledge", knowledgeArticleId: KB_ID });
    expect(res.status).toBe(403);
  });

  it("403 técnico no asignado no puede resolver", async () => {
    mockTicket({ assignedTechnicianId: OTHER_TECH });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "existingKnowledge", knowledgeArticleId: KB_ID });
    expect(res.status).toBe(403);
  });

  it("404 si el ticket no existe", async () => {
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(null);
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "existingKnowledge", knowledgeArticleId: KB_ID });
    expect(res.status).toBe(404);
  });

  it("409 si el ticket no está asignado", async () => {
    mockTicket({ assignedTechnicianId: null });
    const token = makeToken("admin");
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "existingKnowledge", knowledgeArticleId: KB_ID });
    expect(res.status).toBe(409);
  });

  it("409 si el ticket ya está resuelto", async () => {
    mockTicket({ status: "resuelto" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "existingKnowledge", knowledgeArticleId: KB_ID });
    expect(res.status).toBe(409);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it("409 si el ticket ya está cerrado", async () => {
    mockTicket({ status: "cerrado" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "existingKnowledge", knowledgeArticleId: KB_ID });
    expect(res.status).toBe(409);
  });

  it("400 si mode es inválido", async () => {
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "blah", knowledgeArticleId: KB_ID });
    expect(res.status).toBe(400);
  });

  it("admin puede resolver un ticket asignado a otro técnico", async () => {
    mockTicket({ assignedTechnicianId: OTHER_TECH });
    (fetchKnowledgeById as jest.Mock).mockResolvedValue({
      id: KB_ID,
      title: "X",
      problemDescription: "",
      solution: "",
      keywords: [],
      service: null,
    });
    const token = makeToken("admin", "admin-id", "Admin");
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "existingKnowledge", knowledgeArticleId: KB_ID });
    expect(res.status).toBe(200);
  });
});
