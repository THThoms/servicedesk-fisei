import { prisma } from "../db/client";
// Sprint B: Role migrado a `src/domain/enums.ts` para portabilidad MSSQL/PG.
import { Role, normalizeRole } from "../domain/enums";
import { signAuthToken, getExpiresAt, hashToken } from "../utils/jwt";
import { env } from "../config/env";
// HU-13: la política, el hashing y la verificación de contraseñas viven en un
// helper único reutilizable (passwordSecurity). Aquí solo se orquesta el login.
import { hashPassword, verifyPassword, validatePasswordPolicy } from "../utils/passwordSecurity";

// Hash bcrypt fijo usado SOLO para igualar el tiempo de respuesta cuando la
// cuenta no existe o no tiene contraseña local (evita enumerar cuentas por tiempo).
const DUMMY_BCRYPT_HASH = hashPassword("servicedesk-timing-equalizer-" + Date.now());

export interface MicrosoftClaims {
  oid?: string;
  preferred_username?: string;
  email?: string;
  name?: string;
  upn?: string;
}

export class DomainNotAllowedError extends Error {
  constructor(email: string) {
    super(`El email ${email} no pertenece al dominio institucional @${env.allowedDomain}`);
    this.name = "DomainNotAllowedError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    // Mensaje genérico: no revela si falló el correo o la contraseña.
    super("Credenciales inválidas");
    this.name = "InvalidCredentialsError";
  }
}

// Extrae el email del payload de Microsoft (los claims varían según tipo de cuenta).
function extractEmail(claims: MicrosoftClaims): string | undefined {
  return claims.email ?? claims.preferred_username ?? claims.upn;
}

function isAllowedDomain(email: string): boolean {
  return email.toLowerCase().endsWith(`@${env.allowedDomain.toLowerCase()}`);
}

function isAdminEmail(email: string): boolean {
  return env.adminEmails.includes(email.toLowerCase());
}

// Sprint 3+ — Provisión desde SSO Microsoft.
//
// Regla clave: el ROL vive en la BD y es fuente única de verdad.
//   · Alta (usuario aún no existe en auth_db):
//       - Si está en ADMIN_EMAILS → role = admin.
//       - En caso contrario       → role = user.
//     La promoción posterior a tech_n* se hace por SQL/administración directa
//     sobre auth_db (se puede exponer un endpoint admin cuando se necesite).
//   · Login de usuario existente:
//       - Solo se refrescan `microsoftId` y `name` (según claims de Azure).
//       - El rol NO se sobreescribe nunca en cada login, para respetar los
//         cambios administrativos.
//
// Ya no existe mapping correo→rol en código: ninguna cuenta concreta recibe un rol por su correo.
// García ni ningún otro correo específico se resuelve aquí. Los seeds pueden
// crear usuarios iniciales, pero el runtime lee siempre de la BD.
export async function upsertUserFromMicrosoft(claims: MicrosoftClaims) {
  const email = extractEmail(claims);
  if (!email) {
    throw new Error("Microsoft no devolvió un email válido");
  }
  if (!isAllowedDomain(email)) {
    throw new DomainNotAllowedError(email);
  }

  const normalizedEmail = email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  // Nombre a mostrar: preferimos el claim actual de Azure (por si el usuario
  // cambió su nombre en el tenant), y como fallback lo que ya había en BD.
  const displayName = claims.name ?? existing?.name ?? email;

  if (existing) {
    // Usuario ya conocido: solo refrescamos identidad Microsoft y nombre.
    // El rol y demás campos sensibles permanecen tal como los tenga la BD.
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        name: displayName,
        ...(claims.oid ? { microsoftId: claims.oid } : {}),
      },
    });
  }

  // Primer login: aplicamos el rol de bootstrap. Solo aquí ADMIN_EMAILS
  // decide el rol inicial; después ya es responsabilidad del administrador.
  const bootstrapRole = isAdminEmail(normalizedEmail) ? Role.admin : Role.user;

  return prisma.user.create({
    data: {
      email: normalizedEmail,
      name: displayName,
      microsoftId: claims.oid ?? null,
      role: bootstrapRole,
    },
  });
}

// ---------------------------------------------------------------------------
// Login local con correo + contraseña
// ---------------------------------------------------------------------------
export async function loginWithPassword(email: string, password: string) {
  const normalizedEmail = email.toLowerCase().trim();

  if (!isAllowedDomain(normalizedEmail)) {
    throw new DomainNotAllowedError(normalizedEmail);
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !user.passwordHash) {
    verifyPassword(password, DUMMY_BCRYPT_HASH); // mismo coste que un intento real
    throw new InvalidCredentialsError();
  }

  const { ok, legacy } = verifyPassword(password, user.passwordHash);
  if (!ok) {
    throw new InvalidCredentialsError();
  }

  // Migración silenciosa: si el hash era SHA-256 legacy, lo re-hasheamos con bcrypt.
  if (legacy) {
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(password) },
    });
  }

  return user;
}

// ---------------------------------------------------------------------------
// Login simulado Microsoft (solo desarrollo, deshabilitado en producción por
// AUTH_DEV_LOGIN=false). Aplica las mismas reglas que el flujo real:
//   · Usuario existe → se conserva su rol de BD.
//   · Usuario no existe → rol inicial = admin si ADMIN_EMAILS lo incluye, si
//     no user. La promoción a técnico se hace desde administración.
// ---------------------------------------------------------------------------
export async function microsoftSimulatedLogin(email?: string) {
  const normalizedEmail = (email ?? "docente@uta.edu.ec").toLowerCase().trim();

  if (!isAllowedDomain(normalizedEmail)) {
    throw new DomainNotAllowedError(normalizedEmail);
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  const displayName =
    existing?.name ?? normalizedEmail.split("@")[0].replace(/[._-]+/g, " ");

  if (existing) {
    // No sobreescribir role.
    return prisma.user.update({
      where: { id: existing.id },
      data: { name: displayName },
    });
  }

  const bootstrapRole = isAdminEmail(normalizedEmail) ? Role.admin : Role.user;

  return prisma.user.create({
    data: {
      email: normalizedEmail,
      name: displayName,
      role: bootstrapRole,
    },
  });
}

// ---------------------------------------------------------------------------
// Emitir sesión JWT con authProvider
// ---------------------------------------------------------------------------
export type AuthProvider = "local" | "microsoft" | "microsoft-simulated";

export async function issueSession(
  user: {
    id: string;
    email: string;
    name: string;
    // Sprint B: Prisma-SQLServer tipa `role` como `string` (no genera enums).
    // Aceptamos `string` en la firma; los llamadores validan/normalizan.
    role: Role | string;
  },
  authProvider: AuthProvider = "local",
  opts: { pwdChange?: boolean } = {}
) {
  const token = signAuthToken({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: normalizeRole(user.role),
    authProvider,
    ...(opts.pwdChange ? { pwdChange: true } : {}),
  });
  const expiresAt = getExpiresAt(token);

  // Fase R: solo se persiste el SHA-256 del JWT, nunca el token.
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      authProvider,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

// ---------------------------------------------------------------------------
// Registrar log de acceso
// ---------------------------------------------------------------------------
export async function logAccess(params: {
  userId?: string;
  userEmail: string;
  userName: string;
  endpoint: string;
  authProvider: string;
}) {
  await prisma.authLog.create({
    data: {
      userId: params.userId,
      userEmail: params.userEmail,
      userName: params.userName,
      endpoint: params.endpoint,
      authProvider: params.authProvider,
    },
  });
}

export async function revokeSession(token: string) {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoca TODAS las sesiones activas de un usuario (cambio de contraseña, reset). */
export async function revokeAllSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export class PasswordPolicyError extends Error {
  constructor(public readonly errors: string[]) {
    super("La nueva contraseña no cumple la política");
    this.name = "PasswordPolicyError";
  }
}

/**
 * Fase R — Cambio de contraseña (obligatorio tras bootstrap/reset).
 * Verifica la actual, aplica la política (≥12 en producción), impide reutilizar
 * la misma, guarda solo el hash bcrypt, quita mustChangePassword y revoca
 * todas las sesiones previas del usuario.
 */
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.passwordHash) throw new InvalidCredentialsError();
  if (!verifyPassword(currentPassword, user.passwordHash).ok) throw new InvalidCredentialsError();

  const policy = validatePasswordPolicy(newPassword, user.email);
  const errors = [...policy.errors];
  if (newPassword.length < 12) errors.push("La contraseña debe tener al menos 12 caracteres.");
  if (newPassword === currentPassword) errors.push("La nueva contraseña debe ser distinta de la actual.");
  if (errors.length) throw new PasswordPolicyError([...new Set(errors)]);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(newPassword), mustChangePassword: false },
  });
  await revokeAllSessions(user.id);
  return updated;
}
