import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.port, () => {
  console.log(`catalog-service escuchando en puerto ${env.port}`);
});
