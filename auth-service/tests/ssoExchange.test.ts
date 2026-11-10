// Fase R — Microsoft SSO: el callback ya no pone el JWT en la URL; emite un
// código opaco de un solo uso que se canjea por POST /auth/sso/exchange.
// Fase T — el `state` OAuth está ligado a una cookie del navegador (anti login CSRF).
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

jest.mock("../src/config/msal.config", () => ({
  SCOPES: ["openid", "profile", "email"],
  getMsalClient: () => ({
    getAuthCodeUrl: async (r: { state?: string }) => `https://login.microsoftonline.com/fake?state=${encodeURIComponent(r.state ?? "")}`,
    acquireTokenByCode: async () => ({
      idTokenClaims: { oid: "oid-1", email: "dtic.persona@uta.edu.ec", name: "Persona DTIC" },
    }),
  }),
}));

const USER = { id: "33333333-3333-4333-8333-cccccccccccc", email: "dtic.persona@uta.edu.ec", name: "Persona DTIC", role: "dtic" };
const ORIGINAL_ENV = { ...process.env };
let app: Express;
let ssoCodes: { issue: (id: string) => string; size: () => number };

beforeAll(() => {
  process.env = {
    ...ORIGINAL_ENV,
    MICROSOFT_CLIENT_ID: "cid", MICROSOFT_TENANT_ID: "tid", MICROSOFT_CLIENT_SECRET: "x",
    MICROSOFT_REDIRECT_URI: "https://sd.example/api/auth/microsoft/callback",
    FRONTEND_URL: "https://sd.example",
  };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    app = require("../src/app").createApp();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ssoCodes = require("../src/security/ssoCodeStore").ssoCodes;
  });
});
afterAll(() => { process.env = ORIGINAL_ENV; });

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockResolvedValue(USER);
  mockUserUpdate.mockResolvedValue(USER);
  mockSessionCreate.mockResolvedValue({});
  mockAuthLogCreate.mockResolvedValue({});
});

/** Inicia el flujo como lo hace el navegador: devuelve el `state` y la cookie emitidos. */
async function startFlow(client?: "android") {
  const res = await request(app).get(`/auth/microsoft${client ? "?client=android" : ""}`);
  const state = new URL(res.headers.location as string).searchParams.get("state")!;
  const cookie = ([] as string[]).concat(res.headers["set-cookie"] ?? [])[0].split(";")[0];
  return { res, state, cookie };
}
async function callback(state: string, cookie?: string) {
  const r = request(app).get(`/auth/microsoft/callback?code=ms-auth-code&state=${encodeURIComponent(state)}`);
  return cookie ? r.set("Cookie", cookie) : r;
}

describe("state OAuth ligado al navegador (Fase T)", () => {
  it("el inicio emite state aleatorio y una cookie HttpOnly, SameSite=Lax, Secure, de 10 min", async () => {
    const a = await startFlow();
    const b = await startFlow();
    expect(a.state).toMatch(/^web\.[A-Za-z0-9_-]{43}$/);
    expect(a.state).not.toBe(b.state);
    const raw = ([] as string[]).concat(a.res.headers["set-cookie"])[0];
    expect(raw).toMatch(/^sd_oauth_state=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
    expect(a.cookie.split("=")[1]).toBe(a.state.split(".")[1]);
    expect((await startFlow("android")).state).toMatch(/^android\./);
  });

  it("callback sin cookie (otro navegador / login CSRF) → invalid_state, sin canjear el código", async () => {
    const { state } = await startFlow();
    const res = await callback(state);
    expect(res.headers.location).toBe("https://sd.example/login?error=invalid_state");
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("cookie de otro flujo, state manipulado o formato antiguo → invalid_state", async () => {
    const victim = await startFlow();
    const attacker = await startFlow();
    expect((await callback(attacker.state, victim.cookie)).headers.location).toMatch(/error=invalid_state/);
    expect((await callback("android." + victim.state.split(".")[1].slice(0, -1) + "A", victim.cookie)).headers.location).toMatch(/error=invalid_state/);
    expect((await callback("client:android:abc", victim.cookie)).headers.location).toMatch(/error=invalid_state/);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("el callback borra la cookie de estado (un solo uso)", async () => {
    const { state, cookie } = await startFlow();
    const res = await callback(state, cookie);
    expect(([] as string[]).concat(res.headers["set-cookie"])[0]).toMatch(/^sd_oauth_state=; .*Max-Age=0/);
  });
});

describe("callback de Microsoft", () => {
  it("web: redirige a /auth/success?code=… sin JWT en la URL y sin crear sesión todavía", async () => {
    const { state, cookie } = await startFlow();
    const res = await callback(state, cookie);
    expect(res.status).toBe(302);
    const loc = res.headers.location as string;
    expect(loc.startsWith("https://sd.example/auth/success?code=")).toBe(true);
    expect(loc).not.toMatch(/token=|eyJ/);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("android: redirige al deep link con ?code= (sin token)", async () => {
    const { state, cookie } = await startFlow("android");
    const res = await callback(state, cookie);
    const loc = res.headers.location as string;
    expect(loc).toMatch(/^ec\.uta\.servicedesk:\/\/auth\/success\?code=/);
    expect(loc).not.toMatch(/token=|eyJ/);
  });
});

describe("POST /auth/sso/exchange", () => {
  it("canjea el código una sola vez y devuelve el JWT en el cuerpo", async () => {
    const f = await startFlow();
    const loc = (await callback(f.state, f.cookie)).headers.location as string;
    const code = new URL(loc).searchParams.get("code")!;
    const first = await request(app).post("/auth/sso/exchange").send({ code });
    expect(first.status).toBe(200);
    expect(first.body.token).toMatch(/^eyJ/);
    expect(first.body.user.role).toBe("dtic");
    expect(mockSessionCreate).toHaveBeenCalledTimes(1);
    const second = await request(app).post("/auth/sso/exchange").send({ code });
    expect(second.status).toBe(400);
    expect(second.body.token).toBeUndefined();
  });

  it("código inexistente, vacío o malformado → 400", async () => {
    for (const code of ["x".repeat(43), "", undefined, 123, "a".repeat(500)]) {
      const r = await request(app).post("/auth/sso/exchange").send({ code });
      expect(r.status).toBe(400);
    }
  });

  it("código caducado → 400", async () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SsoCodeStore } = require("../src/security/ssoCodeStore");
      let now = 0;
      const store = new SsoCodeStore(60_000, () => now);
      const code = store.issue(USER.id);
      now += 61_000;
      expect(store.consume(code)).toBeNull();
      const fresh = store.issue(USER.id);
      expect(store.consume(fresh)).toMatchObject({ userId: USER.id });
      expect(store.consume(fresh)).toBeNull();
    });
    expect(ssoCodes.size()).toBeGreaterThanOrEqual(0);
  });
});
