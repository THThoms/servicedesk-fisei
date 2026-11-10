// HU-15 - Tests del Email Outbox:
//   - Cada acción del ticket crea outbox con eventType correcto.
//   - Aportación internal NO crea correo.
//   - Email inválido NO crea correo (sin romper acción).
//   - El template NO contiene roles internos, hash, ni IDs sensibles.
//   - Tests no envían correos reales (transport = MockTransport).

// IMPORTANTE: silenciar logs antes de que cargue env (modo mock evita los console.log
// de LogTransport).
process.env.EMAIL_SEND_MODE = "mock";
process.env.EMAIL_NOTIFICATIONS_ENABLED = "true";

import jwt from "jsonwebtoken";

const mockTicketUpdate = jest.fn();
const mockEventCreate = jest.fn();
const mockOutboxCreate = jest.fn();
const mockOutboxFindUnique = jest.fn();
const mockOutboxUpdate = jest.fn();
const mockOutboxFindMany = jest.fn();

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
    emailOutbox: {
      create: (...a: unknown[]) => mockOutboxCreate(...a),
      findUnique: (...a: unknown[]) => mockOutboxFindUnique(...a),
      update: (...a: unknown[]) => mockOutboxUpdate(...a),
      findMany: (...a: unknown[]) => mockOutboxFindMany(...a),
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
  fetchTechnicians: jest.fn().mockResolvedValue([]),
}));
jest.mock("../src/services/catalogClient", () => {
  const actual = jest.requireActual("../src/services/catalogClient");
  return { ...actual, fetchAllServices: jest.fn().mockResolvedValue([]), fetchService: jest.fn() };
});
jest.mock("../src/services/knowledgeClient", () => ({
  fetchKnowledgeById: jest.fn().mockResolvedValue({
    id: "kb-aaaa",
    title: "Solución de prueba pública",
    problemDescription: "x",
    solution: "y",
    keywords: ["x"],
    service: null,
  }),
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";
import { fetchUsersByIds } from "../src/services/authClient";
import {
  processPendingEmails,
  MAX_EMAIL_ATTEMPTS,
} from "../src/services/emailOutboxService";
import { __setEmailTransportForTests } from "../src/services/emailService";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const TICKET_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const TECH_ID = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const ADMIN_ID = "33333333-3333-4333-8333-cccccccccccc";
const KB_ID = "55555555-5555-4555-8555-555555555555";

function makeToken(role: string, userId: string, name = "Tester") {
  return jwt.sign({ userId, email: "t@uta.edu.ec", name, role }, SECRET, { expiresIn: "1h" });
}

function mockTicket(overrides: Record<string, unknown> = {}) {
  (prisma.ticket.findUnique as jest.Mock).mockResolvedValue({
    id: TICKET_ID,
    number: "TK-HU15",
    userId: USER_ID,
    userName: "Solicitante Prueba",
    userEmail: "solicitante@uta.edu.ec",
    serviceId: "ss",
    serviceName: "Equipos / Hardware",
    detail: "x",
    levelAssigned: "N1",
    status: "abierto",
    priority: "media",
    responsibleArea: "TECHNICIANS",
    assignmentStatus: "available",
    assignedTechnicianId: null,
    assignedTechnicianName: null,
    acceptedAt: null,
    resolvedAt: null,
    resolutionSummary: null,
    createdAt: new Date(),
    ...overrides,
  });
  mockTicketUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: TICKET_ID,
    number: "TK-HU15",
    userName: "Solicitante Prueba",
    userEmail: "solicitante@uta.edu.ec",
    serviceName: "Equipos / Hardware",
    responsibleArea: "TECHNICIANS",
    assignedTechnicianName: null,
    acceptedAt: null,
    resolvedAt: null,
    resolutionSummary: null,
    status: "abierto",
    ...data,
  }));
  mockEventCreate.mockResolvedValue({ id: "ev-hu15" });
  mockOutboxCreate.mockResolvedValue({ id: "outbox-hu15" });
  mockOutboxFindUnique.mockResolvedValue(null); // dispatch saldrá temprano
  mockOutboxUpdate.mockResolvedValue({ id: "outbox-hu15" });
}

beforeEach(() => {
  jest.clearAllMocks();
  __setEmailTransportForTests(null);
  mockTicket();
});

// =============================================================================
// 1) Aceptar ticket -> TICKET_ACCEPTED
// =============================================================================
describe("HU-15 - notificaciones por acción", () => {
  it("aceptar ticket crea outbox TICKET_ACCEPTED", async () => {
    const token = makeToken("tech_n1", TECH_ID, "Téc N1");
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockOutboxCreate).toHaveBeenCalledTimes(1);
    const call = mockOutboxCreate.mock.calls[0][0];
    expect(call.data.eventType).toBe("TICKET_ACCEPTED");
    expect(call.data.to).toBe("solicitante@uta.edu.ec");
    expect(call.data.subject).toMatch(/aceptado/i);
    // No exponer roles ni niveles internos en el cuerpo.
    expect(call.data.htmlBody).not.toMatch(/tech_n[1-4]/);
    expect(call.data.textBody).not.toMatch(/tech_n[1-4]/);
    expect(call.data.htmlBody).not.toMatch(/passwordHash|JWT|Bearer /);
  });

  it("admin asigna ticket -> outbox TICKET_ASSIGNED", async () => {
    (fetchUsersByIds as jest.Mock).mockResolvedValueOnce([
      { id: TECH_ID, name: "Téc N1", email: "tec@uta.edu.ec", role: "tech_n1" },
    ]);
    const token = makeToken("admin", ADMIN_ID, "Admin");
    const res = await request(app)
      .post(`/admin/tickets/${TICKET_ID}/assign`)
      .set("Authorization", `Bearer ${token}`)
      .send({ technicianId: TECH_ID, note: "Carga balanceada" });
    expect(res.status).toBe(200);
    expect(mockOutboxCreate).toHaveBeenCalledTimes(1);
    expect(mockOutboxCreate.mock.calls[0][0].data.eventType).toBe("TICKET_ASSIGNED");
  });

  it("derivar ticket -> outbox TICKET_ESCALATED", async () => {
    mockTicket({ assignedTechnicianId: TECH_ID, status: "en_proceso" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .put(`/tickets/${TICKET_ID}/escalate`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "Requiere otra área",
        workDone: "Se revisó conectividad",
        targetArea: "DTIC",
      });
    expect(res.status).toBe(200);
    expect(mockOutboxCreate).toHaveBeenCalledTimes(1);
    expect(mockOutboxCreate.mock.calls[0][0].data.eventType).toBe("TICKET_ESCALATED");
  });

  it("resolver ticket -> outbox TICKET_RESOLVED", async () => {
    mockTicket({ assignedTechnicianId: TECH_ID, status: "en_proceso" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "existingKnowledge", knowledgeArticleId: KB_ID, finalNote: "Listo" });
    expect(res.status).toBe(200);
    expect(mockOutboxCreate).toHaveBeenCalledTimes(1);
    expect(mockOutboxCreate.mock.calls[0][0].data.eventType).toBe("TICKET_RESOLVED");
  });

  it("aportación PUBLIC crea outbox TICKET_CONTRIBUTION", async () => {
    mockTicket({ assignedTechnicianId: TECH_ID, status: "en_proceso" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/contributions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "Avance importante", visibility: "public" });
    expect(res.status).toBe(201);
    expect(mockOutboxCreate).toHaveBeenCalledTimes(1);
    expect(mockOutboxCreate.mock.calls[0][0].data.eventType).toBe("TICKET_CONTRIBUTION");
  });

  it("aportación INTERNAL NO crea correo", async () => {
    mockTicket({ assignedTechnicianId: TECH_ID, status: "en_proceso" });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/contributions`)
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "Nota interna", visibility: "internal" });
    expect(res.status).toBe(201);
    expect(mockOutboxCreate).not.toHaveBeenCalled();
  });

  it("solicitante sin email válido NO rompe la acción del ticket ni crea outbox", async () => {
    mockTicket({ userEmail: null });
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post(`/tickets/${TICKET_ID}/accept`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(mockOutboxCreate).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 2) processPendingEmails: límite de intentos
// =============================================================================
describe("HU-15 - processPendingEmails", () => {
  it("procesa pending y devuelve resumen", async () => {
    // 2 pendings; con MockTransport no fallan -> ambos sent.
    mockOutboxFindMany.mockResolvedValueOnce([
      { id: "o1", status: "pending" },
      { id: "o2", status: "failed" },
    ]);
    // Cada dispatch hace findUnique de la fila, luego update.
    mockOutboxFindUnique
      .mockResolvedValueOnce({
        id: "o1",
        status: "pending",
        to: "a@uta.edu.ec",
        subject: "s",
        htmlBody: "<p>x</p>",
        textBody: null,
        eventType: "TICKET_ACCEPTED",
        ticketId: null,
      })
      .mockResolvedValueOnce({ id: "o1", status: "sent" })
      .mockResolvedValueOnce({
        id: "o2",
        status: "failed",
        to: "b@uta.edu.ec",
        subject: "s",
        htmlBody: "<p>x</p>",
        textBody: null,
        eventType: "TICKET_RESOLVED",
        ticketId: null,
      })
      .mockResolvedValueOnce({ id: "o2", status: "sent" });
    const summary = await processPendingEmails(50);
    expect(summary.processed).toBe(2);
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(0);
    // findMany se llamó con attempts < MAX_EMAIL_ATTEMPTS
    const call = mockOutboxFindMany.mock.calls[0][0];
    expect(call.where.attempts.lt).toBe(MAX_EMAIL_ATTEMPTS);
  });
});

// =============================================================================
// 3) Endpoints admin de outbox
// =============================================================================
describe("HU-15 - endpoints admin outbox", () => {
  it("GET /admin/email-outbox requiere admin (403 para técnico)", async () => {
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .get("/admin/email-outbox")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("GET /admin/email-outbox 401 sin JWT", async () => {
    const res = await request(app).get("/admin/email-outbox");
    expect(res.status).toBe(401);
  });

  it("GET /admin/email-outbox admin recibe lista sin htmlBody", async () => {
    mockOutboxFindMany.mockResolvedValueOnce([
      {
        id: "o1",
        ticketId: TICKET_ID,
        to: "a@uta.edu.ec",
        subject: "Tu ticket TK-1 fue aceptado",
        eventType: "TICKET_ACCEPTED",
        status: "sent",
        attempts: 1,
        lastError: null,
        sentAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    const token = makeToken("admin", ADMIN_ID);
    const res = await request(app)
      .get("/admin/email-outbox?status=sent")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.outbox).toHaveLength(1);
    expect(res.body.outbox[0]).not.toHaveProperty("htmlBody");
    // findMany select no incluye htmlBody.
    const call = mockOutboxFindMany.mock.calls[0][0];
    expect(call.select.htmlBody).toBeUndefined();
  });

  it("POST /admin/email-outbox/process requiere admin", async () => {
    const token = makeToken("tech_n1", TECH_ID);
    const res = await request(app)
      .post("/admin/email-outbox/process")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("POST /admin/email-outbox/process responde con resumen", async () => {
    mockOutboxFindMany.mockResolvedValueOnce([]);
    const token = makeToken("admin", ADMIN_ID);
    const res = await request(app)
      .post("/admin/email-outbox/process")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ processed: 0, sent: 0, failed: 0 });
  });
});
