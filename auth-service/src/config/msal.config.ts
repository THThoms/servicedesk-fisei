import { ConfidentialClientApplication, Configuration, LogLevel } from "@azure/msal-node";
import { env } from "./env";

// Scopes solicitados al login de Microsoft. openid/profile/email son los claims base;
// User.Read habilita futuras llamadas a Microsoft Graph si se necesitan.
export const SCOPES = ["openid", "profile", "email", "User.Read"];

// Construcción perezosa: solo se instancia el cliente cuando se intenta usar SSO real.
// Permite que el servicio arranque sin MICROSOFT_* configurado (modo dev-login).
let cachedClient: ConfidentialClientApplication | null = null;

export function getMsalClient(): ConfidentialClientApplication {
  if (!env.ssoConfigured) {
    throw new Error("SSO_NOT_CONFIGURED");
  }
  if (!cachedClient) {
    const msalConfig: Configuration = {
      auth: {
        clientId: env.microsoft.clientId,
        authority: `https://login.microsoftonline.com/${env.microsoft.tenantId}`,
        clientSecret: env.microsoft.clientSecret,
      },
      system: {
        loggerOptions: {
          loggerCallback: (level, message) => {
            if (level === LogLevel.Error) {
              console.error("[MSAL]", message);
            }
          },
          piiLoggingEnabled: false,
          logLevel: LogLevel.Warning,
        },
      },
    };
    cachedClient = new ConfidentialClientApplication(msalConfig);
  }
  return cachedClient;
}
