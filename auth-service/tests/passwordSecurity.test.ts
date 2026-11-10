// HU-13 - Tests unitarios del helper de seguridad de contraseñas.
// Funciones puras: no requieren BD ni red.

import {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  isBcryptHash,
  isLegacyHash,
  needsRehash,
} from "../src/utils/passwordSecurity";
import crypto from "crypto";

const VALID = "Servic3#Desk"; // 12 chars, mayús, minús, número, especial

describe("validatePasswordPolicy", () => {
  it("acepta una contraseña que cumple toda la política", () => {
    const r = validatePasswordPolicy(VALID);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rechaza contraseña con menos de 8 caracteres", () => {
    const r = validatePasswordPolicy("Ab1#xy");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/8 caracteres/i);
  });

  it("rechaza contraseña sin mayúscula", () => {
    const r = validatePasswordPolicy("servic3#desk");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/mayúscula/i);
  });

  it("rechaza contraseña sin minúscula", () => {
    const r = validatePasswordPolicy("SERVIC3#DESK");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/minúscula/i);
  });

  it("rechaza contraseña sin número", () => {
    const r = validatePasswordPolicy("Service#Desk");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/número/i);
  });

  it("rechaza contraseña sin carácter especial", () => {
    const r = validatePasswordPolicy("Service3Desk");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/especial/i);
  });

  it("rechaza contraseña con espacios al inicio/fin", () => {
    const r = validatePasswordPolicy(" Servic3#Desk ");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/espacios/i);
  });

  it("rechaza contraseñas comunes (case-insensitive)", () => {
    expect(validatePasswordPolicy("password123").valid).toBe(false);
    expect(validatePasswordPolicy("Admin123").valid).toBe(false); // 'admin123' lowercased
    expect(validatePasswordPolicy("QWERTY123").valid).toBe(false);
  });

  it("rechaza contraseña igual al correo", () => {
    const r = validatePasswordPolicy("Usuario1#test@uta.edu.ec", "Usuario1#test@uta.edu.ec");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/igual al correo/i);
  });

  it("rechaza valores no string / vacíos", () => {
    expect(validatePasswordPolicy(undefined).valid).toBe(false);
    expect(validatePasswordPolicy("").valid).toBe(false);
    expect(validatePasswordPolicy(12345678 as unknown).valid).toBe(false);
  });
});

describe("hashPassword", () => {
  it("no devuelve la contraseña original y produce formato bcrypt", () => {
    const hash = hashPassword(VALID);
    expect(hash).not.toBe(VALID);
    expect(hash).not.toContain(VALID);
    expect(isBcryptHash(hash)).toBe(true);
  });

  it("genera hashes distintos para la misma contraseña (salt aleatorio)", () => {
    expect(hashPassword(VALID)).not.toBe(hashPassword(VALID));
  });
});

describe("verifyPassword (bcrypt)", () => {
  it("acepta la contraseña correcta", () => {
    const hash = hashPassword(VALID);
    const r = verifyPassword(VALID, hash);
    expect(r.ok).toBe(true);
    expect(r.legacy).toBe(false);
  });

  it("rechaza la contraseña incorrecta", () => {
    const hash = hashPassword(VALID);
    const r = verifyPassword("Otra#Clave9", hash);
    expect(r.ok).toBe(false);
  });
});

describe("verifyPassword (legacy SHA-256)", () => {
  const legacyHash = crypto.createHash("sha256").update(VALID).digest("hex");

  it("detecta el hash legacy y valida la contraseña correcta", () => {
    expect(isLegacyHash(legacyHash)).toBe(true);
    const r = verifyPassword(VALID, legacyHash);
    expect(r.ok).toBe(true);
    expect(r.legacy).toBe(true);
  });

  it("rechaza contraseña incorrecta contra hash legacy", () => {
    const r = verifyPassword("Mala#Clave1", legacyHash);
    expect(r.ok).toBe(false);
    expect(r.legacy).toBe(true);
  });

  it("needsRehash es true para legacy y false para bcrypt", () => {
    expect(needsRehash(legacyHash)).toBe(true);
    expect(needsRehash(hashPassword(VALID))).toBe(false);
  });
});
