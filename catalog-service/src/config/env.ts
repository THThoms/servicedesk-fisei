import dotenv from "dotenv";

dotenv.config();

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3002),
  jwtSecret: required("JWT_SECRET", process.env.JWT_SECRET),
  // Fase R: introspección de sesión (logout/revocación efectivos también aquí).
  authServiceUrl: process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001",
};
