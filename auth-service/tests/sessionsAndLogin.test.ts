// Fase R — sesiones con SHA-256, cambio de contraseña obligatorio, limitación
// de intentos y no-enumeración de cuentas.
import crypto from "crypto";
import request from "supertest";

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockSessionCreate = jest.fn();
const mockSessionFindUnique = jest.fn();
const mockSessionUpdateMany = jest.fn();
const mockAuthLogCreate = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      update: (...a: unknown[]) => mockUserUpdate(...a),
    },
    session: {
      create: (...a: unknown[]) => mockSessionCreate(...a),
      findUnique: (...a: unknown[]) => mockSessionFindUnique(...a),
      updateMany: (...a: unknown[]) => mockSessionUpdateMany(...a),
    },
    authLog: { create: (...a: unknown[]) => mockAuthLogCreate(...a) },
  },
}));

import { createApp } from "../src/app";
import { hashPassword } from "../src/utils/passwordSecurity";
import { loginLimiter } from "../src/security/loginRateLimiter";
import { LoginRateLimiter } from "../src/security/loginRateLimiter";

const app = createApp();
const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const PW = "Servic3#Desk-2026";
const USER_ID = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const baseUser = (o: Record<string, unknown> = {}) => ({
  id: USER_ID,
  email: "tecnico@uta.edu.ec",
  name: "Técnico Prueba",
  role: "technician",
  microsoftId: null,
  passwordHash: hashPassword(PW),
  mustChangePassword: false,
  ...o,
});

let sessions: Map<string, { userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null }>;

beforeEach(() => {
  jest.clearAllMocks();
  sessions = new Map();
  (loginLimiter as unknown as { ips: Map<string, unknown>; accounts: Map<string, unknown> }).ips.clear();
  (loginLimiter as unknown as { ips: Map<string, unknown>; accounts: Map<string, unknown> }).accounts.clear();
  mockAuthLogCreate.mockResolvedValue({});
  mockSessionCreate.mockImplementation(async ({ data }) => {
    sessions.set(data.tokenHash, { ...data, revokedAt: null });
    return data;
  });
  mockSessionFindUnique.mockImplementation(async ({ where }) => sessions.get(where.tokenHash) ?? null);
  mockSessionUpdateMany.mockImplementation(async ({ where }) => {
    let n = 0;
    for (const s of sessions.values()) {
      if ((where.tokenHash && s.tokenHash === where.tokenHash) || (where.userId && s.userId === where.userId)) {
        if (!s.revokedAt) { s.revokedAt = new Date(); n++; }
      }
    }
    return { count: n };
  });
  mockUserUpdate.mockImplementation(async ({ data }) => baseUser(data));
});

async function login(email = "tecnico@uta.edu.ec", password = PW) {
  return request(app).post("/auth/login").send({ correo: email, password });
}

describe("Sesiones: solo se guarda el SHA-256 del JWT", () => {
  it("el login persiste tokenHash = sha256(token) y nunca el token", async () => {
    mockUserFindUnique.mockResolvedValue(baseUser());
    const res = await login();
    expect(res.status).toBe(200);
    const data = mockSessionCreate.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(sha(res.body.token));
    expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain(res.body.token);
    expect(data).not.toHaveProperty("token");
  });

  it("dos logins del mismo usuario en el mismo segundo producen tokens y hashes distintos (sin colisión)", async () => {
    mockUserFindUnique.mockResolvedValue(baseUser());
    mockSessionCreate.mockImplementation(async ({ data }) => {
      if (sessions.has(data.tokenHash)) throw new Error("Unique constraint failed on tokenHash");
      sessions.set(data.tokenHash, { ...data, revokedAt: null });
      return data;
    });
    const [a, b, c] = await Promise.all([login(), login(), login()]);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(new Set([a.body.token, b.body.token, c.body.token]).size).toBe(3);
    expect(sessions.size).toBe(3);
  });

  it("el token sirve mientras la sesión exista; logout la revoca (401 después)", async () => {
    mockUserFindUnique.mockResolvedValue(baseUser());
    const { token } = (await login()).body;
    expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect(mockSessionFindUnique).toHaveBeenCalledWith({ where: { tokenHash: sha(token) } });
    expect((await request(app).post("/auth/logout").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
  });

  it("sesión expirada → 401; token firmado pero sin sesión → 401", async () => {
    mockUserFindUnique.mockResolvedValue(baseUser());
    const { token } = (await login()).body;
    sessions.get(sha(token))!.expiresAt = new Date(Date.now() - 1000);
    expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    sessions.clear();
    expect((await request(app).post("/auth/verify").set("Authorization", `Bearer ${token}`)).status).toBe(401);
  });
});

describe("Cambio de contraseña obligatorio (contraseña temporal)", () => {
  it("login con mustChangePassword → token limitado: /verify 403, /me 200", async () => {
    mockUserFindUnique.mockResolvedValue(baseUser({ role: "admin", mustChangePassword: true }));
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    const h = { Authorization: `Bearer ${res.body.token}` };
    expect((await request(app).post("/auth/verify").set(h)).status).toBe(403);
    expect((await request(app).get("/auth/me").set(h)).status).toBe(200);
  });

  it("contraseña actual incorrecta → 401; débil → 400; correcta → 200, revoca sesiones y quita el flag", async () => {
    mockUserFindUnique.mockResolvedValue(baseUser({ role: "admin", mustChangePassword: true }));
    const { token } = (await login()).body;
    const h = { Authorization: `Bearer ${token}` };
    expect((await request(app).post("/auth/change-password").set(h).send({ currentPassword: "otra-cosa", newPassword: "Nuev4-Contrasena!" })).status).toBe(401);
    expect((await request(app).post("/auth/change-password").set(h).send({ currentPassword: PW, newPassword: "corta" })).status).toBe(400);
    const ok = await request(app).post("/auth/change-password").set(h).send({ currentPassword: PW, newPassword: "Nuev4-Contrasena!2026" });
    expect(ok.status).toBe(200);
    expect(ok.body.mustChangePassword).toBe(false);
    const upd = mockUserUpdate.mock.calls.find((c) => c[0].data.passwordHash);
    expect(upd[0].data.mustChangePassword).toBe(false);
    expect(upd[0].data.passwordHash).toMatch(/^\$2/);
    expect(mockSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: USER_ID, revokedAt: null } }));
    // el token temporal quedó revocado; el nuevo funciona en /verify
    expect((await request(app).get("/auth/me").set(h)).status).toBe(401);
    expect((await request(app).post("/auth/verify").set("Authorization", `Bearer ${ok.body.token}`)).status).toBe(200);
  });
});

describe("Login: sin enumeración de cuentas y con limitación de intentos", () => {
  it("cuenta inexistente y contraseña errónea devuelven el mismo 401 y mensaje", async () => {
    mockUserFindUnique.mockResolvedValueOnce(null);
    const a = await login("noexiste@uta.edu.ec", "Cualquier-1!");
    mockUserFindUnique.mockResolvedValueOnce(baseUser());
    const b = await login("tecnico@uta.edu.ec", "Incorrecta-1!");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it("5 fallos sobre la misma cuenta → 429 con Retry-After, incluso con la contraseña correcta", async () => {
    mockUserFindUnique.mockResolvedValue(baseUser());
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await login("tecnico@uta.edu.ec", "Mala-" + i)).status);
    expect(codes.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(codes[4]).toBe(429);
    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });
});

describe("LoginRateLimiter (reloj simulado)", () => {
  const cfg = { windowMs: 15 * 60_000, maxFailuresPerIp: 20, maxFailuresPerAccount: 5, baseCooldownMs: 60_000, maxCooldownMs: 15 * 60_000 };

  it("enfriamiento progresivo 1 → 2 → 4 min y desbloqueo automático (nunca permanente)", () => {
    let now = 0;
    const l = new LoginRateLimiter(cfg, () => now);
    const lockOnce = () => { for (let i = 0; i < 5; i++) l.recordFailure("1.1.1.1", "a@uta.edu.ec"); };
    lockOnce();
    expect(l.check("1.1.1.1", "a@uta.edu.ec")).toMatchObject({ allowed: false, retryAfterSeconds: 60, scope: "account" });
    now += 60_000;
    expect(l.check("1.1.1.1", "a@uta.edu.ec").allowed).toBe(true);
    lockOnce();
    expect(l.check("1.1.1.1", "a@uta.edu.ec").retryAfterSeconds).toBe(120);
    now += 120_000;
    lockOnce();
    expect(l.check("1.1.1.1", "a@uta.edu.ec").retryAfterSeconds).toBe(240);
  });

  it("tope de enfriamiento y reinicio tras un login correcto", () => {
    let now = 0;
    const l = new LoginRateLimiter(cfg, () => now);
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 5; i++) l.recordFailure("ip", "b@uta.edu.ec");
      const d = l.check("ip", "b@uta.edu.ec");
      expect(d.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
      now += d.retryAfterSeconds * 1000;
    }
    l.recordSuccess("b@uta.edu.ec");
    l.recordFailure("ip2", "b@uta.edu.ec");
    expect(l.check("ip2", "b@uta.edu.ec").allowed).toBe(true);
  });

  it("límite por IP independiente de la cuenta (20 fallos → bloqueo de la IP)", () => {
    let now = 0;
    const l = new LoginRateLimiter(cfg, () => now);
    for (let i = 0; i < 20; i++) l.recordFailure("9.9.9.9", `u${i}@uta.edu.ec`);
    expect(l.check("9.9.9.9", "otra@uta.edu.ec")).toMatchObject({ allowed: false, scope: "ip" });
    expect(l.check("8.8.8.8", "otra@uta.edu.ec").allowed).toBe(true);
    now += cfg.windowMs;
    expect(l.check("9.9.9.9").allowed).toBe(true);
  });
});
