import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createProxyMiddleware, Options } from "http-proxy-middleware";
import { env } from "./config/env";
import { checkUpstream } from "./health/readiness";

export function createApp() {
  const app = express();

  // helmet con CSP relajada para no romper redirects de Microsoft.
  // crossOriginOpenerPolicy se DESACTIVA porque el flujo SSO usa window.opener
  // (popup -> postMessage al main window). Con COOP=same-origin el browser
  // corta opener al cruzar a localhost:8080 y el popup nunca puede notificar.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    })
  );

  // Sprint 4+ · CORS multi-origen para soportar:
  //   · Web SPA          → https://servicedesk-uta.site (env.frontendUrl)
  //   · APK Capacitor    → https://localhost (androidScheme=https)
  //   · iOS/otros        → capacitor://localhost, ionic://localhost (compat)
  // La app Android carga bundle offline, por eso el WebView usa https://localhost
  // como origen cuando hace fetch al backend público — sin este allowlist el
  // browser bloquea las respuestas con "Network Error" en Axios.
  const allowedOrigins = new Set<string>([
    env.frontendUrl,
    "https://localhost",
    "capacitor://localhost",
    "ionic://localhost",
  ]);

  app.use(
    cors({
      origin: (origin, cb) => {
        // Requests sin Origin (curl, health checks, same-origin) → permitidas.
        if (!origin) return cb(null, true);
        if (allowedOrigins.has(origin)) return cb(null, true);
        return cb(new Error(`CORS bloqueado: origin ${origin}`));
      },
      credentials: true,
    })
  );

  app.use(morgan("combined"));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "api-gateway" });
  });

  // Fase T — readiness (healthcheck de Docker): los 3 servicios responden y
  // tienen su base de datos disponible.
  app.get("/health/ready", async (_req, res) => {
    const [auth, catalog, ticket] = await Promise.all([
      checkUpstream(env.authServiceUrl),
      checkUpstream(env.catalogServiceUrl),
      checkUpstream(env.ticketServiceUrl),
    ]);
    const ready = auth && catalog && ticket;
    const s = (b: boolean) => (b ? "ok" : "fail");
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      service: "api-gateway",
      checks: { "auth-service": s(auth), "catalog-service": s(catalog), "ticket-service": s(ticket) },
    });
  });

  // ---------------------------------------------------------------------------
  // Proxies. NO añadimos express.json() ANTES de los proxies para no consumir
  // el body (lo necesitan los servicios destino, especialmente multipart en /tickets).
  // ---------------------------------------------------------------------------

  // El proxy hacia /api/auth quita el prefijo /api porque el auth-service expone /auth/*
  const baseProxyOpts: Partial<Options> = {
    changeOrigin: true,
    // Fase R: añade X-Forwarded-For/Proto para que auth-service conozca la IP
    // real del cliente (limitación de intentos). auth-service solo confía en
    // TRUST_PROXY_HOPS saltos, así que una cabecera falsificada no se acepta.
    xfwd: true,
    logger: console,
    on: {
      proxyReq: (_proxyReq, req) => {
        // log estructurado para debugging cross-service
        console.log(`[proxy] ${req.method} ${req.url}`);
      },
      error: (err, _req, res) => {
        console.error("[proxy] error:", err.message);
        if ("status" in res) {
          (res as express.Response).status(502).json({
            error: "Servicio no disponible",
            detail: err.message,
          });
        }
      },
    },
  };

  app.use(
    "/api/auth",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.authServiceUrl,
      pathRewrite: { "^": "/auth" },
    })
  );

  // Proxy directo /auth/* -> auth-service (necesario para que el redirect URI
  // registrado en Azure AD apunte a http://localhost:8080/auth/callback).
  app.use(
    "/auth",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.authServiceUrl,
      pathRewrite: { "^": "/auth" },
    })
  );

  app.use(
    "/api/catalog",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.catalogServiceUrl,
      pathRewrite: { "^/api/catalog": "" },
    })
  );

  // HU-10: Base de conocimiento. Vive en catalog-service (mismo origen lógico
  // que los servicios) bajo el path /knowledge.
  app.use(
    "/api/knowledge",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.catalogServiceUrl,
      pathRewrite: { "^": "/knowledge" },
    })
  );

  app.use(
    "/api/tickets",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.ticketServiceUrl,
      pathRewrite: { "^": "/tickets" },
    })
  );

  // HU-06: Motor de enrutamiento. Vive en ticket-service.
  app.use(
    "/api/routing",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.ticketServiceUrl,
      pathRewrite: { "^": "/routing" },
    })
  );

  // Sprint 2 (rev): endpoints administrativos (asignación manual, estadísticas).
  app.use(
    "/api/admin",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.ticketServiceUrl,
      pathRewrite: { "^": "/admin" },
    })
  );

  // Sprint 4+ · Registro/baja de tokens FCM para la app Android.
  app.use(
    "/api/notifications",
    createProxyMiddleware({
      ...baseProxyOpts,
      target: env.ticketServiceUrl,
      pathRewrite: { "^": "/notifications" },
    })
  );

  // 404 final
  app.use((_req, res) => {
    res.status(404).json({ error: "Ruta no encontrada en el gateway" });
  });

  return app;
}
