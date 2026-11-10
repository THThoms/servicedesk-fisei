import jwt from "jsonwebtoken";

// HU-09: POST /tickets ahora corre en transacción para registrar el evento
// CREATED. El mock simula $transaction(fn) invocando `fn(tx)` con un cliente
// que reenvía las operaciones al mock global.
const mockTicketCreate = jest.fn();
const mockEventCreate = jest.fn();

jest.mock("../src/db/client", () => ({
  prisma: {
    ticket: {
      create: jest.fn((...args) => mockTicketCreate(...args)),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    ticketEvent: {
      create: jest.fn(),
    },
    $transaction: jest.fn((fn) =>
      fn({
        ticket: { create: mockTicketCreate },
        ticketEvent: { create: mockEventCreate },
      })
    ),
  },
}));

jest.mock("../src/services/catalogClient", () => {
  const actual = jest.requireActual("../src/services/catalogClient");
  return {
    ...actual,
    fetchService: jest.fn(),
  };
});

jest.mock("../src/services/ticketNumber", () => ({
  generateTicketNumber: jest.fn(),
}));

import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";
import { fetchService } from "../src/services/catalogClient";
import { generateTicketNumber } from "../src/services/ticketNumber";

const app = createApp();
const SECRET = process.env.JWT_SECRET!;

function makeToken(role: string, userId = "00000000-0000-4000-8000-000000000010") {
  return jwt.sign(
    {
      userId,
      email: "user@uta.edu.ec",
      name: "Ticket User",
      role,
    },
    SECRET,
    { expiresIn: "1h" }
  );
}

const SERVICE_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /tickets", () => {
  it("crea un ticket y asigna N1 para 'Red e Internet' con prioridad por defecto", async () => {
    (fetchService as jest.Mock).mockResolvedValue({
      id: SERVICE_ID,
      name: "Red e Internet",
      isActive: true,
      levelEntry: "N1",
      routingRule: {
        levelEntry: "N1",
        priorityHigh: "N2",
        priorityCritical: "N3",
        isCritical: false,
      },
    });
    (generateTicketNumber as jest.Mock).mockResolvedValue("TK-20260518-001");
    mockTicketCreate.mockImplementation(async ({ data }) => ({
      id: "44444444-4444-4444-8444-444444444444",
      status: "abierto",
      priority: data.priority ?? "media",
      ...data,
      attachments: [],
    }));

    const token = makeToken("user");
    const res = await request(app)
      .post("/tickets")
      .set("Authorization", `Bearer ${token}`)
      .field("serviceId", SERVICE_ID)
      .field("detail", "No hay conectividad en el laboratorio.");

    expect(res.status).toBe(201);
    expect(res.body.ticket.levelAssigned).toBe("N1");
    expect(res.body.ticket.priority).toBe("media");
    expect(mockTicketCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serviceId: SERVICE_ID,
          levelAssigned: "N1",
        }),
      })
    );
    // HU-09: la creación dispara también un evento CREATED.
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CREATED",
          newLevel: "N1",
          newStatus: "abierto",
        }),
      })
    );
  });

  // Sprint 2 (rev): si el servicio no trae routingRule legacy, ya no se rechaza
  // la creación. El flujo nuevo se basa en `responsibleArea`; `levelAssigned`
  // se rellena con `service.levelEntry` (o N1) como fallback de compat.
  it("usa fallback de levelEntry si el servicio no tiene routingRule", async () => {
    (fetchService as jest.Mock).mockResolvedValue({
      id: SERVICE_ID,
      name: "Servicio sin regla",
      isActive: true,
      levelEntry: "N2",
      responsibleArea: "DTIC",
      routingRule: null,
    });
    (generateTicketNumber as jest.Mock).mockResolvedValue("TK-FALLBACK-001");
    mockTicketCreate.mockImplementation(async ({ data }) => ({
      id: "55555555-5555-4555-8555-555555555555",
      status: "abierto",
      priority: data.priority ?? "media",
      ...data,
      attachments: [],
    }));

    const token = makeToken("user");
    const res = await request(app)
      .post("/tickets")
      .set("Authorization", `Bearer ${token}`)
      .field("serviceId", SERVICE_ID)
      .field("detail", "Incidente sin regla de enrutamiento legacy.");

    expect(res.status).toBe(201);
    expect(res.body.ticket.levelAssigned).toBe("N2");
    expect(mockTicketCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serviceId: SERVICE_ID,
          levelAssigned: "N2",
          responsibleArea: "DTIC",
        }),
      })
    );
  });
});
