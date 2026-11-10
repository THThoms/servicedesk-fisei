// Sprint 4+ — Registro de FCM y manejo de deep-link para la app Android.
//
// En web (Vite/Nginx) este módulo es un no-op: `initPushNotifications()`
// detecta que Capacitor no está y no hace nada. En Android nativo:
//   1. Pide el permiso POST_NOTIFICATIONS (Android 13+).
//   2. Registra el dispositivo con FCM.
//   3. Envía el token FCM al backend con el JWT del usuario actual.
//   4. Escucha:
//        · pushNotificationReceived  → foreground; podríamos mostrar toast.
//        · pushNotificationActionPerformed → tap; navega al deep-link.
//
// Todos los errores se capturan localmente: nunca deben tumbar la SPA.

import { Capacitor } from "@capacitor/core";
import { api } from "./api";
import { getToken as getJwt } from "./auth";

type PlatformKind = "android" | "ios" | "web";

interface PushOptions {
  /** Callback invocado con la ruta (ej. "/tickets/abc") cuando el usuario
   *  toca la notificación. Normalmente el caller usará `navigate(path)`. */
  onNavigate: (path: string) => void;
}

const PREF_KEY_TOKEN = "sd_fcm_token";

function isNativeAndroid(): boolean {
  return Capacitor.getPlatform() === "android";
}

function getPlatform(): PlatformKind {
  const p = Capacitor.getPlatform();
  if (p === "android") return "android";
  if (p === "ios") return "ios";
  return "web";
}

// Wrappers seguros de Preferences — nunca deben tumbar el flujo si falla.
async function safeSetPref(key: string, value: string): Promise<void> {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value });
  } catch {
    /* Preferences puede no estar disponible en web; ignoramos */
  }
}
async function safeGetPref(key: string): Promise<string | null> {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const r = await Preferences.get({ key });
    return r.value ?? null;
  } catch {
    return null;
  }
}
async function safeRemovePref(key: string): Promise<void> {
  try {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key });
  } catch {
    /* noop */
  }
}

/**
 * Idempotente: si ya se registraron los listeners, no lo hace de nuevo.
 * Debe llamarse UNA VEZ después de que el usuario esté autenticado (para que
 * el registro del token viaje con JWT válido).
 */
let listenersRegistered = false;
let registeredTokenForJwt: string | null = null;

export async function initPushNotifications(opts: PushOptions): Promise<void> {
  if (!isNativeAndroid()) return; // web / iOS: no-op por ahora

  const jwt = getJwt();
  if (!jwt) return;

  // Cargamos el plugin sólo aquí; en web el import estático seguiría siendo
  // seguro (los métodos native son no-op) pero mantiene el bundle web pequeño.
  const { PushNotifications } = await import("@capacitor/push-notifications");

  // 1. Permiso
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive !== "granted") {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== "granted") {
    console.warn("[push] permiso no concedido");
    return;
  }

  // 2. Listeners (una sola vez)
  if (!listenersRegistered) {
    listenersRegistered = true;

    await PushNotifications.addListener("registration", async (t) => {
      if (registeredTokenForJwt === jwt + ":" + t.value) return; // ya enviado
      try {
        await api.post("/api/notifications/register", {
          token: t.value,
          platform: getPlatform(),
        });
        registeredTokenForJwt = jwt + ":" + t.value;
        // Persistir el token para poder darlo de baja al hacer logout, incluso
        // si Firebase rota la registration en la próxima sesión.
        await safeSetPref(PREF_KEY_TOKEN, t.value);
      } catch (err) {
        console.error("[push] no se pudo registrar el token en backend:", err);
      }
    });

    await PushNotifications.addListener("registrationError", (err) => {
      console.error("[push] error de registro:", err);
    });

    await PushNotifications.addListener("pushNotificationReceived", (n) => {
      // Foreground: por ahora sólo log. La UI de la app ya muestra el badge
      // desde Firebase Messaging (metadata en AndroidManifest).
      console.log("[push] recibido en foreground:", n.title, n.body);
    });

    await PushNotifications.addListener(
      "pushNotificationActionPerformed",
      (action) => {
        const data = action.notification?.data ?? {};
        const deepLink =
          (data.deepLink as string | undefined) ??
          (data.ticketId ? `/tickets/${data.ticketId}` : null);
        if (deepLink) opts.onNavigate(deepLink);
      }
    );
  }

  // 3. Solicitar el token
  await PushNotifications.register();
}

/**
 * Al hacer logout, marcamos el token como inactivo en backend para que no
 * siga recibiendo notificaciones tras cerrar sesión.
 */
export async function unregisterPushToken(): Promise<void> {
  if (!isNativeAndroid()) return;
  const token = await safeGetPref(PREF_KEY_TOKEN);
  if (token) {
    try {
      // Solo desactiva el token de ESTE dispositivo. Los tokens de otros
      // dispositivos del mismo usuario se conservan intactos.
      await api.post("/api/notifications/unregister", { token });
    } catch {
      /* best-effort — nunca bloquea el logout */
    }
    await safeRemovePref(PREF_KEY_TOKEN);
  }
  registeredTokenForJwt = null;
}
