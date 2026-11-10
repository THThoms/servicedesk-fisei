// =============================================================================
// Fase R — (1) validación de imágenes por bytes reales al crear un ticket;
//          (2) ciclo de validación: aceptar → CERRADO, rechazar → en_proceso
//              con razón obligatoria; solo el propietario.
// Fase T: aceptar/rechazar exigen además la casilla de términos (termsAccepted
//         + termsVersion) y crean una constancia; el cambio de estado se hace
//         con updateMany condicionado al estado (anti doble validación).
// =============================================================================
import fs from "fs";
import os from "os";
import path from "path";
import jwt from "jsonwebtoken";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sd-upl-"));
process.env.UPLOAD_DIR = TMP_DIR;

const mockTicketCreate = jest.fn();
const mockTicketUpdate = jest.fn();
const mockEventCreate = jest.fn();
const mockTicketUpdateMany = jest.fn();
const mockAcceptanceCreate = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: { findUnique: jest.fn(), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn) =>
      fn({
        ticket: {
          create: mockTicketCreate,
          update: mockTicketUpdate,
          updateMany: mockTicketUpdateMany,
          findUniqueOrThrow: jest.fn(async () => ({ id: "77777777-7777-4777-8777-777777777777", number: "TK-TEST-001", status: mockTicketUpdateMany.mock.calls.at(-1)?.[0].data.status })),
        },
        ticketEvent: { create: mockEventCreate, findFirst: jest.fn().mockResolvedValue({ id: "99999999-9999-4999-8999-999999999999", workDone: "Solución KB", description: "nota" }) },
        solutionAcceptance: { create: mockAcceptanceCreate },
        emailOutbox: { create: jest.fn().mockResolvedValue({}) },
      })
    ),
  },
}));
jest.mock("../src/services/ticketNumber", () => ({ generateTicketNumber: jest.fn().mockResolvedValue("TK-TEST-001") }));
jest.mock("../src/services/authClient", () => ({
  fetchUsersByIds: jest.fn().mockResolvedValue([]),
  fetchTechnicians: jest.fn().mockResolvedValue([]),
}));
jest.mock("../src/services/catalogClient", () => {
  const actual = jest.requireActual("../src/services/catalogClient");
  return {
    ...actual,
    fetchService: jest.fn().mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111", name: "Proyector", isActive: true,
      responsibleArea: "TECHNICIANS", levelEntry: "N1", routingRule: null,
    }),
    fetchAllServices: jest.fn().mockResolvedValue([]),
  };
});

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";
import { detectImageType } from "../src/services/imageType";
import { __setTermsReady } from "../src/services/acceptanceService";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const OWNER = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";
const TID = "77777777-7777-4777-8777-777777777777";
const tok = (role: string, userId = OWNER) =>
  jwt.sign({ userId, email: "o@uta.edu.ec", name: "Owner", role }, SECRET, { expiresIn: "1h" });

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0datos-jpeg")]);
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001", "hex");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBPVP8 datos")]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(8)]);
const TEXT = Buffer.from("esto no es una imagen, aunque diga image/png");

beforeEach(() => {
  jest.clearAllMocks();
  mockTicketCreate.mockImplementation(async ({ data }) => ({ id: TID, number: "TK-TEST-001", ...data, attachments: [] }));
  mockTicketUpdate.mockImplementation(async ({ data }) => ({ id: TID, number: "TK-TEST-001", ...data }));
});

function create(file: Buffer, filename: string, contentType: string) {
  return request(app)
    .post("/tickets")
    .set("Authorization", `Bearer ${tok("user")}`)
    .field("serviceId", "11111111-1111-4111-8111-111111111111")
    .field("detail", "El proyector no enciende en el aula")
    .attach("attachments", file, { filename, contentType });
}
const storedAttachment = () => mockTicketCreate.mock.calls[0]?.[0]?.data?.attachments?.create?.[0];

describe("detectImageType (bytes reales)", () => {
  it("reconoce JPEG, PNG, WebP y HEIC; rechaza el resto", () => {
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(WEBP)).toBe("image/webp");
    expect(detectImageType(HEIC)).toBe("image/heic");
    expect(detectImageType(TEXT)).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe("POST /tickets — validación de adjuntos", () => {
  it("JPEG declarado como image/png se guarda con el tipo REAL y extensión .jpg", async () => {
    const r = await create(JPEG, "foto.png", "image/png");
    expect(r.status).toBe(201);
    expect(storedAttachment().mimeType).toBe("image/jpeg");
    expect(storedAttachment().filePath).toMatch(/\.jpg$/);
  });
  it("WebP se acepta", async () => {
    expect((await create(WEBP, "foto.webp", "image/webp")).status).toBe(201);
    expect(storedAttachment().mimeType).toBe("image/webp");
  });
  it("PNG enviado como application/octet-stream se acepta por sus bytes", async () => {
    expect((await create(PNG, "captura", "application/octet-stream")).status).toBe(201);
    expect(storedAttachment().mimeType).toBe("image/png");
  });
  it("texto disfrazado de image/png → 415 y no se crea el ticket ni queda el archivo", async () => {
    const before = fs.readdirSync(TMP_DIR).length;
    const r = await create(TEXT, "falsa.png", "image/png");
    expect(r.status).toBe(415);
    expect(mockTicketCreate).not.toHaveBeenCalled();
    expect(fs.readdirSync(TMP_DIR).length).toBe(before);
  });
  it("HEIC por bytes (aunque se declare JPEG) → 415 con mensaje comprensible", async () => {
    const r = await create(HEIC, "IMG_0001.jpg", "image/jpeg");
    expect(r.status).toBe(415);
    expect(r.body.error).toMatch(/HEIC/);
  });
  it("HEIC declarado → 400 con mensaje comprensible", async () => {
    const r = await create(HEIC, "IMG_0001.heic", "image/heic");
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/HEIC/);
  });
});

describe("ciclo de validación del solicitante", () => {
  const TERMS = { termsAccepted: true, termsVersion: "1.0" };
  beforeEach(() => {
    __setTermsReady(true);
    mockTicketUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    mockAcceptanceCreate.mockReset().mockImplementation(async ({ data }) => ({ id: "acc-1", decidedAt: new Date(), ...data }));
  });
  const pending = (o: Record<string, unknown> = {}) =>
    (prisma.ticket.findUnique as jest.Mock).mockResolvedValue({
      id: TID, number: "TK-TEST-001", userId: OWNER, status: "pendiente_validacion",
      responsibleArea: "TECHNICIANS", assignedTechnicianId: "88888888-8888-4888-8888-888888888888", ...o,
    });

  it("aceptar → estado final CERRADO con evento USER_ACCEPTED pendiente_validacion→cerrado", async () => {
    pending();
    const r = await request(app).post(`/tickets/${TID}/user-accept`).set("Authorization", `Bearer ${tok("user")}`).send(TERMS);
    expect(r.status).toBe(200);
    expect(r.body.ticket.status).toBe("cerrado");
    expect(mockTicketUpdateMany.mock.calls[0][0]).toMatchObject({ where: { status: "pendiente_validacion" }, data: { status: "cerrado" } });
    expect(mockAcceptanceCreate.mock.calls[0][0].data).toMatchObject({ decision: "ACCEPTED", userId: OWNER, termsVersion: "1.0" });
    const ev = mockEventCreate.mock.calls.map((c) => c[0].data).find((d) => d.action === "USER_ACCEPTED");
    expect(ev).toMatchObject({ previousStatus: "pendiente_validacion", newStatus: "cerrado" });
  });
  it("otro usuario o un técnico no pueden aceptar (403); fuera de pendiente_validacion → 409", async () => {
    pending();
    expect((await request(app).post(`/tickets/${TID}/user-accept`).set("Authorization", `Bearer ${tok("user", OTHER)}`).send(TERMS)).status).toBe(403);
    expect((await request(app).post(`/tickets/${TID}/user-accept`).set("Authorization", `Bearer ${tok("technician", OTHER)}`).send(TERMS)).status).toBe(403);
    pending({ status: "cerrado" });
    expect((await request(app).post(`/tickets/${TID}/user-accept`).set("Authorization", `Bearer ${tok("user")}`).send(TERMS)).status).toBe(409);
    expect(mockAcceptanceCreate).not.toHaveBeenCalled();
  });
  it("rechazar exige razón (≥5) y devuelve el ticket a en_proceso con el mismo técnico", async () => {
    pending();
    expect((await request(app).post(`/tickets/${TID}/user-reject`).set("Authorization", `Bearer ${tok("user")}`).send({ ...TERMS })).status).toBe(400);
    expect((await request(app).post(`/tickets/${TID}/user-reject`).set("Authorization", `Bearer ${tok("user")}`).send({ ...TERMS, reason: "no" })).status).toBe(400);
    const ok = await request(app).post(`/tickets/${TID}/user-reject`).set("Authorization", `Bearer ${tok("user")}`).send({ ...TERMS, reason: "Sigue fallando" });
    expect(ok.status).toBe(200);
    expect(mockAcceptanceCreate.mock.calls.at(-1)![0].data).toMatchObject({ decision: "REJECTED", reason: "Sigue fallando" });
    const data = mockTicketUpdateMany.mock.calls.at(-1)![0].data;
    expect(data.status).toBe("en_proceso");
    expect(data).not.toHaveProperty("assignedTechnicianId");
  });
});
