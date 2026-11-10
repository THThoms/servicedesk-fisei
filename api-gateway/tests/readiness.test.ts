// Fase T — /health (liveness) y /health/ready (readiness real del gateway).
import request from "supertest";
import { createApp } from "../src/app";

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function mockUpstreams(status: Record<string, number | "error">) {
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input);
    const key = Object.keys(status).find((k) => url.startsWith(k))!;
    const s = status[key];
    if (s === "error") throw new Error("ECONNREFUSED");
    return new Response("{}", { status: s });
  }) as unknown as typeof fetch;
}

describe("gateway health", () => {
  it("/health responde 200 sin consultar a nadie (liveness)", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const r = await request(createApp()).get("/health");
    expect(r.status).toBe(200);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("/health/ready → 200 si los 3 servicios están listos", async () => {
    mockUpstreams({ "http://auth.test": 200, "http://catalog.test": 200, "http://ticket.test": 200 });
    const r = await request(createApp()).get("/health/ready");
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ready");
    expect((global.fetch as jest.Mock).mock.calls.map((c) => String(c[0])).sort()).toEqual([
      "http://auth.test:3001/health/ready", "http://catalog.test:3002/health/ready", "http://ticket.test:3003/health/ready",
    ]);
  });

  it("/health/ready → 503 si un servicio no está listo o no responde", async () => {
    mockUpstreams({ "http://auth.test": 200, "http://catalog.test": 503, "http://ticket.test": "error" });
    const r = await request(createApp()).get("/health/ready");
    expect(r.status).toBe(503);
    expect(r.body.checks).toEqual({ "auth-service": "ok", "catalog-service": "fail", "ticket-service": "fail" });
    expect(JSON.stringify(r.body)).not.toMatch(/ECONNREFUSED|http:\/\//);
  });
});
