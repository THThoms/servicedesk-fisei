// Fase P · seguridad — los logins SIN contraseña (dev-login y Microsoft
// simulado) jamás deben funcionar con NODE_ENV=production, aunque las
// variables AUTH_DEV_LOGIN / AUTH_MICROSOFT_SIMULATE estén en "true".
// La restricción se valida en backend (HTTP 404) y en /auth/config.

import request from "supertest";
import type { Express } from "express";

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserCreate = jest.fn();
const mockSessionCreate = jest.fn();
const mockAuthLogCreate = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      update: (...a: unknown[]) => mockUserUpdate(...a),
      create: (...a: unknown[]) => mockUserCreate(...a),
    },
    session: { create: (...a: unknown[]) => mockSessionCreate(...a) },
    authLog: { create: (...a: unknown[]) => mockAuthLogCreate(...a) },
  },
}));

const ORIGINAL_ENV = { ...process.env };

function loadApp(envOverrides: Record<string, string | undefined>): Express {
  process.env = { ...ORIGINAL_ENV, ...envOverrides };
  let app: Express | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createApp } = require("../src/app");
    app = createApp();
  });
  return app!;
}

const ADMIN = {
  id: "11111111-1111-4111-8111-aaaaaaaaaaaa",
  email: "admin@uta.edu.ec",
  name: "Administrador UTA",
  role: "admin",
  microsoftId: null,
  passwordHash: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockResolvedValue(ADMIN);
  mockUserUpdate.mockResolvedValue(ADMIN);
  mockUserCreate.mockResolvedValue(ADMIN);
  mockSessionCreate.mockResolvedValue({ id: "sess" });
  mockAuthLogCreate.mockResolvedValue({ id: "log" });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("NODE_ENV=production con flags inseguros activados", () => {
  const prodEnv = {
    NODE_ENV: "production",
    AUTH_DEV_LOGIN: "true",
    AUTH_MICROSOFT_SIMULATE: "true",
  };

  it("POST /auth/microsoft-simulate → 404 y no emite token ni toca la BD", async () => {
    const app = loadApp(prodEnv);
    const res = await request(app)
      .post("/auth/microsoft-simulate")
      .send({ email: "admin@uta.edu.ec" });
    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockUserCreate).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("POST /auth/microsoft-simulate sin body (correo por defecto) → 404", async () => {
    const app = loadApp(prodEnv);
    const res = await request(app).post("/auth/microsoft-simulate").send({});
    expect(res.status).toBe(404);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("POST /auth/dev-login → 404 y no emite token", async () => {
    const app = loadApp(prodEnv);
    const res = await request(app).post("/auth/dev-login").send({ email: "admin@uta.edu.ec" });
    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("GET /auth/config informa ambos mecanismos deshabilitados", async () => {
    const app = loadApp(prodEnv);
    const res = await request(app).get("/auth/config");
    expect(res.status).toBe(200);
    expect(res.body.devLoginEnabled).toBe(false);
    expect(res.body.microsoftSimulateEnabled).toBe(false);
  });
});

describe("NODE_ENV=production sin flags (configuración por defecto)", () => {
  it("ambos endpoints → 404", async () => {
    const app = loadApp({
      NODE_ENV: "production",
      AUTH_DEV_LOGIN: undefined,
      AUTH_MICROSOFT_SIMULATE: undefined,
    });
    expect((await request(app).post("/auth/microsoft-simulate").send({})).status).toBe(404);
    expect((await request(app).post("/auth/dev-login").send({ email: "admin@uta.edu.ec" })).status).toBe(404);
  });
});

describe("Desarrollo: los flags son opt-in explícito", () => {
  it("sin AUTH_MICROSOFT_SIMULATE el simulado está apagado aun en development", async () => {
    const app = loadApp({ NODE_ENV: "development", AUTH_MICROSOFT_SIMULATE: undefined });
    const res = await request(app).post("/auth/microsoft-simulate").send({});
    expect(res.status).toBe(404);
    const cfg = await request(app).get("/auth/config");
    expect(cfg.body.microsoftSimulateEnabled).toBe(false);
  });

  it("con AUTH_MICROSOFT_SIMULATE=true en development funciona (laboratorio)", async () => {
    const app = loadApp({ NODE_ENV: "development", AUTH_MICROSOFT_SIMULATE: "true" });
    const res = await request(app)
      .post("/auth/microsoft-simulate")
      .send({ email: "admin@uta.edu.ec" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    const cfg = await request(app).get("/auth/config");
    expect(cfg.body.microsoftSimulateEnabled).toBe(true);
  });

  it("con AUTH_DEV_LOGIN=true en development funciona (laboratorio)", async () => {
    const app = loadApp({ NODE_ENV: "development", AUTH_DEV_LOGIN: "true" });
    const res = await request(app).post("/auth/dev-login").send({ email: "admin@uta.edu.ec" });
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
  });
});
