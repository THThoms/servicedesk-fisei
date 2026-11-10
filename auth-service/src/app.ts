import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { checkDatabase } from "./health/readiness";
import authRoutes from "./routes/authRoutes";
import { env } from "./config/env";

export function createApp() {
  const app = express();

  // Fase R: req.ip = IP real del cliente para la limitación de intentos.
  // Saltos de proxy de confianza: gateway (1) + nginx del host (2) en el
  // servidor; en el laboratorio sin nginx basta 1. Nunca "true" (spoofing).
  app.set("trust proxy", env.trustProxyHops);

  // COOP off: el popup SSO necesita window.opener para postMessage al main window.
  app.use(
    helmet({
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    })
  );
  app.use(cors());
  app.use(express.json());
  app.use(morgan("combined"));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "auth-service" });
  });

  // Fase T — readiness (lo usa el healthcheck de Docker): base de datos real.
  app.get("/health/ready", async (_req, res) => {
    const db = await checkDatabase();
    res.status(db ? 200 : 503).json({
      status: db ? "ready" : "not_ready",
      service: "auth-service",
      checks: { database: db ? "ok" : "fail" },
    });
  });

  app.use("/auth", authRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: "Endpoint no encontrado" });
  });

  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(err);
      res.status(500).json({ error: "Error interno del servidor" });
    }
  );

  return app;
}
