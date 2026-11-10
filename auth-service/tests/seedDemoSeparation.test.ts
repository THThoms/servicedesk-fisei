// Fase X — Las cuentas demo no pueden viajar en el seed del paquete de servidor.
import fs from "fs";
import path from "path";

jest.mock("@prisma/client", () => ({ PrismaClient: jest.fn(() => ({})) }));

import { loadDemoUsers } from "../prisma/seed";

describe("separación de las cuentas demo", () => {
  it("prisma/seed.ts no contiene contraseñas ni correos de personas", () => {
    const source = fs.readFileSync(path.join(__dirname, "../prisma/seed.ts"), "utf8");
    expect(source).not.toMatch(/password:\s*"/);
    expect(source).not.toMatch(/[a-z0-9._-]+@uta\.edu\.ec/i);
  });

  it("sin seed.demo.ts (paquete de servidor) no hay usuarios y no falla", () => {
    expect(loadDemoUsers(path.join(__dirname, "no-existe"))).toBeNull();
  });

  it("la plantilla versionada crea cuentas genéricas y exige una contraseña propia", () => {
    const template = path.join(__dirname, "../prisma/seed.demo.example");
    const source = fs.readFileSync(`${template}.ts`, "utf8");
    expect(source).not.toMatch(/password:\s*"/);

    process.env.DEMO_SEED_PASSWORD = "valor-de-prueba";
    const demo = loadDemoUsers(template);
    delete process.env.DEMO_SEED_PASSWORD;
    expect(demo?.seedUsers.map((u) => u.role).sort()).toEqual(["admin", "dtic", "technician", "user"]);
    expect(demo?.seedUsers.every((u) => u.email.startsWith("demo."))).toBe(true);
  });

  it("las cuentas demo locales quedan fuera de Git", () => {
    const ignore = fs.readFileSync(path.join(__dirname, "../../.gitignore"), "utf8");
    expect(ignore).toContain("auth-service/prisma/seed.demo.ts");
  });
});
