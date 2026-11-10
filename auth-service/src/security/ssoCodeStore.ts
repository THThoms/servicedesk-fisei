// =============================================================================
// Fase R — Código de intercambio SSO de un solo uso.
//
// El callback de Microsoft ya NO pone el JWT en la URL. En su lugar genera un
// código opaco aleatorio (256 bits), lo guarda (solo su SHA-256) junto al
// usuario autenticado, y redirige con ?code=. El cliente (web o Android) lo
// canjea con POST /auth/sso/exchange y recibe el JWT en el cuerpo de la
// respuesta. El código:
//   · caduca a los `ttlMs` (60 s por defecto),
//   · se invalida en el PRIMER intento de canje (correcto o no),
//   · no contiene información: es inútil si se filtra después de usarse.
// Estado en memoria del proceso auth-service (una sola réplica).
// =============================================================================
import crypto from "crypto";

export interface PendingSso {
  userId: string;
  authProvider: "microsoft";
  createdAt: number;
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

export class SsoCodeStore {
  private pending = new Map<string, PendingSso & { expiresAt: number }>();

  constructor(
    private readonly ttlMs = 60 * 1000,
    private readonly now: () => number = () => Date.now()
  ) {}

  issue(userId: string): string {
    this.sweep();
    const code = crypto.randomBytes(32).toString("base64url");
    const t = this.now();
    this.pending.set(sha256(code), { userId, authProvider: "microsoft", createdAt: t, expiresAt: t + this.ttlMs });
    return code;
  }

  /** Consume el código (una sola vez). Devuelve null si no existe o caducó. */
  consume(code: unknown): PendingSso | null {
    if (typeof code !== "string" || code.length < 20 || code.length > 200) return null;
    const key = sha256(code);
    const entry = this.pending.get(key);
    this.pending.delete(key);
    if (!entry || entry.expiresAt < this.now()) return null;
    return { userId: entry.userId, authProvider: entry.authProvider, createdAt: entry.createdAt };
  }

  sweep(): void {
    const t = this.now();
    for (const [k, v] of this.pending) if (v.expiresAt < t) this.pending.delete(k);
  }

  size(): number {
    return this.pending.size;
  }
}

export const ssoCodes = new SsoCodeStore();
