import dotenv from "dotenv";

dotenv.config();

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Falta variable de entorno: ${name}`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8080),

  authServiceUrl: required("AUTH_SERVICE_URL", process.env.AUTH_SERVICE_URL),
  catalogServiceUrl: required("CATALOG_SERVICE_URL", process.env.CATALOG_SERVICE_URL),
  ticketServiceUrl: required("TICKET_SERVICE_URL", process.env.TICKET_SERVICE_URL),

  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
};
