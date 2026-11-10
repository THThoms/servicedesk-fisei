// HU-10 - Tests de integración para GET /knowledge/search.
// Prisma mockeado; JWT real firmado con el secreto de tests/setup-env.ts.

import jwt from "jsonwebtoken";

// Sprint B: se añade `knowledgeKeyword` (nuevo modelo 1:N) y `$transaction`
// (la ruta PUT /knowledge/:id ahora envuelve el update para poder resincronizar
// keywords en la tabla puente).
jest.mock("../src/db/client", () => {
  const prisma: any = {
    knowledgeArticle: {
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    knowledgeKeyword: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    service: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    location: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    // La transacción ejecuta el callback pasándole el propio cliente
    // (mock) — semántica portable a MSSQL/PG.
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return { prisma };
});

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;

function makeToken(role: string, userId = "00000000-0000-4000-8000-000000000001") {
  return jwt.sign(
    { userId, email: "u@uta.edu.ec", name: "Test", role },
    SECRET,
    { expiresIn: "1h" }
  );
}

function mockResults(results: unknown[], total = results.length) {
  (prisma.knowledgeArticle.findMany as jest.Mock).mockResolvedValue(results);
  (prisma.knowledgeArticle.count as jest.Mock).mockResolvedValue(total);
}

beforeEach(() => {
  jest.clearAllMocks();
});

// Sprint B: `keywords` es ahora una relación 1:N — Prisma devuelve
// { keyword: string } por fila. La ruta la aplana a string[] en la respuesta.
const SAMPLE_VPN = {
  id: "kb1",
  title: "Error de conexión VPN institucional",
  problemDescription: "El usuario no puede conectarse a la VPN.",
  solution: "Verificar credenciales, conexión y configuración VPN.",
  keywords: [{ keyword: "vpn" }, { keyword: "red" }, { keyword: "conexion" }],
  service: { id: "svc1", name: "Red e Internet" },
  updatedAt: new Date("2026-05-18T10:00:00Z"),
  createdAt: new Date("2026-05-18T10:00:00Z"),
};

describe("GET /knowledge/search - HU-10", () => {
  // -------------------------------------------------------------------------
  // ACs principales
  // -------------------------------------------------------------------------
  it("AC1: q=VPN devuelve soluciones relacionadas", async () => {
    mockResults([SAMPLE_VPN]);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=VPN")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.query).toBe("VPN");
    expect(res.body.total).toBe(1);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      title: expect.stringContaining("VPN"),
      service: { name: "Red e Internet" },
      keywords: expect.arrayContaining(["vpn"]),
    });
  });

  it("búsqueda construye OR sobre title/description/solution/keywords/service.name", async () => {
    mockResults([]);
    const token = makeToken("tech_n1");
    await request(app)
      .get("/knowledge/search?q=wifi")
      .set("Authorization", `Bearer ${token}`);

    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.isActive).toBe(true);
    const or = call.where.AND[0].OR;
    // Sprint B: sin `mode: "insensitive"` (CI queda a cargo de la colación SQL
    // Server) y `keywords` es ahora relación (`some.keyword`).
    expect(or).toEqual(
      expect.arrayContaining([
        { title:              { contains: "wifi" } },
        { problemDescription: { contains: "wifi" } },
        { solution:           { contains: "wifi" } },
        { keywords:           { some: { keyword: "wifi" } } },
        { service: { name: { contains: "wifi" } } },
      ])
    );
  });

  it("la query a keywords usa lowercase para case-insensitive", async () => {
    mockResults([]);
    const token = makeToken("tech_n2");
    await request(app)
      .get("/knowledge/search?q=VPN")
      .set("Authorization", `Bearer ${token}`);

    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    const or = call.where.AND[0].OR;
    expect(or).toEqual(
      expect.arrayContaining([{ keywords: { some: { keyword: "vpn" } } }])
    );
  });

  // -------------------------------------------------------------------------
  // Filtro por serviceId
  // -------------------------------------------------------------------------
  it("filtra por serviceId cuando se proporciona", async () => {
    mockResults([]);
    const token = makeToken("tech_n1");
    const svcId = "11111111-1111-4111-8111-111111111111";
    await request(app)
      .get(`/knowledge/search?q=red&serviceId=${svcId}`)
      .set("Authorization", `Bearer ${token}`);

    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.AND).toEqual(
      expect.arrayContaining([{ serviceId: svcId }])
    );
  });

  // -------------------------------------------------------------------------
  // Sprint 3+: q es OPCIONAL — se puede consultar solo por categoría o sin filtros
  // -------------------------------------------------------------------------
  it("200 sin q ni serviceId: lista todos los artículos activos", async () => {
    mockResults([SAMPLE_VPN]);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.query).toBe("");
    // where solo debería tener isActive:true (sin AND)
    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.isActive).toBe(true);
    expect(call.where.AND).toBeUndefined();
  });

  it("200 solo con serviceId: lista todos los artículos de esa categoría", async () => {
    mockResults([SAMPLE_VPN]);
    const token = makeToken("tech_n1");
    const svcId = "22222222-2222-4222-8222-222222222222";
    const res = await request(app)
      .get(`/knowledge/search?serviceId=${svcId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.isActive).toBe(true);
    expect(call.where.AND).toEqual([{ serviceId: svcId }]);
  });

  it("200 con q vacío o solo espacios (equivale a sin filtro de texto)", async () => {
    mockResults([]);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=%20%20%20")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.AND).toBeUndefined();
  });

  it("400 con q de 1 caracter (si se envía texto debe tener >=2)", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=a")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("400 con serviceId que no es UUID", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=red&serviceId=abc")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("400 con limit > 50", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=red&limit=200")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Permisos
  // -------------------------------------------------------------------------
  it("401 sin JWT", async () => {
    const res = await request(app).get("/knowledge/search?q=red");
    expect(res.status).toBe(401);
  });

  it("403 cuando el role es 'user' (no técnico ni admin)", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .get("/knowledge/search?q=red")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(prisma.knowledgeArticle.findMany).not.toHaveBeenCalled();
  });

  it("técnico autenticado puede buscar (AC10)", async () => {
    mockResults([]);
    const token = makeToken("tech_n3");
    const res = await request(app)
      .get("/knowledge/search?q=seguridad")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it("admin autenticado puede buscar (AC11)", async () => {
    mockResults([]);
    const token = makeToken("admin");
    const res = await request(app)
      .get("/knowledge/search?q=correo")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Resultados vacíos / paginación / orden
  // -------------------------------------------------------------------------
  it("AC12: búsqueda sin resultados devuelve total=0 y results=[]", async () => {
    mockResults([], 0);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/search?q=palabra-imposible-xyz")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.results).toEqual([]);
  });

  it("orden por updatedAt desc", async () => {
    mockResults([SAMPLE_VPN]);
    const token = makeToken("tech_n1");
    await request(app)
      .get("/knowledge/search?q=vpn")
      .set("Authorization", `Bearer ${token}`);
    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.orderBy).toEqual({ updatedAt: "desc" });
  });

  it("paginación page=2 limit=5 -> skip=5 take=5", async () => {
    mockResults([], 0);
    const token = makeToken("tech_n1");
    await request(app)
      .get("/knowledge/search?q=red&page=2&limit=5")
      .set("Authorization", `Bearer ${token}`);
    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.skip).toBe(5);
    expect(call.take).toBe(5);
  });
});

// =============================================================================
// Sprint 3+ — Administración de la Base de Conocimiento
// =============================================================================
describe("Sprint 3+ · GET /knowledge/admin/list", () => {
  it("admin lista con includeInactive", async () => {
    mockResults([SAMPLE_VPN]);
    const token = makeToken("admin");
    const res = await request(app)
      .get("/knowledge/admin/list?includeInactive=true")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    // Con includeInactive no debe filtrar por isActive.
    expect(call.where.isActive).toBeUndefined();
  });

  it("por defecto solo activos", async () => {
    mockResults([]);
    const token = makeToken("admin");
    await request(app)
      .get("/knowledge/admin/list")
      .set("Authorization", `Bearer ${token}`);
    const call = (prisma.knowledgeArticle.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.isActive).toBe(true);
  });

  it("403 técnico no puede acceder al admin/list", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/admin/list")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe("Sprint 3+ · PUT /knowledge/:id", () => {
  const KID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("admin actualiza título y solución", async () => {
    (prisma.knowledgeArticle.update as jest.Mock).mockResolvedValue({
      ...SAMPLE_VPN,
      id: KID,
      title: "VPN — Nueva guía",
      solution: "Pasos actualizados.",
      isActive: true,
    });
    const token = makeToken("admin");
    const res = await request(app)
      .put(`/knowledge/${KID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "VPN — Nueva guía", solution: "Pasos actualizados." });
    expect(res.status).toBe(200);
    expect(res.body.article.title).toBe("VPN — Nueva guía");
    const call = (prisma.knowledgeArticle.update as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ id: KID });
    expect(call.data).toMatchObject({ title: "VPN — Nueva guía", solution: "Pasos actualizados." });
  });

  it("403 si técnico intenta editar", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .put(`/knowledge/${KID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "hack" });
    expect(res.status).toBe(403);
    expect(prisma.knowledgeArticle.update).not.toHaveBeenCalled();
  });

  it("400 con id no UUID", async () => {
    const token = makeToken("admin");
    const res = await request(app)
      .put("/knowledge/no-uuid")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "algo" });
    expect(res.status).toBe(400);
  });

  it("404 si el artículo no existe", async () => {
    (prisma.knowledgeArticle.update as jest.Mock).mockRejectedValue(
      Object.assign(new Error("nf"), { code: "P2025" })
    );
    // Simulamos que es una PrismaClientKnownRequestError
    (prisma.knowledgeArticle.update as jest.Mock).mockRejectedValue(
      Object.assign(
        new (require("@prisma/client").Prisma.PrismaClientKnownRequestError)(
          "not found",
          { code: "P2025", clientVersion: "test", meta: {} }
        )
      )
    );
    const token = makeToken("admin");
    const res = await request(app)
      .put(`/knowledge/${KID}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "nuevo título" });
    expect(res.status).toBe(404);
  });
});

describe("Sprint 3+ · DELETE /knowledge/:id (soft delete)", () => {
  const KID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("admin desactiva (isActive=false)", async () => {
    (prisma.knowledgeArticle.update as jest.Mock).mockResolvedValue({
      id: KID,
      isActive: false,
    });
    const token = makeToken("admin");
    const res = await request(app)
      .delete(`/knowledge/${KID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.article).toEqual({ id: KID, isActive: false });
    const call = (prisma.knowledgeArticle.update as jest.Mock).mock.calls[0][0];
    expect(call.data).toEqual({ isActive: false });
  });

  it("403 técnico no puede eliminar", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .delete(`/knowledge/${KID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it("403 usuario no puede eliminar", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .delete(`/knowledge/${KID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
