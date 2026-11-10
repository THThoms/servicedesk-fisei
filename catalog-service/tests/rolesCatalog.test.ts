// Fase R — roles oficiales en catalog-service: la base de conocimiento es de
// consulta para todo el personal (admin, technician, dtic); su administración
// (listado admin, edición, borrado, ubicaciones, servicios) es SOLO de admin.
// DTIC no es administrador. Roles heredados normalizados. pwdChange → 403.
import jwt from "jsonwebtoken";

jest.mock("../src/db/client", () => {
  const prisma: any = {
    knowledgeArticle: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn(),
    },
    knowledgeKeyword: { deleteMany: jest.fn(), createMany: jest.fn() },
    service: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    location: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return { prisma };
});

import request from "supertest";
import { createApp } from "../src/app";
import { normalizeRole } from "../src/middleware/verifyJwt";

const app = createApp();
const tok = (role: string, extra: Record<string, unknown> = {}) =>
  jwt.sign({ userId: "u1", email: "x@uta.edu.ec", name: "X", role, ...extra }, process.env.JWT_SECRET!, { expiresIn: "1h" });
const get = (url: string, role: string, extra = {}) => request(app).get(url).set("Authorization", `Bearer ${tok(role, extra)}`);

describe("base de conocimiento: consulta", () => {
  it.each(["admin", "technician", "dtic", "tech_n1", "tech_n4"])("%s → 200", async (role) => {
    expect((await get("/knowledge/search?q=", role)).status).toBe(200);
  });
  it("user → 403", async () => {
    expect((await get("/knowledge/search?q=", "user")).status).toBe(403);
  });
  it("rol desconocido degrada a user → 403", async () => {
    expect((await get("/knowledge/search?q=", "superadmin")).status).toBe(403);
  });
  it("token de cambio de contraseña pendiente → 403", async () => {
    const r = await get("/knowledge/search?q=", "admin", { pwdChange: true });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("password_change_required");
  });
});

describe("administración: solo admin (DTIC no es admin)", () => {
  it.each(["technician", "dtic", "user"])("%s → GET /knowledge/admin/list 403", async (role) => {
    expect((await get("/knowledge/admin/list", role)).status).toBe(403);
  });
  it("admin → GET /knowledge/admin/list 200", async () => {
    expect((await get("/knowledge/admin/list", "admin")).status).toBe(200);
  });
  it.each(["technician", "dtic"])("%s no puede crear ubicaciones ni servicios (403)", async (role) => {
    const h = { Authorization: `Bearer ${tok(role)}` };
    expect((await request(app).post("/locations").set(h).send({ name: "Aula X", block: "A" })).status).toBe(403);
    expect((await request(app).post("/services").set(h).send({ name: "Svc" })).status).toBe(403);
  });
});

it("normalizeRole: heredados → oficiales", () => {
  expect(normalizeRole("tech_n2")).toBe("technician");
  expect(normalizeRole("tech_n3")).toBe("dtic");
  expect(normalizeRole("dtic")).toBe("dtic");
  expect(normalizeRole(undefined)).toBe("user");
});
