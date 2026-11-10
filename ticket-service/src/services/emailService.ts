// HU-15 - Transporte de correo abstracto.
//
// Tres modos:
//   - "log"  : escribe un resumen seguro a consola (default dev). No envía.
//   - "mock" : no envía ni imprime (para tests).
//   - "smtp" : usa nodemailer (lazy require). Si nodemailer no está instalado,
//              cae a "log" con warning, así el sistema no se rompe.
//
// Reglas:
//   - Nunca imprime SMTP_PASS ni el htmlBody completo en logs (solo subject + to + event).
//   - `sendEmail` lanza solo en caso de error real de envío; el caller decide
//     marcar el outbox como failed.

import { env } from "../config/env";

export interface EmailMessage {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  eventType: string;
  ticketNumber?: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
  /** Indica si el transporte realmente envía correos (false para log/mock). */
  readonly delivers: boolean;
}

class LogTransport implements EmailTransport {
  readonly delivers = false;
  async send(m: EmailMessage): Promise<void> {
    // Resumen seguro: nunca imprimimos el HTML completo ni credenciales.
    console.log(
      `[email/log] event=${m.eventType} ticket=${m.ticketNumber ?? "-"} to=${m.to} subject="${m.subject}"`
    );
  }
}

class MockTransport implements EmailTransport {
  readonly delivers = false;
  async send(): Promise<void> {
    /* silencio total: usado en tests */
  }
}

class SmtpTransport implements EmailTransport {
  readonly delivers = true;
  private transporterPromise: Promise<unknown> | null = null;

  private async getTransporter(): Promise<{
    sendMail: (opts: Record<string, unknown>) => Promise<unknown>;
  }> {
    if (this.transporterPromise) return this.transporterPromise as Promise<{ sendMail: (opts: Record<string, unknown>) => Promise<unknown>; }>;
    this.transporterPromise = (async () => {
      // Lazy require para evitar exigir nodemailer cuando EMAIL_SEND_MODE != smtp.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodemailer = require("nodemailer");
      return nodemailer.createTransport({
        host: env.email.smtp.host,
        port: env.email.smtp.port,
        secure: env.email.smtp.secure,
        auth:
          env.email.smtp.user && env.email.smtp.pass
            ? { user: env.email.smtp.user, pass: env.email.smtp.pass }
            : undefined,
      });
    })();
    return this.transporterPromise as Promise<{
      sendMail: (opts: Record<string, unknown>) => Promise<unknown>;
    }>;
  }

  async send(m: EmailMessage): Promise<void> {
    const t = await this.getTransporter();
    await t.sendMail({
      from: env.email.from,
      to: m.to,
      subject: m.subject,
      text: m.textBody,
      html: m.htmlBody,
    });
  }
}

// -----------------------------------------------------------------------------
// Selección del transporte. Tolerante: si "smtp" se pide pero nodemailer no
// está instalado, caemos a "log" con warning y la app sigue funcionando.
// -----------------------------------------------------------------------------
let cachedTransport: EmailTransport | null = null;

export function getEmailTransport(): EmailTransport {
  if (cachedTransport) return cachedTransport;
  const mode = env.email.sendMode;
  if (mode === "mock") {
    cachedTransport = new MockTransport();
  } else if (mode === "smtp") {
    try {
      // Verifica que nodemailer sea resolvible antes de instanciar.
      require.resolve("nodemailer");
      cachedTransport = new SmtpTransport();
    } catch {
      console.warn(
        "[email] EMAIL_SEND_MODE=smtp pero 'nodemailer' no está instalado. Cayendo a modo 'log'."
      );
      cachedTransport = new LogTransport();
    }
  } else {
    cachedTransport = new LogTransport();
  }
  return cachedTransport;
}

/** Solo para tests: permite inyectar un transporte específico. */
export function __setEmailTransportForTests(t: EmailTransport | null): void {
  cachedTransport = t;
}

/**
 * Valida un email con un patrón mínimo (no exhaustivo, no necesitamos RFC).
 * Lo importante: rechazar vacíos, espacios y obvios inválidos antes de gastar
 * recursos en outbox o SMTP.
 */
export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const s = email.trim();
  if (s.length < 5 || s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
