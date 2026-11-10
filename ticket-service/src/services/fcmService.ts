// Sprint 4+ — Envío de push notifications vía Firebase Cloud Messaging.
//
// Contrato:
//   sendPushToUsers(userIds[], payload) → resuelve siempre (never throws).
//   El envío es best-effort; nunca debe romper la transacción de tickets.
//
// Modos (FCM_MODE):
//   · off       → no hace nada, no consulta tokens.
//   · log       → consulta tokens y loguea un resumen seguro.
//   · firebase  → envía real usando `firebase-admin` (lazy require).
//
// Rotación de tokens:
//   Cuando Firebase devuelve UNREGISTERED / INVALID_ARGUMENT para un token,
//   lo marcamos `isActive=false` en BD para dejar de intentar.

import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { env } from "../config/env";

export interface PushPayload {
  title: string;
  body: string;
  /** Metadatos que la app usa para deep-link (ticketId, eventType, …). */
  data?: Record<string, string>;
  /** Ruta interna de la SPA (ej. "/tickets/abc"). */
  deepLink?: string;
}

interface FcmSender {
  readonly mode: "off" | "log" | "firebase";
  send(tokens: string[], payload: PushPayload): Promise<{
    successCount: number;
    invalidTokens: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------
class OffSender implements FcmSender {
  readonly mode = "off" as const;
  async send() {
    return { successCount: 0, invalidTokens: [] };
  }
}

class LogSender implements FcmSender {
  readonly mode = "log" as const;
  async send(tokens: string[], payload: PushPayload) {
    console.log(
      `[fcm:log] → ${tokens.length} tokens · "${payload.title}" · deepLink=${
        payload.deepLink ?? "-"
      }`
    );
    return { successCount: tokens.length, invalidTokens: [] };
  }
}

type FirebaseMessagingLike = {
  sendEachForMulticast: (msg: unknown) => Promise<{
    successCount: number;
    failureCount: number;
    responses: Array<{
      success: boolean;
      error?: { code?: string; message?: string };
    }>;
  }>;
};

class FirebaseSender implements FcmSender {
  readonly mode = "firebase" as const;
  private messagingPromise: Promise<FirebaseMessagingLike> | null = null;

  private async getMessaging(): Promise<FirebaseMessagingLike> {
    if (this.messagingPromise) return this.messagingPromise;
    this.messagingPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const admin = require("firebase-admin");
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: env.fcm.projectId,
            clientEmail: env.fcm.clientEmail,
            privateKey: env.fcm.privateKey,
          }),
        });
      }
      return admin.messaging() as FirebaseMessagingLike;
    })();
    return this.messagingPromise;
  }

  async send(tokens: string[], payload: PushPayload) {
    if (tokens.length === 0) return { successCount: 0, invalidTokens: [] };
    const messaging = await this.getMessaging();

    // FCM multicast admite hasta 500 tokens por batch. Segmentamos.
    const BATCH = 450;
    let successCount = 0;
    const invalidTokens: string[] = [];

    const dataStrings = Object.fromEntries(
      Object.entries(payload.data ?? {}).map(([k, v]) => [k, String(v)])
    );

    for (let i = 0; i < tokens.length; i += BATCH) {
      const chunk = tokens.slice(i, i + BATCH);
      const msg = {
        tokens: chunk,
        notification: { title: payload.title, body: payload.body },
        data: {
          ...dataStrings,
          ...(payload.deepLink ? { deepLink: payload.deepLink } : {}),
        },
        android: {
          priority: "high" as const,
          notification: {
            channelId: "servicedesk_tickets",
            sound: "default",
            defaultVibrateTimings: true,
            defaultSound: true,
            visibility: "public" as const,
            notificationPriority: "PRIORITY_HIGH" as const,
          },
        },
      };
      const res = await messaging.sendEachForMulticast(msg);
      successCount += res.successCount;
      res.responses.forEach((r, idx) => {
        if (r.success) return;
        const code = r.error?.code ?? "";
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-argument") ||
          code.includes("invalid-registration-token")
        ) {
          invalidTokens.push(chunk[idx]);
        }
      });
    }
    return { successCount, invalidTokens };
  }
}

// ---------------------------------------------------------------------------
// Selección del sender según env. Idempotente: cachea el elegido.
// ---------------------------------------------------------------------------
let cachedSender: FcmSender | null = null;

function getSender(): FcmSender {
  if (cachedSender) return cachedSender;
  if (env.fcm.mode === "off") {
    cachedSender = new OffSender();
    return cachedSender;
  }
  if (env.fcm.mode === "firebase") {
    const { projectId, clientEmail, privateKey } = env.fcm;
    if (!projectId || !clientEmail || !privateKey) {
      console.warn(
        "[fcm] FCM_MODE=firebase pero faltan credenciales; cae a 'log'."
      );
      cachedSender = new LogSender();
      return cachedSender;
    }
    try {
      require.resolve("firebase-admin");
      cachedSender = new FirebaseSender();
    } catch {
      console.warn(
        "[fcm] firebase-admin no instalado; cae a 'log'. Ejecuta `npm install firebase-admin` en ticket-service."
      );
      cachedSender = new LogSender();
    }
    return cachedSender;
  }
  // log por defecto para cualquier otro valor
  cachedSender = new LogSender();
  return cachedSender;
}

/** Solo tests. Reset del sender cacheado. */
export function __resetFcmSenderForTests(): void {
  cachedSender = null;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<{ tokensSent: number; success: number; invalidated: number }> {
  if (userIds.length === 0) return { tokensSent: 0, success: 0, invalidated: 0 };
  const sender = getSender();
  if (sender.mode === "off") return { tokensSent: 0, success: 0, invalidated: 0 };

  const rows = await prisma.deviceToken.findMany({
    where: { userId: { in: userIds }, isActive: true },
    select: { token: true },
  });
  const tokens = rows.map((r) => r.token);
  if (tokens.length === 0) return { tokensSent: 0, success: 0, invalidated: 0 };

  try {
    const { successCount, invalidTokens } = await sender.send(tokens, payload);
    if (invalidTokens.length > 0) {
      await prisma.deviceToken.updateMany({
        where: { token: { in: invalidTokens } },
        data: { isActive: false },
      });
    }
    return {
      tokensSent: tokens.length,
      success: successCount,
      invalidated: invalidTokens.length,
    };
  } catch (err) {
    // Best-effort: nunca romper el flujo del ticket.
    console.error("[fcm] error enviando push:", err);
    return { tokensSent: tokens.length, success: 0, invalidated: 0 };
  }
}

/**
 * Dispara el envío en background (no bloquea la respuesta al cliente).
 * Útil desde dentro de handlers HTTP que ya cerraron la transacción.
 */
export function dispatchPushInBackground(
  userIds: string[],
  payload: PushPayload
): void {
  // Envolver con Promise.resolve() para forzar microtask y no propagar errores.
  Promise.resolve()
    .then(() => sendPushToUsers(userIds, payload))
    .catch((err) => console.error("[fcm] background dispatch error:", err));
}

// ---------------------------------------------------------------------------
// Helper de tipos que Prisma no expone directamente cuando el modelo está en
// otro schema. Import solo para consistencia con `prisma` importado arriba.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ = Prisma.DeviceTokenWhereInput;
