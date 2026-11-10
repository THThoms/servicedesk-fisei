// Sprint 3+ — Tests de integración para /locations.
// Prisma mockeado; JWT real firmado con el secreto de tests/setup-env.ts.

import jwt from "jsonwebtoken";

jest.mock("../src/db/client", () => ({
  prisma: {
    location: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;

function makeToken(role: string) {
  return jwt.sign(
    { userId: "00000000-0000-4000-8000-000000000001", email: "u@uta.edu.ec", name: "Test", role },
    SECRET,
    { expiresIn: "1h" }
  );
}

const SAMPLE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Laboratorio 1",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /locations (público)", () => {
  it("lista solo activas por defecto (sin JWT)", async () => {
    (prisma.location.findMany as jest.Mock).mockResolvedValue([SAMPLE]);
    const res = await request(app).get("/locations");
    expect(res.status).toBe(200);
    expect(res.body.locations).toEqual([expect.objectContaining({ name: "Laboratorio 1" })]);
    const call = (prisma.location.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ isActive: true });
    expect(call.orderBy).toEqual({ name: "asc" });
  });

  it("includeInactive=true lista todas", async () => {
    (prisma.location.findMany as jest.Mock).mockResolvedValue([SAMPLE]);
    const res = await request(app).get("/locations?includeInactive=true");
    expect(res.status).toBe(200);
    const call = (prisma.location.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({});
  });
});

describe("POST /locations (admin)", () => {
  it("admin crea ubicación", async () => {
    (prisma.location.create as jest.Mock).mockResolvedValue(SAMPLE);
    const token = makeToken("admin");
    const res = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Laboratorio 1" });
    expect(res.status).toBe(201);
    expect(res.body.location.name).toBe("Laboratorio 1");
  });

  it("400 con nombre muy corto", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "a" });
    expect(res.status).toBe(400);
  });

  it("403 técnico no puede crear", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Laboratorio X" });
    expect(res.status).toBe(403);
  });

  it("403 usuario no puede crear", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Laboratorio X" });
    expect(res.status).toBe(403);
  });

  it("409 con nombre duplicado", async () => {
    const { Prisma } = require("@prisma/client");
    (prisma.location.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["name"] },
      })
    );
    const token = makeToken("admin");
    const res = await request(app)
      .post("/locations")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Laboratorio 1" });
    expect(res.status).toBe(409);
  });
});

describe("PUT /locations/:id (admin)", () => {
  it("admin renombra", async () => {
    (prisma.location.update as jest.Mock).mockResolvedValue({ ...SAMPLE, name: "Nuevo Lab" });
    const token = makeToken("admin");
    const res = await request(app)
      .put(`/locations/${SAMPLE.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Nuevo Lab" });
    expect(res.status).toBe(200);
    expect(res.body.location.name).toBe("Nuevo Lab");
  });

  it("400 sin cambios", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .put(`/locations/${SAMPLE.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("403 técnico no puede editar", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .put(`/locations/${SAMPLE.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "hack" });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /locations/:id (admin, soft delete)", () => {
  it("admin desactiva", async () => {
    (prisma.location.update as jest.Mock).mockResolvedValue({ ...SAMPLE, isActive: false });
    const token = makeToken("admin");
    const res = await request(app)
      .delete(`/locations/${SAMPLE.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.location.isActive).toBe(false);
    const call = (prisma.location.update as jest.Mock).mock.calls[0][0];
    expect(call.data).toEqual({ isActive: false });
  });

  it("403 técnico no puede eliminar", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .delete(`/locations/${SAMPLE.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
