import axios, { AxiosError } from "axios";
import { clearToken, getToken } from "./auth";

// Todas las llamadas pasan por el API Gateway (regla del Sprint 1).
// El frontend nunca toca un microservicio directamente.
const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8080";

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
});

// Inyecta JWT en cada request si existe.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// 401 => sesión expirada/revocada: limpia el JWT y manda al login.
// 403 password_change_required => contraseña temporal: solo se puede cambiar.
// (El 401 de login / change-password es "credenciales incorrectas", no sesión.)
const CREDENTIAL_ENDPOINTS = ["/api/auth/login", "/api/auth/change-password", "/api/auth/sso/exchange"];
api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    const url = err.config?.url ?? "";
    const isCredentialCall = CREDENTIAL_ENDPOINTS.some((e) => url.endsWith(e));
    const body = err.response?.data as { error?: string } | undefined;
    if (err.response?.status === 403 && body?.error === "password_change_required") {
      if (!window.location.pathname.startsWith("/cambiar-contrasena")) {
        window.location.href = "/cambiar-contrasena";
      }
      return Promise.reject(err);
    }
    if (err.response?.status === 401 && !isCredentialCall) {
      clearToken();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login?error=session_expired";
      }
    }
    return Promise.reject(err);
  }
);

// Helper para extraer el mensaje de error que devuelve el backend.
export function extractApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; detail?: string } | undefined;
    return data?.error ?? data?.detail ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return "Error desconocido";
}

/**
 * Reconoce cancelaciones de peticiones (AbortController / CanceledError).
 * Los `useEffect` de las páginas hacen `controller.abort()` al desmontar; el
 * catch debe ignorar ese error para no marcar la UI como fallida ni loggearlo.
 * Con backend SQL Server más pesado que PG local, las cancelaciones al navegar
 * rápido son frecuentes — sin este chequeo el navegador se satura de fetches
 * en vuelo y se congela.
 */
export function isCancelled(err: unknown): boolean {
  if (axios.isCancel(err)) return true;
  if (err instanceof Error && (err.name === "CanceledError" || err.name === "AbortError")) return true;
  const anyErr = err as { code?: string } | null;
  return anyErr?.code === "ERR_CANCELED";
}
