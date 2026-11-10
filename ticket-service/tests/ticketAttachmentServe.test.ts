// Sprint L · P2 — tests del endpoint autenticado
// GET /tickets/:id/attachments/:attachmentId
//
// Escenarios cubiertos:
//   1. Dueño del ticket recibe el binario con Content-Type real (200).
//   2. Técnico del área del ticket recibe el binario (200). (Cruces de área: areaIsolation.test.ts)
//   3. Admin recibe el binario (200).
//   4. Otro usuario (no dueño, no staff) recibe 403.
//   5. Sin token JWT recibe 401.
//   6. Ticket inexistente → 404.
//   7. Attachment inexistente → 404.
//   8. Attachment que existe pero pertenece a otro ticket → 403 (no filtra existencia).
//   9. Attachment con archivo físico ausente → 404 (mensaje legible).
//  10. Attachment cloudinary → 302 redirect al secure_url.
//  11. Defensa contra path traversal (basename con "../") → 404.
//
// El test usa un directorio temporal como UPLOAD_DIR para evitar tocar la
// carpeta uploads real del proyecto.

import fs from "fs";
import os from "os";
import path from "path";
import jwt from "jsonwebtoken";

// Directorio temporal exclusivo del test — creado antes de que se cargue
// src/config/env.ts (ese módulo lee UPLOAD_DIR una sola vez).
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sd-uploads-"));
process.env.UPLOAD_DIR = TMP_DIR;

// PNG 1x1 mínimo válido (89 bytes). Sirve para verificar Content-Type y bytes.
const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
    "0000000d49444154789c62000200000005000105f8b47f7c0000000049454e44ae426082",
  "hex"
);
const FILENAME = "sample-attachment.png";
fs.writeFileSync(path.join(TMP_DIR, FILENAME), PNG_1x1);

// Mocks de Prisma antes de importar la app.
jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: { findUnique: jest.fn() },
    attachment: { findUnique: jest.fn() },
  },
}));
// authClient no debe pegarle a la red durante estos tests.
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

const app = createApp();
const SECRET = process.env.JWT_SECRET!;

const TICKET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TICKET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function tokenFor(role: string, userId: string) {
  return jwt.sign({ userId, email: "u@uta.edu.ec", name: "T User", role }, SECRET, {
    expiresIn: "1h",
  });
}

function mockTicket(exists = true, userId = OWNER_ID) {
  (prisma.ticket.findUnique as jest.Mock).mockResolvedValue(
    exists ? { id: TICKET_ID, userId, responsibleArea: "TECHNICIANS", assignedTechnicianId: null } : null
  );
}
function mockAttachment(overrides: Partial<{
  ticketId: string;
  filePath: string | null;
  imageUrl: string | null;
  storageProvider: string;
  mimeType: string | null;
}> = {}) {
  (prisma.attachment.findUnique as jest.Mock).mockResolvedValue({
    id: ATTACHMENT_ID,
    ticketId: overrides.ticketId ?? TICKET_ID,
    filePath: overrides.filePath ?? FILENAME,
    imageUrl: overrides.imageUrl ?? `/uploads/${FILENAME}`,
    storageProvider: overrides.storageProvider ?? "local",
    mimeType: overrides.mimeType ?? "image/png",
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  // Limpieza del directorio temporal.
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* si el runner ya lo borró, no importa */
  }
});

describe("GET /tickets/:id/attachments/:attachmentId — Sprint L · P2", () => {
  it("401 sin Authorization header", async () => {
    const res = await request(app).get(
      `/tickets/${TICKET_ID}/attachments/${ATTACHMENT_ID}`
    );
    expect(res.status).toBe(401);
  });

  it("404 si el ticket no existe", async () => {
    mockTicket(false);
    const res = await request(app)
      .get(`/tickets/${TICKET_ID}/attachments/${ATTACHMENT_ID}`)
      .set("Authorization", `Bearer ${tokenFor("user", OWNER_ID)}`);
    expect(res.status).toBe(404);
  });

  it("403 cuando el usuario no es dueño ni staff", async () => {
    mockTicket();
    const res = await request(app)
      .get(`/tickets/${TICKET_ID}/attachments/${ATTACHMENT_ID}`)
      .set("Authorization", `Bearer ${tokenFor("user", OTHER_USER_ID)}`);
    expect(res.status).toBe(403);
    // El attachment NO debe consultarse si el usuario no tiene permiso.
    expect(prisma.attachment.findUnique).not.toHaveBeenCalled();
  });

  it("200 y sirve el binario con Content-Type image/png al dueño", async () => {
    mockTicket();
    mockAttachment();
    const res = await request(app)
      .get(`/tickets/${TICKET_ID}/attachments/${ATTACHMENT_ID}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .set("Authorization", `Bearer ${tokenFor("user", OWNER_ID)}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^image\/png/i);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toContain("private");
    // Los bytes servidos deben ser exactamente el PNG que escribimos.
    const body: Buffer = res.body as Buffer;
    expect(body).toBeInstanceOf(Buffer);
    expect(body.length).toBe(PNG_1x1.length);
    expect(body.equals(PNG_1x1)).toBe(true);
  });

  it("Fase T: el id del ticket en MAYÚSCULAS (enlace de notificación / GUID de SQL Server) no da un falso 403", async () => {
    mockTicket(true, OWNER_ID.toUpperCase());
    mockAttachment();
    const res = await request(app)
      .get(`/tickets/${TICKET_ID.toUpperCase()}/attachments/${ATTACHMENT_ID.toUpperCase()}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .set("Authorization", `Bearer ${tokenFor("user", OWNER_ID)}`);
    expect(res.status).toBe(200);
    expect((res.body as Buffer).equals(PNG_1x1)).toBe(true);
  });

  it("200 con rol técnico aunque no sea dueño", async () => {
    mockTicket(true, OWNER_ID);
    mockAttachment();
    const res = await request(app)
      .get(`/tickets/${TICKET_ID}/attachments/${ATTACHMENT_ID}`)
      .set("Authorization", `Bearer ${tokenFor("tech_n1", OTHER_USER_ID)}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^image\/png/i);
  });

  it("200 con rol admin aunque no sea dueño", async () => {
    mockTicket(true, OWNER_ID);
    mockAttachment();
    const res = await request(app)
      .get(`/tickets/${TICKET_ID}/attachments/${ATTACHMENT_ID}`)
      .set("Authorization", `Bearer ${tokenFor("admin", OTHER_USER_ID)}`);
    expect(res.status).toBe(200);
  });

  it("404 si el attachment no existe", async () => {
    mockTicket();
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .get(`/tickets/${TICKET_ID}/attachments/${ATTACHMENT_ID}`)
      .set("Authorization", `Bearer ${tokenFor("user", OWNER_ID)}`);
    expect(res.status).toBe(404);
  });

  it("403 si el attachment pertenece a OTRO ticket", async () => {
    mockTicket();
    mockAttachment({ ticketId: OTHER_TICKET_ID });
    const res = await request(app)
      .get(`/tickets/${TICKET_ID}/attachments/${ATTACHMENT_ID}`)
      .set("Authorization", `Bearer ${tokenFor("user", OWNER_ID)}`);
    expect(res.status).toBe(403);
  });

  it("404 si el archivo físico ya no existe en disco", async () => {
    mockTicket();
    mockAttachment({ filePath: "missing-file.png", imageUrl: "/uploads/missing-file.png" });
    const res = await request(app)
      .get(`/tickets/${TICKET_ID}/attachments/${ATTACHMENT_ID}`)
      .set("Authorization", `Bearer ${tokenFor("user", OWNER_ID)}`);
    expect(res.status).toBe(404);
  });

  it("302 redirect al secure_url para attachments cloudinary", async () => {
    mockTicket();
    mockAttachment({
      storageProvider: "cloudinary",
      imageUrl: "https://res.cloudinary.com/demo/image/upload/v1/foo.png",
      filePath: null,
      mimeType: "image/png",
    });
    const res = await request(app)
      .get(`/tickets/${TICKET_ID}/attachments/${ATTACHMENT_ID}`)
      .set("Authorization", `Bearer ${tokenFor("user", OWNER_ID)}`)
      .redirects(0); // no seguimos el redirect
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      "https://res.cloudinary.com/demo/image/upload/v1/foo.png"
    );
  });

  it("404 defensa contra path traversal en filePath", async () => {
    mockTicket();
    // Simulamos un filePath malicioso; el endpoint lo debe rechazar antes de
    // tocar disco. `path.basename` en Linux devolvería "passwd", pero cubrimos
    // ambos separadores con la validación explícita de "..".
    mockAttachment({ filePath: "../../etc/passwd", imageUrl: null });
    const res = await request(app)
      .get(`/tickets/${TICKET_ID}/attachments/${ATTACHMENT_ID}`)
      .set("Authorization", `Bearer ${tokenFor("user", OWNER_ID)}`);
    expect([400, 404]).toContain(res.status);
  });
});
