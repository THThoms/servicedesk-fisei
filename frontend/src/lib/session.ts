// Fase R — finalización de inicio de sesión, común a web y Android.
//
//  · Microsoft SSO: el backend ya NO envía el JWT en la URL. Entrega un código
//    opaco de un solo uso (?code=…, 60 s) que se canjea aquí por POST
//    /api/auth/sso/exchange; el JWT llega en el CUERPO de la respuesta.
//  · Si la cuenta tiene una contraseña temporal (bootstrap/reset), el token
//    trae `pwdChange` y la única pantalla accesible es /cambiar-contrasena.
import { api } from "./api";
import { AuthProvider, decodeToken, landingRouteFor, saveToken } from "./auth";

export const CHANGE_PASSWORD_ROUTE = "/cambiar-contrasena";

/** Guarda el token y devuelve la ruta a la que debe navegarse. */
export function completeLogin(token: string, provider: AuthProvider): string | null {
  const user = decodeToken(token);
  if (!user) return null;
  saveToken(token, provider);
  return user.pwdChange ? CHANGE_PASSWORD_ROUTE : landingRouteFor(user.role);
}

/** Canjea el código SSO de un solo uso. Lanza si es inválido o caducó. */
export async function exchangeSsoCode(code: string): Promise<string> {
  const res = await api.post<{ token: string }>("/api/auth/sso/exchange", { code });
  const next = completeLogin(res.data.token, "microsoft");
  if (!next) throw new Error("auth_failed");
  return next;
}
