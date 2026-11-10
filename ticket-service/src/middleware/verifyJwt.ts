import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { env } from "../config/env";
import { normalizeRole, OfficialRole } from "../services/areaService";

export type Role = OfficialRole;

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
  pwdChange?: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

// -----------------------------------------------------------------------------
// Fase R — introspección de sesión contra auth-service.
// Con AUTH_INTROSPECTION=true (por defecto en NODE_ENV=production) cada token
// se valida además en POST {AUTH_SERVICE_URL}/auth/verify, que comprueba la
// sesión por hash (revocada / expirada / logout). Resultado en caché 30 s por
// hash del token. Si auth-service no responde → 503 (falla cerrado).
// -----------------------------------------------------------------------------
const CACHE_TTL_MS = Number(process.env.SESSION_CACHE_TTL_MS ?? 30_000);
const cache = new Map<string, { ok: boolean; until: number }>();
const introspectionEnabled = () =>
  (process.env.AUTH_INTROSPECTION ?? (env.nodeEnv === "production" ? "true" : "false")).toLowerCase() === "true";

async function sessionIsActive(token: string): Promise<boolean | "unavailable"> {
  const key = crypto.createHash("sha256").update(token).digest("hex");
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.until > now) return hit.ok;
  try {
    const r = await axios.post(`${env.authServiceUrl}/auth/verify`, null, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 4000,
      validateStatus: () => true,
    });
    if (r.status >= 500) return "unavailable";
    const ok = r.status === 200;
    if (cache.size > 5000) cache.clear();
    cache.set(key, { ok, until: now + CACHE_TTL_MS });
    return ok;
  } catch {
    return "unavailable";
  }
}

/** Solo para tests. */
export function __clearSessionCache() {
  cache.clear();
}

export async function verifyJwt(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado" });
  }
  const token = header.slice("Bearer ".length).trim();
  let payload: AuthUser;
  try {
    payload = jwt.verify(token, env.jwtSecret) as AuthUser;
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  if (payload.pwdChange) {
    return res.status(403).json({ error: "password_change_required" });
  }
  if (introspectionEnabled()) {
    const active = await sessionIsActive(token);
    if (active === "unavailable") {
      return res.status(503).json({ error: "Servicio de autenticación no disponible" });
    }
    if (!active) {
      return res.status(401).json({ error: "Sesión inválida o revocada" });
    }
  }
  payload.role = normalizeRole(payload.role);
  req.user = payload;
  next();
}
