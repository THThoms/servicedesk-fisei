// =============================================================================
// Fase R — Endpoints heredados del modelo por NIVEL retirados (R3, R4).
// Sustituye a ticketEscalate.test.ts, ticketLevelRoute.test.ts y
// routingRoutes.test.ts (su contenido original está en el historial de git).
// Todos deben responder 410 sin tocar la base de datos, para cualquier rol.
// =============================================================================
import jwt from "jsonwebtoken";

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
    ticketEvent: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("../src/services/authClient", () => ({ fetchUsersByIds: jest.fn(), fetchTechnicians: jest.fn() }));
jest.mock("../src/services/catalogClient", () => {
  const actual = jest.requireActual("../src/services/catalogClient");
  return { ...actual, fetchService: jest.fn(), fetchAllServices: jest.fn() };
});

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const TID = "33333333-3333-4333-8333-333333333333";
const tok = (role: string) =>
  jwt.sign({ userId: "44444444-4444-4444-8444-444444444444", email: "u@uta.edu.ec", name: "U", role }, SECRET, { expiresIn: "1h" });

const LEGACY: Array<[string, string, object | undefined]> = [
  ["get", "/tickets", undefined],
  ["put", "/tickets/escalate", { ticketId: TID, reason: "subir de nivel" }],
  ["get", "/tickets/level", undefined],
  ["patch", `/tickets/${TID}/status`, { status: "cerrado" }],
  ["post", "/routing/assign", { ticketId: TID }],
  ["post", "/routing/preview", { serviceId: TID }],
];

describe.each(LEGACY)("%s %s → 410", (method, url, body) => {
  it.each(["admin", "technician", "dtic", "user", "tech_n1"])("rol %s", async (role) => {
    const r = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url)
      .set("Authorization", `Bearer ${tok(role)}`)
      .send(body ?? {});
    expect(r.status).toBe(410);
    expect(r.body.error).toBe("Endpoint retirado");
  });
});

it("PATCH /:id/status ya no puede cerrar un ticket saltándose la validación (no toca la BD)", async () => {
  await request(app).patch(`/tickets/${TID}/status`).set("Authorization", `Bearer ${tok("admin")}`).send({ status: "cerrado" });
  await request(app).patch(`/tickets/${TID}/status`).set("Authorization", `Bearer ${tok("technician")}`).send({ status: "resuelto" });
  expect(prisma.ticket.findUnique).not.toHaveBeenCalled();
  expect(prisma.ticket.update).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

it("responden 410 incluso sin JWT (no revelan nada y no tocan la BD)", async () => {
  for (const [method, url] of LEGACY) {
    const r = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url).send({});
    expect(r.status).toBe(410);
  }
  expect(prisma.ticket.findUnique).not.toHaveBeenCalled();
});
