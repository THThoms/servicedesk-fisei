// Sprint 2 (rev) - Tests para GET /knowledge/:id y POST /knowledge.
// Necesarios para el flujo POST /tickets/:id/resolve (ticket-service).

import jwt from "jsonwebtoken";

jest.mock("../src/db/client", () => ({
  prisma: {
    knowledgeArticle: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    service: {
      findUnique: jest.fn(),
    },
  },
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;
const KB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SERVICE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeToken(role: string, userId = "00000000-0000-4000-8000-000000000099") {
  return jwt.sign(
    { userId, email: "tec@uta.edu.ec", name: "Téc", role },
    SECRET,
    { expiresIn: "1h" }
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /knowledge/:id", () => {
  it("200 devuelve detalle si el artículo existe y está activo", async () => {
    (prisma.knowledgeArticle.findUnique as jest.Mock).mockResolvedValue({
      id: KB_ID,
      title: "VPN",
      problemDescription: "X",
      solution: "Y",
      keywords: ["vpn"],
      isActive: true,
      service: { id: SERVICE_ID, name: "Red e Internet" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get(`/knowledge/${KB_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.article.id).toBe(KB_ID);
  });

  it("404 si el artículo no existe", async () => {
    (prisma.knowledgeArticle.findUnique as jest.Mock).mockResolvedValue(null);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get(`/knowledge/${KB_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("404 si el artículo está soft-deleted (isActive=false)", async () => {
    (prisma.knowledgeArticle.findUnique as jest.Mock).mockResolvedValue({
      id: KB_ID,
      title: "X",
      isActive: false,
      service: null,
    });
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get(`/knowledge/${KB_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("400 si id no es UUID válido", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .get("/knowledge/not-uuid")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("401 sin JWT", async () => {
    const res = await request(app).get(`/knowledge/${KB_ID}`);
    expect(res.status).toBe(401);
  });

  it("403 si rol no es staff", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .get(`/knowledge/${KB_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /knowledge", () => {
  const VALID_BODY = {
    title: "Solución WiFi en aulas",
    problemDescription: "El WiFi se cae en aulas del bloque B en horario pico.",
    solution:
      "Reiniciar AP del bloque, validar conexión al switch y reportar saturación a redes.",
    keywords: ["wifi", "red"],
    serviceId: SERVICE_ID,
  };

  it("201 crea el artículo y devuelve su id (técnico)", async () => {
    (prisma.service.findUnique as jest.Mock).mockResolvedValue({ id: SERVICE_ID });
    (prisma.knowledgeArticle.create as jest.Mock).mockResolvedValue({
      id: KB_ID,
      title: VALID_BODY.title,
      problemDescription: VALID_BODY.problemDescription,
      solution: VALID_BODY.solution,
      keywords: ["wifi", "red"],
      service: { id: SERVICE_ID, name: "Red e Internet" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = makeToken("tech_n1");
    const res = await request(app)
      .post("/knowledge")
      .set("Authorization", `Bearer ${token}`)
      .send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.article.id).toBe(KB_ID);
    // Sprint B: keywords se persisten en la tabla puente vía nested create.
    // El shape ahora es { create: [{ keyword: "..." }, ...] } y llegan en lowercase.
    expect((prisma.knowledgeArticle.create as jest.Mock).mock.calls[0][0].data.keywords).toEqual({
      create: [{ keyword: "wifi" }, { keyword: "red" }],
    });
    // createdByUserId tomado del JWT
    expect(
      (prisma.knowledgeArticle.create as jest.Mock).mock.calls[0][0].data.createdByUserId
    ).toBeDefined();
  });

  it("201 funciona sin serviceId (campo opcional)", async () => {
    (prisma.knowledgeArticle.create as jest.Mock).mockResolvedValue({
      id: KB_ID,
      title: VALID_BODY.title,
      problemDescription: VALID_BODY.problemDescription,
      solution: VALID_BODY.solution,
      keywords: VALID_BODY.keywords,
      service: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = makeToken("admin");
    const { serviceId, ...withoutSvc } = VALID_BODY;
    void serviceId;
    const res = await request(app)
      .post("/knowledge")
      .set("Authorization", `Bearer ${token}`)
      .send(withoutSvc);
    expect(res.status).toBe(201);
    expect(prisma.service.findUnique).not.toHaveBeenCalled();
  });

  it("400 si el serviceId no existe en catalog", async () => {
    (prisma.service.findUnique as jest.Mock).mockResolvedValue(null);
    const token = makeToken("tech_n1");
    const res = await request(app)
      .post("/knowledge")
      .set("Authorization", `Bearer ${token}`)
      .send(VALID_BODY);
    expect(res.status).toBe(400);
    expect(prisma.knowledgeArticle.create).not.toHaveBeenCalled();
  });

  it("400 si keywords vacío", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .post("/knowledge")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...VALID_BODY, keywords: [] });
    expect(res.status).toBe(400);
  });

  it("400 si faltan campos obligatorios", async () => {
    const token = makeToken("tech_n1");
    const res = await request(app)
      .post("/knowledge")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "X" });
    expect(res.status).toBe(400);
  });

  it("401 sin JWT", async () => {
    const res = await request(app).post("/knowledge").send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it("403 si rol no es staff", async () => {
    const token = makeToken("user");
    const res = await request(app)
      .post("/knowledge")
      .set("Authorization", `Bearer ${token}`)
      .send(VALID_BODY);
    expect(res.status).toBe(403);
  });
});
