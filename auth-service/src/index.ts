import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./db/client";
import { purgeSessions } from "./maintenance/maintenance";
import { loginLimiter } from "./security/loginRateLimiter";
import dns from "dns";
import https from "https";
import http from "http";

// Forzar IPv4 al salir a Internet: el resolver Docker devuelve AAAA pero el
// contenedor no rutea IPv6 -> ENETUNREACH al llamar a login.microsoftonline.com.
dns.setDefaultResultOrder("ipv4first");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(https.globalAgent as any).options.family = 4;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(http.globalAgent as any).options.family = 4;

const app = createApp();

// Fase R: purga periódica de sesiones caducadas/revocadas y limpieza de los
// contadores de intentos (además de la ejecución al arranque en el entrypoint).
const SIX_HOURS = 6 * 60 * 60 * 1000;
setInterval(() => {
  loginLimiter.sweep();
  purgeSessions(prisma, Number(process.env.SESSION_RETENTION_DAYS ?? 7) || 7)
    .then((n) => n > 0 && console.log(`[auth-maintenance] sesiones purgadas: ${n}`))
    .catch((e) => console.error("[auth-maintenance] purga falló:", e instanceof Error ? e.message : e));
}, SIX_HOURS).unref();

app.listen(env.port, () => {
  console.log(`auth-service escuchando en puerto ${env.port}`);
  console.log(
    `[auth] NODE_ENV=${env.nodeEnv} · dev-login=${env.devLoginEnabled ? "ON" : "off"} · ` +
      `microsoft-simulate=${env.microsoftSimulateEnabled ? "ON" : "off"} · sso=${env.ssoConfigured ? "configurado" : "no configurado"}`
  );
  if (env.insecureLoginRequestedInProduction) {
    console.warn(
      "[auth] AVISO: AUTH_DEV_LOGIN / AUTH_MICROSOFT_SIMULATE solicitados con NODE_ENV=production. " +
        "Se IGNORAN: los logins sin contraseña nunca se habilitan en producción."
    );
  }
});
