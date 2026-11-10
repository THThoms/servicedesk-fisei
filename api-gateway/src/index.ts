import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.port, () => {
  console.log(`api-gateway escuchando en puerto ${env.port}`);
  console.log(`  /api/auth/*    -> ${env.authServiceUrl}`);
  console.log(`  /api/catalog/* -> ${env.catalogServiceUrl}`);
  console.log(`  /api/tickets/* -> ${env.ticketServiceUrl}`);
});
