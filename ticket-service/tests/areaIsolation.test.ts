// =============================================================================
// Fase R — Aislamiento entre áreas y roles definitivos (R1, R2, R4).
// Endpoints: GET /tickets/history/:id · GET /tickets/:id ·
//            GET /tickets/:id/attachments/:attachmentId
// Matriz: technician↔TECHNICIANS, dtic↔DTIC, cruces → 403, propietario,
// otro usuario, técnico asignado, eventos internos, roles heredados,
// DTIC ≠ admin, token de cambio de contraseña.
// =============================================================================
import fs from "fs";
import os from "os";
import path from "path";
import jwt from "jsonwebtoken";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sd-area-"));
process.env.UPLOAD_DIR = TMP_DIR;
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
    "0000000d49444154789c62000200000005000105f8b47f7c0000000049454e44ae426082",
  "hex"
);
fs.writeFileSync(path.join(TMP_DIR, "area.png"), PNG);

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: { findUnique: jest.fn() },
    ticketEvent: { findMany: jest.fn() },
    attachment: { findUnique: jest.fn() },
  },
}));
jest.mock("../src/services/authClient", () => ({
  fetchUsersByIds: jest.fn().mockResolvedValue([]),
  fetchTechnicians: jest.fn().mockResolvedValue([]),
}));
jest.mock("../src/services/catalogClient", () => {
  const actual = jest.requireActual("../src/services/catalogClient");
  return { ...actual, fetchService: jest.fn(), fetchAllServices: jest.fn().mockResolvedValue([]) };
});

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";
import { ticketAccess, normalizeRole, areasForRole, isStaffRole } from "../src/services/areaService";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const TICKET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const TECH = "33333333-3333-4333-8333-333333333333";

const token = (role: string, userId = TECH, extra: Record<string, unknown> = {}) =>
  jwt.sign({ userId, email: "x@uta.edu.ec", name: "X", role, ...extra }, SECRET, { expiresIn: "1h" });

function setTicket(area: "TECHNICIANS" | "DTIC", assigned: string | null = null) {
  (prisma.ticket.findUnique as jest.Mock).mockResolvedValue({
    id: TICKET_ID, number: "TK-1", userId: OWNER, serviceId: "s", serviceName: "Svc",
    userName: "Dueño", responsibleArea: area, assignedTechnicianId: assigned,
    status: "en_proceso", priority: "media", levelAssigned: "N1", createdAt: new Date(), attachments: [],
  });
  (prisma.ticketEvent.findMany as jest.Mock).mockImplementation(async ({ where }) => {
    const all = [
      { id: "e1", action: "CREATED", visibility: "public", performedBy: OWNER, performedByName: "Dueño", createdAt: new Date() },
      { id: "e2", action: "CONTRIBUTED", visibility: "internal", performedBy: TECH, performedByName: "Téc", createdAt: new Date() },
    ];
    return where.visibility ? all.filter((e) => e.visibility === where.visibility) : all;
  });
  (prisma.attachment.findUnique as jest.Mock).mockResolvedValue({
    id: ATT_ID, ticketId: TICKET_ID, filePath: "area.png", imageUrl: "/uploads/area.png",
    storageProvider: "local", mimeType: "image/png",
  });
}

const endpoints = {
  history: `/tickets/history/${TICKET_ID}`,
  detail: `/tickets/${TICKET_ID}`,
  attachment: `/tickets/${TICKET_ID}/attachments/${ATT_ID}`,
};
const get = (url: string, t: string) => request(app).get(url).set("Authorization", `Bearer ${t}`);

beforeEach(() => jest.clearAllMocks());

describe.each(Object.entries(endpoints))("%s — aislamiento entre áreas", (_name, url) => {
  it("technician → ticket de Técnicos: permitido", async () => {
    setTicket("TECHNICIANS");
    expect((await get(url, token("technician"))).status).toBe(200);
  });
  it("technician → ticket DTIC: 403", async () => {
    setTicket("DTIC");
    expect((await get(url, token("technician"))).status).toBe(403);
  });
  it("dtic → ticket DTIC: permitido", async () => {
    setTicket("DTIC");
    expect((await get(url, token("dtic"))).status).toBe(200);
  });
  it("dtic → ticket de Técnicos: 403", async () => {
    setTicket("TECHNICIANS");
    expect((await get(url, token("dtic"))).status).toBe(403);
  });
  it("propietario → su ticket: permitido", async () => {
    setTicket("DTIC");
    expect((await get(url, token("user", OWNER))).status).toBe(200);
  });
  it("otro usuario → ticket ajeno: 403", async () => {
    setTicket("TECHNICIANS");
    expect((await get(url, token("user", STRANGER))).status).toBe(403);
  });
  it("admin → cualquier área: permitido", async () => {
    setTicket("DTIC");
    expect((await get(url, token("admin", STRANGER))).status).toBe(200);
  });
  it("técnico de la otra área PERO asignado actualmente: permitido", async () => {
    setTicket("DTIC", TECH);
    expect((await get(url, token("technician", TECH))).status).toBe(200);
  });
  it("rol heredado tech_n3 se trata como dtic (no como técnico genérico)", async () => {
    setTicket("TECHNICIANS");
    expect((await get(url, token("tech_n3"))).status).toBe(403);
    setTicket("DTIC");
    expect((await get(url, token("tech_n3"))).status).toBe(200);
  });
  it("sin JWT: 401", async () => {
    setTicket("TECHNICIANS");
    expect((await request(app).get(url)).status).toBe(401);
  });
  it("token con cambio de contraseña pendiente: 403", async () => {
    setTicket("TECHNICIANS");
    const r = await get(url, token("admin", STRANGER, { pwdChange: true }));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("password_change_required");
  });
});

describe("historial: eventos internos", () => {
  it("el propietario solo recibe eventos públicos; el staff del área recibe también los internos", async () => {
    setTicket("TECHNICIANS");
    const owner = await get(endpoints.history, token("user", OWNER));
    expect(owner.body.history.map((e: { actionType: string }) => e.actionType)).toEqual(["CREATED"]);
    const staff = await get(endpoints.history, token("technician"));
    expect(staff.body.history.map((e: { actionType: string }) => e.actionType)).toEqual(["CREATED", "CONTRIBUTED"]);
  });
  it("un técnico de la otra área no obtiene ni siquiera los eventos (no se consulta la BD)", async () => {
    setTicket("DTIC");
    await get(endpoints.history, token("technician"));
    expect(prisma.ticketEvent.findMany).not.toHaveBeenCalled();
  });
});

describe("DTIC no es administrador", () => {
  it.each(["/admin/stats/tickets", "/admin/technicians", "/admin/technicians/summary", "/admin/tickets/history", "/admin/email-outbox"])(
    "dtic → %s: 403", async (url) => {
      expect((await get(url, token("dtic"))).status).toBe(403);
    }
  );
});

describe("areaService (regla única)", () => {
  it("roles → áreas", () => {
    expect(areasForRole("technician")).toEqual(["TECHNICIANS"]);
    expect(areasForRole("dtic")).toEqual(["DTIC"]);
    expect(areasForRole("admin")).toEqual(["TECHNICIANS", "DTIC"]);
    expect(areasForRole("user")).toEqual([]);
    expect(areasForRole("desconocido")).toEqual([]);
  });
  it("normalización y staff", () => {
    expect(normalizeRole("tech_n1")).toBe("technician");
    expect(normalizeRole("tech_n4")).toBe("dtic");
    expect(normalizeRole("root")).toBe("user");
    expect(isStaffRole("dtic")).toBe(true);
    expect(isStaffRole("user")).toBe(false);
  });
  it("ticketAccess: matriz", () => {
    const t = { userId: OWNER, responsibleArea: "DTIC", assignedTechnicianId: null };
    expect(ticketAccess({ userId: TECH, role: "dtic" }, t)).toEqual({ allowed: true, as: "staff" });
    expect(ticketAccess({ userId: TECH, role: "technician" }, t)).toEqual({ allowed: false });
    expect(ticketAccess({ userId: OWNER, role: "user" }, t)).toEqual({ allowed: true, as: "requester" });
    expect(ticketAccess({ userId: OWNER, role: "technician" }, t)).toEqual({ allowed: true, as: "requester" });
    expect(ticketAccess({ userId: STRANGER, role: "user" }, t)).toEqual({ allowed: false });
    expect(ticketAccess({ userId: STRANGER, role: "admin" }, t)).toEqual({ allowed: true, as: "admin" });
  });
});
