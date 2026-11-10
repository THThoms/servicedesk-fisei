// Fase T — Clasificación de técnicos por bloque físico de la FISEI.
// El bloque NO es un rol: solo técnicos (technician); DTIC queda independiente.
import crypto from "crypto";
import request from "supertest";

const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockSessionFindUnique = jest.fn();
const mockAuthLogCreate = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    user: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
    },
    session: { findUnique: (...a: unknown[]) => mockSessionFindUnique(...a) },
    authLog: { create: (...a: unknown[]) => mockAuthLogCreate(...a) },
  },
}));

import { createApp } from "../src/app";
import { signAuthToken } from "../src/utils/jwt";

const app = createApp();
const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const ADMIN = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const T1 = "22222222-2222-4222-8222-000000000001";
const T2 = "22222222-2222-4222-8222-000000000002";
const T3 = "22222222-2222-4222-8222-000000000003";
const D1 = "33333333-3333-4333-8333-000000000001";
const USERS = [
  { id: T1, email: "t1@uta.edu.ec", name: "Técnico Uno", role: "technician", block: "BLOQUE_1" },
  { id: T2, email: "t2@uta.edu.ec", name: "Técnico Dos", role: "technician", block: "BLOQUE_2" },
  { id: T3, email: "t3@uta.edu.ec", name: "Técnico Tres", role: "technician", block: null },
  // dato inconsistente a propósito: un DTIC con bloque NO debe mostrarse con bloque
  { id: D1, email: "d1@uta.edu.ec", name: "Persona DTIC", role: "dtic", block: "BLOQUE_1" },
];

function tokenFor(id: string, role: string) {
  const token = signAuthToken({ userId: id, email: `${role}@uta.edu.ec`, name: role, role });
  return token;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue(USERS);
  mockAuthLogCreate.mockResolvedValue({});
  // cualquier token firmado en el test tiene sesión vigente
  mockSessionFindUnique.mockImplementation(async ({ where }) => ({ tokenHash: where.tokenHash, revokedAt: null, expiresAt: new Date(Date.now() + 3600_000) }));
  mockFindUnique.mockImplementation(async ({ where }) => USERS.find((u) => u.id === where.id) ?? null);
  mockUpdate.mockImplementation(async ({ where, data }) => ({ ...USERS.find((u) => u.id === where.id)!, ...data }));
});

const admin = () => ({ Authorization: `Bearer ${tokenFor(ADMIN, "admin")}` });

describe("GET /auth/technicians con bloque", () => {
  it("devuelve el bloque de cada técnico y null para DTIC (aunque la BD tenga un valor)", async () => {
    const r = await request(app).get("/auth/technicians").set(admin());
    expect(r.status).toBe(200);
    const byId = Object.fromEntries(r.body.technicians.map((t: { id: string; block: string | null }) => [t.id, t.block]));
    expect(byId).toEqual({ [T1]: "BLOQUE_1", [T2]: "BLOQUE_2", [T3]: null, [D1]: null });
  });

  it("filtra por bloque: BLOQUE_1, BLOQUE_2 y NONE (sin clasificar); DTIC nunca entra", async () => {
    const ids = async (q: string) => (await request(app).get(`/auth/technicians?${q}`).set(admin())).body.technicians.map((t: { id: string }) => t.id);
    expect(await ids("block=BLOQUE_1")).toEqual([T1]);
    expect(await ids("block=BLOQUE_2")).toEqual([T2]);
    expect(await ids("block=NONE")).toEqual([T3]);
    expect(await ids("role=dtic")).toEqual([D1]);
  });

  it("filtros inválidos → 400; técnico o DTIC no pueden listar → 403", async () => {
    expect((await request(app).get("/auth/technicians?block=BLOQUE_9").set(admin())).status).toBe(400);
    expect((await request(app).get("/auth/technicians").set("Authorization", `Bearer ${tokenFor(T1, "technician")}`)).status).toBe(403);
    expect((await request(app).get("/auth/technicians").set("Authorization", `Bearer ${tokenFor(D1, "dtic")}`)).status).toBe(403);
  });
});

describe("PATCH /auth/technicians/:id/block", () => {
  it("el admin asigna y modifica el bloque de un técnico (y queda registrado)", async () => {
    let r = await request(app).patch(`/auth/technicians/${T3}/block`).set(admin()).send({ block: "BLOQUE_2" });
    expect(r.status).toBe(200);
    expect(r.body.technician.block).toBe("BLOQUE_2");
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: T3 }, data: { block: "BLOQUE_2" } });
    expect(mockAuthLogCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ authProvider: "admin-action" }) }));
    r = await request(app).patch(`/auth/technicians/${T1}/block`).set(admin()).send({ block: null });
    expect(r.status).toBe(200);
    expect(r.body.technician.block).toBeNull();
  });

  it("DTIC no se clasifica por bloque (409) y tampoco un usuario o admin", async () => {
    const r = await request(app).patch(`/auth/technicians/${D1}/block`).set(admin()).send({ block: "BLOQUE_1" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/DTIC/);
    mockFindUnique.mockResolvedValueOnce({ id: "x", role: "user", block: null });
    expect((await request(app).patch(`/auth/technicians/x/block`).set(admin()).send({ block: "BLOQUE_1" })).status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("solo el admin: técnico (ni siquiera sobre sí mismo) y DTIC → 403; valor inválido → 400", async () => {
    expect((await request(app).patch(`/auth/technicians/${T1}/block`).set("Authorization", `Bearer ${tokenFor(T1, "technician")}`).send({ block: "BLOQUE_2" })).status).toBe(403);
    expect((await request(app).patch(`/auth/technicians/${T1}/block`).set("Authorization", `Bearer ${tokenFor(D1, "dtic")}`).send({ block: "BLOQUE_2" })).status).toBe(403);
    expect((await request(app).patch(`/auth/technicians/${T1}/block`).set(admin()).send({ block: "BLOQUE_3" })).status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("técnico inexistente → 404", async () => {
    expect((await request(app).patch(`/auth/technicians/no-existe/block`).set(admin()).send({ block: "BLOQUE_1" })).status).toBe(404);
    expect(sha("x")).toHaveLength(64);
  });
});
