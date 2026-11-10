// Fase T — /health (liveness) y /health/ready (readiness con consulta real a la BD).
const mockQueryRaw = jest.fn();
jest.mock("../src/db/client", () => ({ prisma: { $queryRaw: (...a: unknown[]) => mockQueryRaw(...a) } }));
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();
beforeEach(() => mockQueryRaw.mockReset());

describe("catalog-service health", () => {
  it("/health no consulta la base (liveness)", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
  it("/health/ready → 200 cuando SELECT 1 responde", async () => {
    mockQueryRaw.mockResolvedValue([{ x: 1 }]);
    const r = await request(app).get("/health/ready");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ready", service: "catalog-service", checks: { database: "ok" } });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });
  it("/health/ready → 503 si la base falla, sin detalles internos", async () => {
    mockQueryRaw.mockRejectedValue(new Error("Login failed for user 'x' at mssql:1433"));
    const r = await request(app).get("/health/ready");
    expect(r.status).toBe(503);
    expect(r.body.checks.database).toBe("fail");
    expect(JSON.stringify(r.body)).not.toMatch(/Login failed|mssql|1433/);
  });
  it("/health/ready → 503 si la base no responde a tiempo", async () => {
    mockQueryRaw.mockImplementation(() => new Promise(() => {}));
    const r = await request(app).get("/health/ready");
    expect(r.status).toBe(503);
  }, 10000);
});
