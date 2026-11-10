// ServiceDesk UTA — Configuración Capacitor para la app Android.
//
// Estrategia: bundle offline (dist/) + API remota (https://servicedesk-uta.site).
// La navegación de la SPA vive dentro del contenedor; las llamadas a la API van
// contra el gateway público. Esto es más robusto que server.url remoto porque:
//   · No requiere webview cargar HTML remoto en cada arranque.
//   · Actualizar la UI es un rebuild + release nuevo, no un cambio en el server.
//   · Los deep links (push tap → /tickets/:id) funcionan sin conexión al backend.

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ec.uta.servicedesk",
  appName: "ServiceDesk UTA",
  webDir: "dist",
  server: {
    // androidScheme: https evita advertencias de contenido mixto cuando la
    // SPA hace fetch a la API pública HTTPS del gateway.
    androidScheme: "https",
  },
  android: {
    // Permite que la webview cargue assets locales del bundle.
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      // Presentación por defecto cuando la app está en foreground; también
      // dispara el listener `pushNotificationReceived` en JS.
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
