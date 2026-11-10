// HU-13 - Tests del flujo de login local (POST /auth/login):
//   - login correcto genera JWT y no expone passwordHash
//   - login incorrecto devuelve mensaje genérico (no revela correo vs password)
//   - hash legacy SHA-256 se migra a bcrypt tras login correcto
//   - usuario Microsoft sin passwordHash no permite login local (sin romper SSO)

import crypto from "crypto";

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserUpsert = jest.fn();
const mockUserCreate = jest.fn();
const mockSessionCreate = jest.fn();
const mockAuthLogCreate = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      update: (...a: unknown[]) => mockUserUpdate(...a),
      upsert: (...a: unknown[]) => mockUserUpsert(...a),
      create: (...a: unknown[]) => mockUserCreate(...a),
    },
    session: { create: (...a: unknown[]) => mockSessionCreate(...a) },
    authLog: { create: (...a: unknown[]) => mockAuthLogCreate(...a) },
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { hashPassword } from "../src/utils/passwordSecurity";

const app = createApp();
const VALID = "Servic3#Desk";
const USER_ID = "11111111-1111-4111-8111-aaaaaaaaaaaa";

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "docente@uta.edu.ec",
    name: "Docente de Prueba",
    role: "user",
    microsoftId: null,
    passwordHash: hashPassword(VALID),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessionCreate.mockResolvedValue({ id: "sess" });
  mockAuthLogCreate.mockResolvedValue({ id: "log" });
  mockUserUpdate.mockImplementation(async (args) => ({
    id: args.where?.id ?? USER_ID,
    email: "docente@uta.edu.ec",
    name: "Docente de Prueba",
    role: "user",
    microsoftId: null,
    passwordHash: null,
    ...(args.data ?? {}),
  }));
  mockUserUpsert.mockImplementation(async (args) => ({
    id: USER_ID,
    email: args.where.email,
    name: args.update?.name ?? args.create?.name,
    role: args.update?.role ?? args.create?.role,
    microsoftId: args.update?.microsoftId ?? args.create?.microsoftId ?? null,
    passwordHash: null,
  }));
  mockUserCreate.mockImplementation(async (args) => ({
    id: USER_ID,
    ...args.data,
    passwordHash: null,
  }));
});

describe("POST /auth/login", () => {
  it("login correcto genera JWT y NO devuelve passwordHash", async () => {
    mockUserFindUnique.mockResolvedValue(baseUser());
    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "docente@uta.edu.ec", password: VALID });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(20);
    // No se filtra el hash en ningún punto de la respuesta.
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });

  it("contraseña incorrecta devuelve 401 con mensaje genérico", async () => {
    mockUserFindUnique.mockResolvedValue(baseUser());
    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "docente@uta.edu.ec", password: "Mala#Clave9" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Credenciales inválidas");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("correo inexistente devuelve el MISMO mensaje genérico (no revela cuál falló)", async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "nadie@uta.edu.ec", password: VALID });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Credenciales inválidas");
  });

  it("migra hash legacy SHA-256 a bcrypt tras login correcto", async () => {
    const legacyHash = crypto.createHash("sha256").update(VALID).digest("hex");
    mockUserFindUnique.mockResolvedValue(baseUser({ passwordHash: legacyHash }));

    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "docente@uta.edu.ec", password: VALID });

    expect(res.status).toBe(200);
    // Debe re-hashear: update con un passwordHash bcrypt ($2...).
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockUserUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: USER_ID });
    expect(typeof updateArg.data.passwordHash).toBe("string");
    expect(updateArg.data.passwordHash.startsWith("$2")).toBe(true);
    expect(updateArg.data.passwordHash).not.toBe(legacyHash);
  });

  it("usuario Microsoft sin passwordHash no permite login local (genérico)", async () => {
    mockUserFindUnique.mockResolvedValue(
      baseUser({ passwordHash: null, microsoftId: "ms-oid-123" })
    );
    const res = await request(app)
      .post("/auth/login")
      .send({ correo: "docente@uta.edu.ec", password: VALID });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Credenciales inválidas");
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("400 si faltan credenciales", async () => {
    const res = await request(app).post("/auth/login").send({ correo: "docente@uta.edu.ec" });
    expect(res.status).toBe(400);
  });
});

// Sprint 3+ — Nueva estrategia: sin mapping correo→rol en runtime.
//   · Alta nueva: rol = admin si está en ADMIN_EMAILS, si no rol = user.
//   · Login de usuario existente: rol se preserva de BD (no se sobreescribe).
describe("POST /auth/microsoft-simulate — fuente de verdad = BD", () => {
  it("alta nueva sin ADMIN_EMAILS: crea usuario con rol 'user' (sin hardcode)", async () => {
    // Ningún usuario existe todavía → findUnique devuelve null.
    mockUserFindUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .post("/auth/microsoft-simulate")
      .send({ email: "nuevo.docente@uta.edu.ec" });

    expect(res.status).toBe(200);
    expect(res.body.user.rol).toBe("user");
    expect(res.body.user.correo).toBe("nuevo.docente@uta.edu.ec");
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");

    // Se usa create (no upsert), sin sobreescribir rol.
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
    const createArg = mockUserCreate.mock.calls[0][0];
    expect(createArg.data.email).toBe("nuevo.docente@uta.edu.ec");
    expect(createArg.data.role).toBe("user");
    expect(createArg.data).not.toHaveProperty("passwordHash");
  });

  it("login de usuario existente NO sobreescribe su rol (respeta BD)", async () => {
    // El usuario ya existe como tech_n1 en BD.
    mockUserFindUnique.mockResolvedValueOnce({
      id: USER_ID,
      email: "tecnico.ficticio@uta.edu.ec",
      name: "Técnico Ficticio",
      role: "tech_n1",
      microsoftId: null,
      passwordHash: null,
    });

    const res = await request(app)
      .post("/auth/microsoft-simulate")
      .send({ email: "tecnico.ficticio@uta.edu.ec" });

    expect(res.status).toBe(200);
    expect(mockUserCreate).not.toHaveBeenCalled(); // no re-crea
    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockUserUpdate.mock.calls[0][0];
    // El update NO debe incluir el campo `role` (BD es fuente de verdad).
    expect(updateArg.data).not.toHaveProperty("role");
  });

  it("alta de correo listado en ADMIN_EMAILS: role = admin (bootstrap)", async () => {
    // setup-env.ts define ADMIN_EMAILS=admin@uta.edu.ec para las pruebas.
    mockUserFindUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .post("/auth/microsoft-simulate")
      .send({ email: "admin@uta.edu.ec" });

    expect(res.status).toBe(200);
    expect(res.body.user.rol).toBe("admin");
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
    expect(mockUserCreate.mock.calls[0][0].data.role).toBe("admin");
  });
});
