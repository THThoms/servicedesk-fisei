// =============================================================================
// Fase R — Limitación de intentos de autenticación (en memoria).
//
// Dos contadores independientes de FALLOS dentro de una ventana deslizante:
//   · por IP      → frena ataques de diccionario/credential stuffing
//   · por cuenta  → frena ataques dirigidos a una cuenta, con ENFRIAMIENTO
//                   PROGRESIVO (1, 2, 4, 8… min, tope `maxCooldownMs`).
// Nunca bloquea de forma permanente: el bloqueo caduca solo, y un login
// correcto reinicia el contador de la cuenta. El mensaje de respuesta es el
// mismo exista o no la cuenta (no revela existencia).
//
// Alcance: un único proceso auth-service (como en el compose). Con varias
// réplicas habría que mover el estado a un almacén compartido.
// =============================================================================

export interface RateLimitConfig {
  windowMs: number;
  maxFailuresPerIp: number;
  maxFailuresPerAccount: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  maxFailuresPerIp: 20,
  maxFailuresPerAccount: 5,
  baseCooldownMs: 60 * 1000,
  maxCooldownMs: 15 * 60 * 1000,
};

interface Entry {
  failures: number[];        // timestamps de fallos dentro de la ventana
  lockedUntil: number;       // 0 = sin bloqueo
  lockLevel: number;         // nº de bloqueos consecutivos (enfriamiento progresivo)
}

export interface LimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  scope?: "ip" | "account";
}

export class LoginRateLimiter {
  private ips = new Map<string, Entry>();
  private accounts = new Map<string, Entry>();

  constructor(
    private readonly cfg: RateLimitConfig = DEFAULT_RATE_LIMIT,
    private readonly now: () => number = () => Date.now()
  ) {}

  private entry(map: Map<string, Entry>, key: string): Entry {
    let e = map.get(key);
    if (!e) {
      e = { failures: [], lockedUntil: 0, lockLevel: 0 };
      map.set(key, e);
    }
    const t = this.now();
    e.failures = e.failures.filter((ts) => t - ts < this.cfg.windowMs);
    return e;
  }

  /** ¿Se permite intentar? (no registra nada) */
  check(ip: string, account?: string): LimitDecision {
    const t = this.now();
    const ipE = this.entry(this.ips, ip);
    if (ipE.lockedUntil > t) {
      return { allowed: false, retryAfterSeconds: Math.ceil((ipE.lockedUntil - t) / 1000), scope: "ip" };
    }
    if (account) {
      const acE = this.entry(this.accounts, account);
      if (acE.lockedUntil > t) {
        return { allowed: false, retryAfterSeconds: Math.ceil((acE.lockedUntil - t) / 1000), scope: "account" };
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Registra un fallo. Devuelve el bloqueo resultante, si lo hay. */
  recordFailure(ip: string, account?: string): LimitDecision {
    const t = this.now();
    const ipE = this.entry(this.ips, ip);
    ipE.failures.push(t);
    if (ipE.failures.length >= this.cfg.maxFailuresPerIp) {
      ipE.lockedUntil = t + this.cfg.windowMs;
      ipE.failures = [];
    }
    if (account) {
      const acE = this.entry(this.accounts, account);
      acE.failures.push(t);
      if (acE.failures.length >= this.cfg.maxFailuresPerAccount) {
        const cooldown = Math.min(this.cfg.baseCooldownMs * 2 ** acE.lockLevel, this.cfg.maxCooldownMs);
        acE.lockedUntil = t + cooldown;
        acE.lockLevel += 1;
        acE.failures = [];
      }
    }
    return this.check(ip, account);
  }

  /** Login correcto: limpia el historial de la cuenta (no el de la IP). */
  recordSuccess(account: string): void {
    this.accounts.delete(account);
  }

  /** Limpieza periódica de entradas sin actividad (evita crecimiento de memoria). */
  sweep(): void {
    const t = this.now();
    for (const map of [this.ips, this.accounts]) {
      for (const [k, e] of map) {
        const last = e.failures[e.failures.length - 1] ?? 0;
        if (e.lockedUntil <= t && t - last > this.cfg.windowMs) {
          // Tras una ventana completa sin fallos el enfriamiento vuelve a empezar.
          map.delete(k);
        }
      }
    }
  }
}

/** Instancia del proceso (las rutas la usan; los tests crean la suya). */
export const loginLimiter = new LoginRateLimiter();
