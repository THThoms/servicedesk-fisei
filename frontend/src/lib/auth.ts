import { jwtDecode } from "jwt-decode";

// Fase R — roles oficiales. DTIC es un área técnica, NO administración.
export type Role = "admin" | "technician" | "dtic" | "user";
const LEGACY_ROLES: Record<string, Role> = {
  tech_n1: "technician",
  tech_n2: "technician",
  tech_n3: "dtic",
  tech_n4: "dtic",
};
/** Normaliza roles heredados de JWT antiguos; un valor desconocido → user. */
export function normalizeRole(role: string | null | undefined): Role {
  if (role === "admin" || role === "technician" || role === "dtic" || role === "user") return role;
  return (role && LEGACY_ROLES[role]) || "user";
}
export type AuthProvider = "local" | "microsoft" | "microsoft-simulated";

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: Role;
  authProvider?: AuthProvider;
  exp?: number;
  /** Fase R: la cuenta debe cambiar su contraseña temporal antes de continuar. */
  pwdChange?: boolean;
}

const TOKEN_KEY = "sd_token";
const AUTH_PROVIDER_KEY = "sd_auth_provider";

export function saveToken(token: string, authProvider?: AuthProvider): void {
  localStorage.setItem(TOKEN_KEY, token);
  if (authProvider) {
    localStorage.setItem(AUTH_PROVIDER_KEY, authProvider);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getAuthProvider(): AuthProvider | null {
  return localStorage.getItem(AUTH_PROVIDER_KEY) as AuthProvider | null;
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AUTH_PROVIDER_KEY);
}

// Decodifica el JWT sin validar la firma (la valida el backend en cada request).
// Solo lo usamos para pintar el nombre/rol en la UI y elegir el dashboard inicial.
export function decodeToken(token: string): AuthUser | null {
  try {
    const user = jwtDecode<AuthUser>(token);
    return { ...user, role: normalizeRole(user.role) };
  } catch {
    return null;
  }
}

export function getCurrentUser(): AuthUser | null {
  const token = getToken();
  if (!token) return null;
  const user = decodeToken(token);
  if (!user) return null;
  // expirado -> limpiar
  if (user.exp && user.exp * 1000 < Date.now()) {
    clearToken();
    return null;
  }
  return user;
}

// Verifica si hay una sesión activa (sin importar el authProvider)
export function isAuthenticated(): boolean {
  return getCurrentUser() !== null;
}

// admin → estadísticas; technician/dtic → panel; usuario → "Mis Tickets".
export function landingRouteFor(role: Role | string): string {
  const r = normalizeRole(role);
  if (r === "admin") return "/admin/stats";
  if (r === "technician" || r === "dtic") return "/panel";
  return "/mis-tickets";
}

/** True si el rol puede acceder al Panel Técnico. */
export function isStaffRole(role: Role | string): boolean {
  const r = normalizeRole(role);
  return r === "admin" || r === "technician" || r === "dtic";
}

/** Etiqueta visible del rol (nunca niveles ni nombres internos). */
export function roleLabel(role: Role | string): string {
  switch (normalizeRole(role)) {
    case "admin": return "Administrador";
    case "technician": return "Técnico";
    case "dtic": return "DTIC";
    default: return "Solicitante";
  }
}

/** Área operativa del rol, para mostrar en la interfaz. */
export function areaLabelForRole(role: Role | string): string | null {
  switch (normalizeRole(role)) {
    case "technician": return "Técnicos";
    case "dtic": return "DTIC";
    case "admin": return "Técnicos y DTIC";
    default: return null;
  }
}

export const STAFF_ROLES: Role[] = ["admin", "technician", "dtic"];
