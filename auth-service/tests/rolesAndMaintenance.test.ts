// Fase R — roles oficiales, normalización de roles heredados, migración
// controlada y bootstrap del administrador.
import { normalizeRole, LEGACY_ROLE_MAP, OFFICIAL_ROLES } from "../src/domain/enums";
import { migrateRoles, hashLegacySessions, purgeSessions } from "../src/maintenance/maintenance";
import { generateTemporaryPassword } from "../src/maintenance/bootstrapAdmin";

describe("roles oficiales", () => {
  it("solo admin, technician, dtic y user", () => {
    expect([...OFFICIAL_ROLES].sort()).toEqual(["admin", "dtic", "technician", "user"]);
  });
  it("normaliza heredados: n1/n2 → technician, n3/n4 → dtic; DTIC nunca es admin", () => {
    expect(normalizeRole("tech_n1")).toBe("technician");
    expect(normalizeRole("tech_n2")).toBe("technician");
    expect(normalizeRole("tech_n3")).toBe("dtic");
    expect(normalizeRole("tech_n4")).toBe("dtic");
    expect(normalizeRole("dtic")).toBe("dtic");
    expect(normalizeRole("admin")).toBe("admin");
  });
  it("un rol desconocido degrada a user (mínimo privilegio)", () => {
    expect(normalizeRole("superadmin")).toBe("user");
    expect(normalizeRole(undefined)).toBe("user");
    expect(normalizeRole("")).toBe("user");
  });
});

describe("migración controlada (SQL parametrizado, sin borrar usuarios)", () => {
  const exec = jest.fn();
  const prisma = { $executeRawUnsafe: exec } as never;
  beforeEach(() => exec.mockReset());

  it("migrateRoles ejecuta un UPDATE por rol heredado y solo cambia `role`", async () => {
    exec.mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    const r = await migrateRoles(prisma);
    expect(exec).toHaveBeenCalledTimes(Object.keys(LEGACY_ROLE_MAP).length);
    for (const call of exec.mock.calls) {
      expect(call[0]).toMatch(/^UPDATE dbo\.users SET role = @P1, updated_at = SYSUTCDATETIME\(\) WHERE role = @P2$/);
      expect(call[0]).not.toMatch(/DELETE|DROP|TRUNCATE/i);
    }
    expect(exec.mock.calls.map((c) => [c[2], c[1]])).toEqual([
      ["tech_n1", "technician"], ["tech_n2", "technician"], ["tech_n3", "dtic"], ["tech_n4", "dtic"],
    ]);
    expect(r).toEqual({ "tech_n1->technician": 2, "tech_n2->technician": 1, "tech_n3->dtic": 3 });
  });

  it("hashLegacySessions usa SHA2_256 sobre ASCII y solo toca filas que no son hash", async () => {
    exec.mockResolvedValue(5);
    expect(await hashLegacySessions(prisma)).toBe(5);
    expect(exec.mock.calls[0][0]).toMatch(/HASHBYTES\('SHA2_256', CAST\(token AS varchar\(2048\)\)\)/);
    expect(exec.mock.calls[0][0]).toMatch(/WHERE LEN\(token\) <> 64/);
  });

  it("purgeSessions solo borra sesiones caducadas/revocadas antiguas", async () => {
    exec.mockResolvedValue(7);
    expect(await purgeSessions(prisma, 7)).toBe(7);
    expect(exec.mock.calls[0][0]).toMatch(/^DELETE FROM dbo\.sessions WHERE expires_at < /);
    expect(exec.mock.calls[0][1]).toBe(7);
  });
});

describe("bootstrap del administrador", () => {
  it("la contraseña temporal es fuerte y aleatoria", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = generateTemporaryPassword();
      expect(p.length).toBeGreaterThanOrEqual(20);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[-_.]/);
      expect(p).not.toMatch(/[;'"$`\\{}#&|<> ]/);
      seen.add(p);
    }
    expect(seen.size).toBe(50);
  });
});
