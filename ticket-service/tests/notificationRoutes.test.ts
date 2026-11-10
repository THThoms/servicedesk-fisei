// Sprint 4+ — Tests de los endpoints REST para tokens FCM.
//   POST /notifications/register     idempotente por token
//   POST /notifications/unregister   solo el token del propio usuario
//   GET  /notifications/devices      lista los dispositivos del usuario

import jwt from "jsonwebtoken";

jest.mock("../src/db/client", () => ({
  prisma: {
    deviceToken: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

const VALID_TOKEN = "fake_fcm_token_" + "a".repeat(120); // >20 chars

function tok(role = "tech_n1", userId = USER_ID) {
  return jwt.sign(
    { userId, email: "t@uta.edu.ec", name: "Tec Test", role },
    SECRET,
    { expiresIn: "1h" }
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /notifications/register", () => {
  it("registra un token nuevo asociado al usuario del JWT", async () => {
    (prisma.deviceToken.upsert as jest.Mock).mockResolvedValue({
      id: "dt-1",
      userId: USER_ID,
      platform: "android",
      isActive: true,
      createdAt: new Date(),
    });
    const res = await request(app)
      .post("/notifications/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ token: VALID_TOKEN, platform: "android" });

    expect(res.status).toBe(201);
    expect(res.body.device.platform).toBe("android");

    const call = (prisma.deviceToken.upsert as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ token: VALID_TOKEN });
    expect(call.update.userId).toBe(USER_ID);
    expect(call.update.isActive).toBe(true);
    expect(call.create.userId).toBe(USER_ID);
  });

  it("es idempotente (mismo token → upsert lo actualiza sin crear duplicado)", async () => {
    (prisma.deviceToken.upsert as jest.Mock).mockResolvedValue({
      id: "dt-1",
      userId: USER_ID,
      platform: "android",
      isActive: true,
      createdAt: new Date(),
    });
    await request(app)
      .post("/notifications/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ token: VALID_TOKEN, platform: "android" });
    await request(app)
      .post("/notifications/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ token: VALID_TOKEN, platform: "android" });

    expect((prisma.deviceToken.upsert as jest.Mock)).toHaveBeenCalledTimes(2);
  });

  it("400 con token demasiado corto", async () => {
    const res = await request(app)
      .post("/notifications/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ token: "short", platform: "android" });
    expect(res.status).toBe(400);
    expect(prisma.deviceToken.upsert).not.toHaveBeenCalled();
  });

  it("400 con platform inválida", async () => {
    const res = await request(app)
      .post("/notifications/register")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ token: VALID_TOKEN, platform: "symbian" });
    expect(res.status).toBe(400);
  });

  it("401 sin JWT", async () => {
    const res = await request(app)
      .post("/notifications/register")
      .send({ token: VALID_TOKEN, platform: "android" });
    expect(res.status).toBe(401);
  });
});

describe("POST /notifications/unregister", () => {
  it("desactiva solo el token del propio usuario", async () => {
    (prisma.deviceToken.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const res = await request(app)
      .post("/notifications/unregister")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ token: VALID_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.deactivated).toBe(1);
    const call = (prisma.deviceToken.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where.token).toBe(VALID_TOKEN);
    expect(call.where.userId).toBe(USER_ID);
    expect(call.data.isActive).toBe(false);
  });

  it("un usuario NO puede desactivar el token de otro (updateMany devuelve 0)", async () => {
    (prisma.deviceToken.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const res = await request(app)
      .post("/notifications/unregister")
      .set("Authorization", `Bearer ${tok("tech_n1", OTHER_USER_ID)}`)
      .send({ token: VALID_TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.deactivated).toBe(0);
    const call = (prisma.deviceToken.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where.userId).toBe(OTHER_USER_ID); // filtra por su propio userId
  });

  it("400 sin token en el body", async () => {
    const res = await request(app)
      .post("/notifications/unregister")
      .set("Authorization", `Bearer ${tok()}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /notifications/devices", () => {
  it("devuelve solo los dispositivos del usuario autenticado", async () => {
    (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([
      {
        id: "d1",
        platform: "android",
        deviceId: null,
        appVersion: null,
        isActive: true,
        lastSeenAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: "d2",
        platform: "android",
        deviceId: null,
        appVersion: null,
        isActive: false,
        lastSeenAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    const res = await request(app)
      .get("/notifications/devices")
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(2);
    const call = (prisma.deviceToken.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.userId).toBe(USER_ID);
  });

  it("401 sin JWT", async () => {
    const res = await request(app).get("/notifications/devices");
    expect(res.status).toBe(401);
  });
});
