// Sprint 4+ — Ayudante del flujo Microsoft SSO en Android.
//
// El WebView de Capacitor NO puede completar el flujo Microsoft dentro de sí
// mismo: al hacer `window.location.href` a un dominio externo, la webview
// pierde el contexto de la app y el callback termina en el sitio web público,
// no en la app.
//
// Solución (patrón OAuth para apps móviles):
//   1. En Android abrimos el navegador del sistema (Chrome Custom Tabs)
//      con `Browser.open()`, indicando al backend `?client=android`.
//   2. El backend lo pasa por el parámetro `state` OAuth.
//   3. Tras autenticar, el backend redirige a
//      `ec.uta.servicedesk://auth/success?token=…`
//   4. Android intercepta el scheme y despierta la MainActivity.
//   5. Capacitor emite `appUrlOpen` con la URL entera.
//   6. `handleSsoAppUrl` extrae el token y persiste la sesión.
//
// En web todo esto es no-op: el login sigue con full-page redirect como antes.

import { Capacitor } from "@capacitor/core";

export const MOBILE_DEEP_LINK_HOST = "ec.uta.servicedesk://auth";

export function isCapacitorAndroid(): boolean {
  return Capacitor.getPlatform() === "android";
}

/**
 * Abre Microsoft SSO en el navegador del sistema (Chrome Custom Tabs).
 * Solo llamable desde Android; en web debe llamarse el redirect clásico.
 */
export async function openMicrosoftSsoInSystemBrowser(
  apiBase: string,
  loginHint?: string
): Promise<void> {
  const { Browser } = await import("@capacitor/browser");
  const qs = new URLSearchParams({ client: "android" });
  if (loginHint) qs.set("login_hint", loginHint);
  await Browser.open({
    url: `${apiBase}/api/auth/microsoft?${qs.toString()}`,
    windowName: "_self",
    presentationStyle: "fullscreen",
  });
}

/**
 * Cierra la Custom Tab si sigue abierta (Android trae al frente la app pero
 * la pestaña queda en background con la página del backend).
 */
export async function closeSsoBrowser(): Promise<void> {
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    /* Browser puede no estar disponible en web */
  }
}

/**
 * Parsea el código de una URL `ec.uta.servicedesk://auth/success?code=…`.
 * Devuelve null si no es una URL válida del flujo SSO.
 */
export interface SsoResult {
  /** Fase R: código opaco de un solo uso (el JWT ya no viaja en la URL). */
  code?: string;
  error?: string;
  domain?: string;
}
export function parseSsoDeepLink(url: string): SsoResult | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "ec.uta.servicedesk:") return null;
    if (u.host !== "auth") return null;
    // El backend redirige a `/auth/success` (éxito) o `/login` (error).
    const path = u.pathname.replace(/^\/+/, "");
    if (path !== "auth/success" && path !== "login" && path !== "success") {
      return null;
    }
    return {
      code: u.searchParams.get("code") ?? undefined,
      error: u.searchParams.get("error") ?? undefined,
      domain: u.searchParams.get("domain") ?? undefined,
    };
  } catch {
    return null;
  }
}
