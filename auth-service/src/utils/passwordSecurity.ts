// HU-13 - Seguridad de contraseñas.
// Centraliza la política de contraseñas, el hashing seguro (bcrypt) y la
// verificación con compatibilidad hacia hashes SHA-256 legacy.
//
// - Hashes nuevos: bcrypt con 12 salt rounds (formato "$2a$/$2b$...").
// - Hashes legacy: SHA-256 hex sin salt (64 chars). Solo se aceptan para que
//   los usuarios antiguos puedan iniciar sesión; tras un login correcto el
//   caller debe re-hashear con bcrypt (ver needsRehash / verifyPassword.legacy).
//
// Reglas de oro: nunca se loguea ni se devuelve la contraseña en claro ni el hash.

import bcrypt from "bcryptjs";
import crypto from "crypto";

const BCRYPT_ROUNDS = 12;

// Contraseñas demasiado comunes que se rechazan aunque cumplan el patrón.
// En minúsculas para comparar case-insensitive.
const COMMON_PASSWORDS = new Set([
  "password",
  "password123",
  "12345678",
  "admin123",
  "qwerty123",
  "contraseña",
  "contrasena",
  "service123",
]);

export interface PasswordPolicyResult {
  valid: boolean;
  /** Lista de violaciones legibles (vacía si valid=true). */
  errors: string[];
}

/**
 * Valida la política mínima de contraseñas:
 *  - mínimo 8 caracteres
 *  - al menos una mayúscula, una minúscula, un número y un carácter especial
 *  - sin espacios al inicio o final
 *  - distinta del correo (si se provee)
 *  - no estar en la lista de contraseñas comunes
 *
 * No lanza: devuelve { valid, errors } para que el caller decida el HTTP status.
 */
export function validatePasswordPolicy(
  password: unknown,
  email?: string
): PasswordPolicyResult {
  const errors: string[] = [];

  if (typeof password !== "string" || password.length === 0) {
    return { valid: false, errors: ["La contraseña es obligatoria."] };
  }

  if (password !== password.trim()) {
    errors.push("La contraseña no puede tener espacios al inicio o al final.");
  }
  if (password.length < 8) {
    errors.push("La contraseña debe tener al menos 8 caracteres.");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("La contraseña debe incluir al menos una letra mayúscula.");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("La contraseña debe incluir al menos una letra minúscula.");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("La contraseña debe incluir al menos un número.");
  }
  // Carácter especial: cualquier cosa que no sea letra, número o espacio.
  if (!/[^A-Za-z0-9\s]/.test(password)) {
    errors.push("La contraseña debe incluir al menos un carácter especial.");
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push("La contraseña es demasiado común. Elige una más segura.");
  }
  if (email && password.toLowerCase() === email.toLowerCase()) {
    errors.push("La contraseña no puede ser igual al correo.");
  }

  return { valid: errors.length === 0, errors };
}

/** Hashea una contraseña con bcrypt. Nunca devuelve la contraseña original. */
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

/** ¿El hash almacenado es bcrypt? (formato $2a$/$2b$/$2y$...). */
export function isBcryptHash(stored: string): boolean {
  return typeof stored === "string" && stored.startsWith("$2");
}

/**
 * ¿El hash almacenado es legacy SHA-256? (64 chars hex, sin prefijo bcrypt).
 * Solo se usa para compatibilidad de login con usuarios antiguos.
 */
export function isLegacyHash(stored: string): boolean {
  return typeof stored === "string" && /^[a-f0-9]{64}$/i.test(stored) && !isBcryptHash(stored);
}

/**
 * ¿Conviene re-hashear este hash a bcrypt? True para hashes legacy (o cualquier
 * cosa que no sea bcrypt válido). El caller re-hashea tras un login correcto.
 */
export function needsRehash(stored: string): boolean {
  return !isBcryptHash(stored);
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export interface VerifyResult {
  ok: boolean;
  /** true si el hash verificado era legacy y debería migrarse a bcrypt. */
  legacy: boolean;
}

/**
 * Verifica una contraseña en claro contra el hash almacenado.
 * Soporta bcrypt y SHA-256 legacy (comparación constant-time).
 */
export function verifyPassword(plain: string, stored: string): VerifyResult {
  if (isBcryptHash(stored)) {
    return { ok: bcrypt.compareSync(plain, stored), legacy: false };
  }
  // Legacy SHA-256: comparación constant-time para evitar timing attacks.
  const candidate = sha256Hex(plain);
  if (candidate.length !== stored.length) {
    return { ok: false, legacy: true };
  }
  const ok = crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(stored));
  return { ok, legacy: true };
}
