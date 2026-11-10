// Configuración pública de login (/api/auth/config) con reintentos.
//
// Antes, la pantalla de login pedía la configuración UNA sola vez: si esa
// petición fallaba (p. ej. un 502 mientras el auth-service aún arrancaba tras
// reiniciar el servidor), el botón "Iniciar con Microsoft" quedaba deshabilitado
// hasta recargar la página. Ahora se reintenta y, si sigue fallando, se vuelve
// a pedir al pulsar el botón.
//
// Seguridad (Fase P): si no se puede leer la configuración, NUNCA se asume que
// el login simulado está disponible.

export interface AuthConfig {
  ssoConfigured: boolean;
  devLoginEnabled: boolean;
  allowedDomain: string;
  microsoftSimulateEnabled?: boolean;
}

export const SAFE_AUTH_CONFIG: AuthConfig = {
  ssoConfigured: false,
  devLoginEnabled: false,
  allowedDomain: "uta.edu.ec",
  microsoftSimulateEnabled: false,
};

export const AUTH_CONFIG_RETRY_DELAYS_MS = [0, 2000, 5000];

/**
 * Pide la configuración con reintentos. Devuelve la configuración real o null
 * si todos los intentos fallan (el llamador decide usar SAFE_AUTH_CONFIG).
 */
export async function fetchAuthConfigWithRetry(
  fetchConfig: () => Promise<AuthConfig>,
  delaysMs: number[] = AUTH_CONFIG_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  isCancelled: () => boolean = () => false
): Promise<AuthConfig | null> {
  for (const delay of delaysMs) {
    if (delay > 0) await sleep(delay);
    if (isCancelled()) return null;
    try {
      return await fetchConfig();
    } catch {
      // se reintenta
    }
  }
  return null;
}
