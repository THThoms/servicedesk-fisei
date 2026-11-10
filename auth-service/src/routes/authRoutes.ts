import { Router, Request, Response } from "express";
import { getMsalClient, SCOPES } from "../config/msal.config";
import { env } from "../config/env";
import { verifyJwt, verifyJwtAllowPwdChange } from "../middleware/verifyJwt";
import { loginLimiter } from "../security/loginRateLimiter";
import { ssoCodes } from "../security/ssoCodeStore";
import { logSecurity } from "../security/securityLog";
import { issueOAuthState, verifyOAuthState, clearOAuthStateCookie, clientFromState } from "../security/oauthState";
import { STAFF_ROLES as OFFICIAL_STAFF_ROLES, TECH_ROLES, TECH_BLOCKS, Role, normalizeRole, blockForRole } from "../domain/enums";
import {
  upsertUserFromMicrosoft,
  issueSession,
  revokeSession,
  loginWithPassword,
  microsoftSimulatedLogin,
  logAccess,
  DomainNotAllowedError,
  InvalidCredentialsError,
  MicrosoftClaims,
  changePassword,
  PasswordPolicyError,
} from "../services/authService";
import { prisma } from "../db/client";

const router = Router();
const TOO_MANY = "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";

// ---------------------------------------------------------------------------
// POST /auth/login -> Login local con correo y contraseña
// ---------------------------------------------------------------------------
router.post("/login", async (req: Request, res: Response) => {
  const correo = String(req.body?.correo ?? req.body?.email ?? "").trim();
  const password = String(req.body?.password ?? "");

  if (!correo || !password) {
    return res.status(400).json({ error: "Correo y contraseña son requeridos" });
  }

  // Fase R: limitación por IP y por cuenta (mismo mensaje exista o no la cuenta).
  const ip = req.ip ?? "unknown";
  const account = correo.toLowerCase();
  const gate = loginLimiter.check(ip, account);
  if (!gate.allowed) {
    logSecurity("login_rate_limited", { ip, email: account, reason: gate.scope });
    res.setHeader("Retry-After", String(gate.retryAfterSeconds));
    return res.status(429).json({ error: TOO_MANY });
  }

  try {
    const user = await loginWithPassword(correo, password);
    loginLimiter.recordSuccess(account);
    const mustChange = Boolean((user as { mustChangePassword?: boolean }).mustChangePassword);
    const { token } = await issueSession(user, "local", { pwdChange: mustChange });
    logSecurity("login_success", { ip, email: account, reason: mustChange ? "password_change_required" : undefined });

    // Registrar log de acceso
    await logAccess({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      endpoint: "/auth/login",
      authProvider: "local",
    });

    return res.json({
      token,
      authProvider: "local",
      mustChangePassword: mustChange,
      user: {
        idUsuario: user.id,
        nombres: user.name.split(" ")[0] || user.name,
        apellidos: user.name.split(" ").slice(1).join(" ") || "",
        correo: user.email,
        rol: normalizeRole(user.role),
      },
    });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      const after = loginLimiter.recordFailure(ip, account);
      logSecurity("login_failed", { ip, email: account });
      if (!after.allowed) {
        res.setHeader("Retry-After", String(after.retryAfterSeconds));
        return res.status(429).json({ error: TOO_MANY });
      }
      return res.status(401).json({ error: err.message });
    }
    if (err instanceof DomainNotAllowedError) {
      return res.status(403).json({ error: err.message });
    }
    console.error("Error en login local:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/microsoft-simulate -> Login simulado Microsoft Office 365
// No se conecta a Microsoft real. Devuelve un usuario institucional simulado.
// ---------------------------------------------------------------------------
router.post("/microsoft-simulate", async (req: Request, res: Response) => {
  // Fase P · seguridad: bypass sin contraseña. Nunca disponible en producción
  // (env.microsoftSimulateEnabled es false si NODE_ENV=production).
  if (!env.microsoftSimulateEnabled) {
    return res.status(404).json({ error: "Endpoint no disponible" });
  }
  const email = String(req.body?.email ?? req.body?.correo ?? "docente@uta.edu.ec").trim();

  try {
    const user = await microsoftSimulatedLogin(email);
    const { token } = await issueSession(user, "microsoft-simulated");

    // Registrar log de acceso
    await logAccess({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      endpoint: "/auth/microsoft-simulate",
      authProvider: "microsoft-simulated",
    });

    return res.json({
      token,
      authProvider: "microsoft-simulated",
      user: {
        idUsuario: user.id,
        nombres: user.name.split(" ")[0] || user.name,
        apellidos: user.name.split(" ").slice(1).join(" ") || "Microsoft",
        correo: user.email,
        rol: user.role,
      },
    });
  } catch (err) {
    if (err instanceof DomainNotAllowedError) {
      return res.status(403).json({ error: err.message });
    }
    console.error("Error en login Microsoft simulado:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/microsoft -> Redirige al login de Microsoft
// ---------------------------------------------------------------------------
// Sprint 4+ · Deep-link móvil: si la petición viene de la app Android, en vez
// de redirigir el callback a la URL web (https://…/auth/success), lo mandamos
// al custom scheme `ec.uta.servicedesk://auth/success` para que MainActivity
// despierte y Capacitor emita `appUrlOpen`. El frontend web sigue exactamente
// igual (fallback cuando `state` no marca client).
const MOBILE_DEEP_LINK_SCHEME = "ec.uta.servicedesk://auth/success";

// Fase T: la cookie de `state` lleva Secure cuando la app se sirve por https.
const stateCookieSecure = (): boolean => env.frontendUrl.startsWith("https://");

router.get("/microsoft", async (req: Request, res: Response) => {
  if (!env.ssoConfigured) {
    return res.status(503).json({
      error: "SSO no configurado",
      detail:
        "Faltan variables MICROSOFT_CLIENT_ID / MICROSOFT_TENANT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_REDIRECT_URI.",
    });
  }
  try {
    // El frontend puede pasar ?login_hint=usuario@uta.edu.ec para pre-rellenar
    // el formulario de Microsoft y saltar la pantalla "elige una cuenta".
    const loginHint =
      typeof req.query.login_hint === "string" && req.query.login_hint.trim() !== ""
        ? req.query.login_hint.trim()
        : undefined;

    // La app Android envía `?client=android`. Fase T: `state` = "<cliente>.<nonce
    // aleatorio de 256 bits>" y el nonce queda en una cookie HttpOnly de ESTE
    // navegador; el callback exige que coincidan (protección contra login CSRF).
    const client = typeof req.query.client === "string" && req.query.client === "android" ? "android" : "web";
    const { state, setCookie } = issueOAuthState(client, stateCookieSecure());

    const url = await getMsalClient().getAuthCodeUrl({
      scopes: SCOPES,
      redirectUri: env.microsoft.redirectUri,
      loginHint,
      // Si NO hay hint, forzamos selección de cuenta. Con hint, Microsoft usa el hint.
      prompt: loginHint ? undefined : "select_account",
      state,
    });
    res.setHeader("Set-Cookie", setCookie);
    return res.redirect(url);
  } catch (err) {
    console.error("Error generando URL de Microsoft:", err);
    return res.status(500).json({ error: "No se pudo iniciar el flujo SSO" });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/callback -> Recibe code, valida tenant, emite JWT y redirige al frontend.
// (También expuesto como /auth/microsoft/callback para retrocompatibilidad.)
// ---------------------------------------------------------------------------
async function microsoftCallbackHandler(req: Request, res: Response) {
  // Sprint 4+ · Origen del cliente (state OAuth). Solo dos destinos posibles:
  //   · web     → `${env.frontendUrl}/auth/success?token=…`  (comportamiento previo)
  //   · android → `ec.uta.servicedesk://auth/success?token=…` (deep link)
  // El destino de ERROR sigue apuntando a `${env.frontendUrl}/login` en ambos
  // casos: la app Android abre esa URL en el navegador del sistema; el usuario
  // ve el mensaje y vuelve manualmente a la app. Es mejor que morir con un
  // scheme desconocido si SSO no está configurado.
  const rawState = req.query.state;
  const errorBase = `${env.frontendUrl}/login`;
  // Fase T: la cookie de estado es de un solo uso: se borra siempre.
  res.setHeader("Set-Cookie", clearOAuthStateCookie(stateCookieSecure()));

  if (!env.ssoConfigured) {
    return res.redirect(`${errorBase}?error=sso_not_configured`);
  }
  const code = req.query.code as string | undefined;
  const errorParam = req.query.error as string | undefined;

  if (errorParam) {
    return res.redirect(
      `${errorBase}?error=${encodeURIComponent(errorParam)}`
    );
  }
  if (!code) {
    return res.redirect(`${errorBase}?error=missing_code`);
  }
  const client = verifyOAuthState(rawState, req.headers.cookie);
  if (!client) {
    logSecurity("sso_state_rejected", { ip: req.ip, reason: clientFromState(rawState) });
    return res.redirect(`${errorBase}?error=invalid_state`);
  }
  const successBase = client === "android" ? MOBILE_DEEP_LINK_SCHEME : `${env.frontendUrl}/auth/success`;

  try {
    const tokenResponse = await getMsalClient().acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: env.microsoft.redirectUri,
      // El state ya se verificó arriba contra la cookie del navegador.
      state: rawState as string,
    });

    const claims = (tokenResponse.idTokenClaims ?? {}) as MicrosoftClaims;
    const user = await upsertUserFromMicrosoft(claims);

    // Fase R: el JWT YA NO viaja en la URL. Se emite un código opaco de un
    // solo uso (60 s) que el cliente canjea con POST /auth/sso/exchange.
    const ssoCode = ssoCodes.issue(user.id);
    logSecurity("sso_code_issued", { ip: req.ip, email: user.email });

    // Web: /auth/success?code=…  |  Android: ec.uta.servicedesk://auth/success?code=…
    return res.redirect(`${successBase}?code=${encodeURIComponent(ssoCode)}`);
  } catch (err) {
    if (err instanceof DomainNotAllowedError) {
      return res.redirect(
        `${errorBase}?error=domain_not_allowed&domain=${env.allowedDomain}`
      );
    }
    console.error("Error en callback Microsoft:", err);
    return res.redirect(`${errorBase}?error=auth_failed`);
  }
}

router.get("/callback", microsoftCallbackHandler);
router.get("/microsoft/callback", microsoftCallbackHandler);

// ---------------------------------------------------------------------------
// Fase R - POST /auth/sso/exchange { code } -> { token, user }
// Canje del código de un solo uso emitido por el callback de Microsoft.
// El código se invalida en el primer intento (correcto o no).
// ---------------------------------------------------------------------------
router.post("/sso/exchange", async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  const gate = loginLimiter.check(ip);
  if (!gate.allowed) {
    res.setHeader("Retry-After", String(gate.retryAfterSeconds));
    return res.status(429).json({ error: TOO_MANY });
  }
  const pending = ssoCodes.consume(req.body?.code);
  if (!pending) {
    loginLimiter.recordFailure(ip);
    logSecurity("sso_code_rejected", { ip });
    return res.status(400).json({ error: "Código de inicio de sesión inválido o caducado" });
  }
  const user = await prisma.user.findUnique({ where: { id: pending.userId } });
  if (!user) {
    return res.status(400).json({ error: "Código de inicio de sesión inválido o caducado" });
  }
  const { token } = await issueSession(user, "microsoft");
  await logAccess({
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    endpoint: "/auth/sso/exchange",
    authProvider: "microsoft",
  });
  logSecurity("sso_exchange_success", { ip, email: user.email });
  return res.json({
    token,
    authProvider: "microsoft",
    mustChangePassword: false,
    user: { id: user.id, email: user.email, name: user.name, role: normalizeRole(user.role) },
  });
});

// ---------------------------------------------------------------------------
// Fase R - POST /auth/change-password { currentPassword, newPassword }
// Admite tokens con pwdChange (contraseña temporal). Revoca todas las sesiones
// del usuario y devuelve una sesión nueva normal.
// ---------------------------------------------------------------------------
router.post("/change-password", verifyJwtAllowPwdChange, async (req: Request, res: Response) => {
  const ip = req.ip ?? "unknown";
  const account = req.user!.email.toLowerCase();
  const gate = loginLimiter.check(ip, account);
  if (!gate.allowed) {
    res.setHeader("Retry-After", String(gate.retryAfterSeconds));
    return res.status(429).json({ error: TOO_MANY });
  }
  const currentPassword = String(req.body?.currentPassword ?? "");
  const newPassword = String(req.body?.newPassword ?? "");
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Contraseña actual y nueva son requeridas" });
  }
  try {
    const user = await changePassword(req.user!.userId, currentPassword, newPassword);
    loginLimiter.recordSuccess(account);
    const { token } = await issueSession(user, "local");
    logSecurity("password_changed", { ip, email: account });
    return res.json({ token, authProvider: "local", mustChangePassword: false });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      loginLimiter.recordFailure(ip, account);
      logSecurity("password_change_failed", { ip, email: account, reason: "current_password" });
      return res.status(401).json({ error: "La contraseña actual no es correcta" });
    }
    if (err instanceof PasswordPolicyError) {
      return res.status(400).json({ error: err.message, details: err.errors });
    }
    console.error("Error en change-password:", err);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/dev-login -> Solo desarrollo (AUTH_DEV_LOGIN=true)
// Permite emitir un JWT sin pasar por Microsoft. Útil para desbloquear al
// equipo (HU-03/04/05 + frontend) mientras se configura Azure AD.
// Body: { "email": "admin@uta.edu.ec" }
// ---------------------------------------------------------------------------
router.post("/dev-login", async (req: Request, res: Response) => {
  if (!env.devLoginEnabled) {
    return res.status(404).json({ error: "Endpoint no disponible" });
  }
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "email requerido" });
  }
  if (!email.endsWith(`@${env.allowedDomain.toLowerCase()}`)) {
    return res.status(403).json({
      error: `Solo se aceptan cuentas del dominio @${env.allowedDomain}`,
    });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(404).json({
      error: "Usuario no encontrado. Ejecuta el seed o crea el usuario primero.",
    });
  }
  const { token } = await issueSession(user, "local");

  // Registrar log de acceso
  await logAccess({
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    endpoint: "/auth/dev-login",
    authProvider: "local",
  });

  return res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

// ---------------------------------------------------------------------------
// GET /auth/config -> Info pública para el frontend (qué métodos están habilitados)
// ---------------------------------------------------------------------------
router.get("/config", (_req: Request, res: Response) => {
  res.json({
    ssoConfigured: env.ssoConfigured,
    devLoginEnabled: env.devLoginEnabled,
    allowedDomain: env.allowedDomain,
    microsoftSimulateEnabled: env.microsoftSimulateEnabled,
  });
});

// ---------------------------------------------------------------------------
// GET /auth/me -> Datos del usuario autenticado
// ---------------------------------------------------------------------------
router.get("/me", verifyJwtAllowPwdChange, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, email: true, name: true, role: true, createdAt: true, mustChangePassword: true },
  });
  if (!user) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }
  return res.json({ user: { ...user, role: normalizeRole(user.role) } });
});

// ---------------------------------------------------------------------------
// POST /auth/logout -> Revoca la sesión actual
// ---------------------------------------------------------------------------
router.post("/logout", verifyJwtAllowPwdChange, async (req: Request, res: Response) => {
  const header = req.headers.authorization!;
  const token = header.slice("Bearer ".length).trim();
  await revokeSession(token);
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /auth/verify -> Endpoint interno para que otros microservicios
// validen un JWT consultando al auth-service (defensa en profundidad).
// Los demás servicios además validan el JWT localmente con el mismo secreto.
// ---------------------------------------------------------------------------
router.post("/verify", verifyJwt, (req: Request, res: Response) => {
  return res.json({ valid: true, user: req.user });
});

// ---------------------------------------------------------------------------
// POST /auth/users/lookup -> Resolución masiva de usuarios por id.
// HU-07: ticket-service lo usa para enriquecer el panel técnico con nombre y
// email del solicitante (la integridad referencial entre microservicios es
// lógica vía userId, no FK).
// Body: { ids: string[] }   máx. 200 ids por llamada.
// Solo personal autorizado (admin / tech_*) puede invocarlo: protege PII.
// ---------------------------------------------------------------------------
const STAFF_ROLES = new Set<string>(OFFICIAL_STAFF_ROLES);

router.post("/users/lookup", verifyJwt, async (req: Request, res: Response) => {
  const role = req.user?.role ?? "";
  if (!STAFF_ROLES.has(role)) {
    return res.status(403).json({ error: "No tienes permisos para consultar usuarios" });
  }
  const rawIds: unknown = req.body?.ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return res.json({ users: [] });
  }
  if (rawIds.length > 200) {
    return res.status(400).json({ error: "Máximo 200 ids por llamada" });
  }
  const stringIds = rawIds.filter((x): x is string => typeof x === "string");
  const uniqueIds: string[] = Array.from(new Set<string>(stringIds));

  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, email: true, name: true, role: true, block: true },
  });
  return res.json({
    users: users.map((u) => ({ ...u, role: normalizeRole(u.role), block: blockForRole(u.role, u.block) })),
  });
});

// ---------------------------------------------------------------------------
// GET /auth/technicians -> Listado de técnicos para que el admin pueda
// seleccionarlos al asignar manualmente. Solo admin (los técnicos no necesitan
// ver la planilla de pares).
// Modelo `User` no tiene flag `isActive` por ahora; se considera vigente a
// todo usuario con rol tech_*. Devolvemos `isActive=true` en todos para que
// el frontend tenga un esquema estable cuando ese flag se agregue.
// ---------------------------------------------------------------------------
// Fase T — filtros: ?block=BLOQUE_1|BLOQUE_2|NONE (técnicos sin clasificar) y
// ?role=technician|dtic. `block` solo existe para técnicos; DTIC lo tiene null.
router.get("/technicians", verifyJwt, async (req: Request, res: Response) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Solo el administrador puede listar técnicos" });
  }
  const qBlock = typeof req.query.block === "string" ? req.query.block : undefined;
  const qRole = typeof req.query.role === "string" ? req.query.role : undefined;
  if (qBlock && qBlock !== "NONE" && !TECH_BLOCKS.includes(qBlock)) {
    return res.status(400).json({ error: "block debe ser BLOQUE_1, BLOQUE_2 o NONE" });
  }
  if (qRole && !TECH_ROLES.includes(qRole)) {
    return res.status(400).json({ error: "role debe ser technician o dtic" });
  }
  const technicians = await prisma.user.findMany({
    where: { role: { in: [...TECH_ROLES] } },
    select: { id: true, email: true, name: true, role: true, block: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  const rows = technicians
    .map((t) => ({
      id: t.id,
      email: t.email,
      name: t.name,
      role: normalizeRole(t.role),
      block: blockForRole(t.role, t.block),
      isActive: true,
    }))
    // Un bloque implica rol technician: DTIC nunca aparece en un filtro de bloque.
    .filter((t) => !qRole || t.role === qRole)
    .filter((t) => !qBlock || (qBlock === "NONE" ? t.role === Role.technician && t.block === null : t.block === qBlock));
  return res.json({ technicians: rows });
});

// ---------------------------------------------------------------------------
// Fase T — PATCH /auth/technicians/:id/block  { block: "BLOQUE_1"|"BLOQUE_2"|null }
// Solo admin. Solo para técnicos (rol technician): DTIC conserva su clasificación
// independiente (409). El bloque NO da acceso a tickets: es clasificación.
// ---------------------------------------------------------------------------
router.patch("/technicians/:id/block", verifyJwt, async (req: Request, res: Response) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Solo el administrador puede asignar bloques" });
  }
  const block = req.body?.block ?? null;
  if (block !== null && (typeof block !== "string" || !TECH_BLOCKS.includes(block))) {
    return res.status(400).json({ error: "block debe ser BLOQUE_1, BLOQUE_2 o null" });
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id } }).catch(() => null);
  if (!target) return res.status(404).json({ error: "Usuario no encontrado" });
  const role = normalizeRole(target.role);
  if (role === Role.dtic) {
    return res.status(409).json({ error: "DTIC conserva su clasificación independiente: no se asigna a un bloque" });
  }
  if (role !== Role.technician) {
    return res.status(409).json({ error: "Solo los técnicos (rol technician) se clasifican por bloque" });
  }
  const updated = await prisma.user.update({ where: { id: target.id }, data: { block } });
  await prisma.authLog.create({
    data: {
      userId: req.user!.userId,
      userEmail: req.user!.email,
      userName: req.user!.name,
      endpoint: `PATCH /auth/technicians/${target.id}/block → ${block ?? "sin bloque"}`,
      authProvider: "admin-action",
    },
  }).catch(() => undefined);
  console.log(JSON.stringify({ event: "technician_block_changed", by: req.user!.userId, technician: target.id, from: target.block ?? null, to: block }));
  return res.json({
    technician: { id: updated.id, name: updated.name, email: updated.email, role, block: blockForRole(updated.role, updated.block) },
  });
});

export default router;
