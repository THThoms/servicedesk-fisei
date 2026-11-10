// Sprint 4+ — Tests del sender FCM.
//   · mode=off  → no consulta BD ni envía.
//   · mode=log  → consulta tokens y "loguea" (no envía real).
//   · Tokens inválidos devueltos por Firebase → isActive=false en BD.

jest.mock("../src/db/client", () => ({
  prisma: {
    deviceToken: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { prisma } from "../src/db/client";
import { env } from "../src/config/env";
import {
  sendPushToUsers,
  dispatchPushInBackground,
  __resetFcmSenderForTests,
} from "../src/services/fcmService";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  jest.clearAllMocks();
  __resetFcmSenderForTests();
});

describe("fcmService · mode=off", () => {
  it("no consulta BD ni intenta enviar", async () => {
    (env as { fcm: { mode: string } }).fcm.mode = "off";
    __resetFcmSenderForTests();
    const res = await sendPushToUsers([USER_A, USER_B], {
      title: "t",
      body: "b",
    });
    expect(res).toEqual({ tokensSent: 0, success: 0, invalidated: 0 });
    expect(prisma.deviceToken.findMany).not.toHaveBeenCalled();
  });

  it("noop si no hay userIds", async () => {
    (env as { fcm: { mode: string } }).fcm.mode = "log";
    __resetFcmSenderForTests();
    const res = await sendPushToUsers([], { title: "t", body: "b" });
    expect(res.tokensSent).toBe(0);
    expect(prisma.deviceToken.findMany).not.toHaveBeenCalled();
  });
});

describe("fcmService · mode=log", () => {
  it("consulta solo tokens activos de los userIds indicados", async () => {
    (env as { fcm: { mode: string } }).fcm.mode = "log";
    __resetFcmSenderForTests();
    (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([
      { token: "tok-1" },
      { token: "tok-2" },
    ]);
    const res = await sendPushToUsers([USER_A, USER_B], {
      title: "Nuevo ticket TK-1",
      body: "Test",
      deepLink: "/tickets/abc",
    });
    expect(res.tokensSent).toBe(2);
    expect(res.success).toBe(2);
    expect(res.invalidated).toBe(0);
    const call = (prisma.deviceToken.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({
      userId: { in: [USER_A, USER_B] },
      isActive: true,
    });
  });

  it("si no hay tokens activos, resuelve con contadores en 0", async () => {
    (env as { fcm: { mode: string } }).fcm.mode = "log";
    __resetFcmSenderForTests();
    (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([]);
    const res = await sendPushToUsers([USER_A], { title: "t", body: "b" });
    expect(res).toEqual({ tokensSent: 0, success: 0, invalidated: 0 });
  });
});

describe("fcmService · firebase-admin ausente cae a log", () => {
  it("mode=firebase sin credenciales cae a log con warning", async () => {
    (env as { fcm: unknown }).fcm = {
      mode: "firebase",
      projectId: "",
      clientEmail: "",
      privateKey: "",
    };
    __resetFcmSenderForTests();
    (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue([
      { token: "tok-1" },
    ]);
    const res = await sendPushToUsers([USER_A], { title: "t", body: "b" });
    expect(res.tokensSent).toBe(1);
    // El sender terminó siendo "log" — success=tokens totales.
    expect(res.success).toBe(1);
  });
});

describe("dispatchPushInBackground", () => {
  it("nunca throws, aunque el sender falle", async () => {
    (env as { fcm: { mode: string } }).fcm.mode = "log";
    __resetFcmSenderForTests();
    (prisma.deviceToken.findMany as jest.Mock).mockRejectedValue(
      new Error("BD caída")
    );
    // La función es fire-and-forget, no debe lanzar.
    expect(() =>
      dispatchPushInBackground([USER_A], { title: "t", body: "b" })
    ).not.toThrow();
    // Esperar microtask para que la promesa interna resuelva.
    await new Promise((r) => setTimeout(r, 10));
  });
});
