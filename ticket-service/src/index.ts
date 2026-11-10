import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./db/client";
import { ensureAcceptanceSchema } from "./services/acceptanceService";

const app = createApp();

app.listen(env.port, () => {
  console.log(`ticket-service escuchando en puerto ${env.port}`);
  console.log(`  uploads dir: ${env.uploadDir}`);
  // Fase T: términos de aceptación publicados + constancias inmutables.
  ensureAcceptanceSchema(prisma)
    .then(() => console.log("[acceptance] términos y triggers de inmutabilidad verificados"))
    .catch((err) => console.error("[acceptance] no se pudo preparar la aceptación digital:", err));
});
