import { Request, Response, NextFunction } from "express";
import { verifyAuthToken, AuthTokenPayload, hashToken } from "../utils/jwt";
import { prisma } from "../db/client";

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthTokenPayload;
  }
}

/**
 * Fase R — Validación de sesión:
 *   1. firma y expiración del JWT;
 *   2. SHA-256 del token → búsqueda de la sesión por hash (no se guarda el JWT);
 *   3. sesión existente, no revocada y no expirada;
 *   4. tokens con `pwdChange` solo se admiten donde `allowPwdChange` es true.
 */
async function authenticate(req: Request, res: Response, next: NextFunction, allowPwdChange: boolean) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }
  const token = header.slice("Bearer ".length).trim();
  let payload: AuthTokenPayload;
  try {
    payload = verifyAuthToken(token);
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  try {
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session || session.revokedAt) {
      return res.status(401).json({ error: "Sesión inválida o revocada" });
    }
    if (session.expiresAt < new Date()) {
      return res.status(401).json({ error: "Sesión expirada" });
    }
  } catch {
    return res.status(503).json({ error: "No se pudo validar la sesión" });
  }
  if (payload.pwdChange && !allowPwdChange) {
    return res.status(403).json({ error: "password_change_required" });
  }
  req.user = payload;
  next();
}

export function verifyJwt(req: Request, res: Response, next: NextFunction) {
  return authenticate(req, res, next, false);
}

/** Solo para /change-password, /me y /logout. */
export function verifyJwtAllowPwdChange(req: Request, res: Response, next: NextFunction) {
  return authenticate(req, res, next, true);
}
