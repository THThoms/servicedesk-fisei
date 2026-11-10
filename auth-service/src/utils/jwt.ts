import crypto from "crypto";
import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import { normalizeRole } from "../domain/enums";

export type Role = string;

export interface AuthTokenPayload extends JwtPayload {
  userId: string;
  email: string;
  name: string;
  role: Role;
  authProvider?: string;
  /**
   * Fase R: true cuando la cuenta debe cambiar su contraseña temporal. Un
   * token con este claim SOLO sirve para /auth/change-password, /auth/me y
   * /auth/logout; el resto de servicios lo rechaza con 403.
   */
  pwdChange?: boolean;
}

export function signAuthToken(payload: Omit<AuthTokenPayload, "iat" | "exp">): string {
  // Fase R: `jti` aleatorio → cada token es único aunque se emitan dos para el
  // mismo usuario en el mismo segundo (antes eran idénticos y su hash chocaba
  // con el índice único de sessions → HTTP 500).
  const options: SignOptions = {
    expiresIn: env.jwt.expiresIn as SignOptions["expiresIn"],
    jwtid: crypto.randomUUID(),
  };
  return jwt.sign(payload, env.jwt.secret, options);
}

/** Verifica firma y expiración. El rol se normaliza (roles heredados → oficiales). */
export function verifyAuthToken(token: string): AuthTokenPayload {
  const payload = jwt.verify(token, env.jwt.secret) as AuthTokenPayload;
  payload.role = normalizeRole(payload.role);
  return payload;
}

export function getExpiresAt(token: string): Date {
  const decoded = jwt.decode(token) as JwtPayload | null;
  if (decoded?.exp) {
    return new Date(decoded.exp * 1000);
  }
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

/**
 * Fase R: las sesiones guardan SOLO el SHA-256 (hex, minúsculas) del JWT.
 * Debe coincidir con la migración T-SQL de src/maintenance (HASHBYTES sobre
 * el JWT en ASCII → LOWER(CONVERT(varchar(64), …, 2))).
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}
