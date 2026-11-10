// Fase T — /health/ready de ticket-service: base de datos + volumen de imágenes escribible.
import fs from "fs";
import os from "os";
import path from "path";
const mockQueryRaw = jest.fn();
jest.mock("../src/db/client", () => ({ prisma: { $queryRaw: (...a: unknown[]) => mockQueryRaw(...a) } }));
import request from "supertest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { checkUploadsWritable } from "../src/health/readiness";

const app = createApp();
beforeAll(() => fs.mkdirSync(env.uploadDir, { recursive: true }));
beforeEach(() => mockQueryRaw.mockReset());

describe("ticket-service health", () => {
  it("/health/ready → 200 con base y volumen correctos", async () => {
    mockQueryRaw.mockResolvedValue([{ x: 1 }]);
    const r = await request(app).get("/health/ready");
    expect(r.status).toBe(200);
    expect(r.body.checks).toEqual({ database: "ok", uploads: "ok" });
  });
  it("/health/ready → 503 si la base falla", async () => {
    mockQueryRaw.mockRejectedValue(new Error("down"));
    const r = await request(app).get("/health/ready");
    expect(r.status).toBe(503);
    expect(r.body.checks).toEqual({ database: "fail", uploads: "ok" });
  });
  it("checkUploadsWritable → false si el directorio no existe", async () => {
    expect(await checkUploadsWritable(path.join(os.tmpdir(), "no-existe-" + Date.now()))).toBe(false);
    expect(await checkUploadsWritable(env.uploadDir)).toBe(true);
  });
});
