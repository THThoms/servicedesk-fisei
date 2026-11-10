// Fase T — `state` OAuth ligado al navegador (protección CSRF del login SSO).
//
// Antes, `state` solo transportaba el tipo de cliente y nunca se comparaba con
// nada propio del navegador: un atacante podía hacer que la víctima completara
// el callback con un código del atacante (login CSRF). Ahora:
//   1. GET /auth/microsoft genera un nonce aleatorio (256 bits), lo envía a
//      Microsoft dentro de `state` = "<cliente>.<nonce>" y lo guarda en una
//      cookie HttpOnly, SameSite=Lax, Secure (si la app es https), 10 minutos.
//   2. El callback exige que el nonce de `state` coincida (tiempo constante) con
//      la cookie de ESE navegador; si no, rechaza sin canjear el código.
// La app Android abre el login en el navegador del sistema (Custom Tabs): el
// inicio y el callback ocurren en el mismo navegador, así que la cookie llega.
import crypto from "crypto";

export const OAUTH_STATE_COOKIE = "sd_oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 600;
export type OAuthClient = "web" | "android";

const STATE_RE = /^(web|android)\.([A-Za-z0-9_-]{43})$/;

function cookieAttrs(secure: boolean, maxAge: number): string {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

/** Nuevo `state` y la cabecera Set-Cookie que lo liga a este navegador. */
export function issueOAuthState(client: OAuthClient, secure: boolean): { state: string; setCookie: string } {
  const nonce = crypto.randomBytes(32).toString("base64url"); // 43 caracteres
  return {
    state: `${client}.${nonce}`,
    setCookie: `${OAUTH_STATE_COOKIE}=${nonce}; ${cookieAttrs(secure, OAUTH_STATE_TTL_SECONDS)}`,
  };
}

/** Cabecera Set-Cookie que borra la cookie de estado (un solo uso). */
export function clearOAuthStateCookie(secure: boolean): string {
  return `${OAUTH_STATE_COOKIE}=; ${cookieAttrs(secure, 0)}`;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * Verifica el `state` del callback contra la cookie del navegador.
 * Devuelve el tipo de cliente si es válido; null si falta, está mal formado o
 * no coincide.
 */
export function verifyOAuthState(state: unknown, cookieHeader: string | undefined): OAuthClient | null {
  if (typeof state !== "string") return null;
  const m = STATE_RE.exec(state);
  if (!m) return null;
  const cookie = readCookie(cookieHeader, OAUTH_STATE_COOKIE);
  if (!cookie) return null;
  const a = Buffer.from(m[2]);
  const b = Buffer.from(cookie);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return m[1] as OAuthClient;
}

/** Tipo de cliente declarado en `state` (solo para elegir el destino de un error). */
export function clientFromState(state: unknown): OAuthClient {
  return typeof state === "string" && state.startsWith("android.") ? "android" : "web";
}
