// Fase R — Registro de eventos de seguridad (stdout → journal/docker logs).
// NUNCA incluye contraseñas, JWT, códigos SSO ni hashes. El correo se registra
// enmascarado (a***@uta.edu.ec) para trazabilidad sin exponer la cuenta completa.
export type SecurityEvent =
  | "login_failed"
  | "login_rate_limited"
  | "login_success"
  | "password_changed"
  | "password_change_failed"
  | "sso_code_issued"
  | "sso_code_rejected"
  | "sso_state_rejected"
  | "sso_exchange_success"
  | "insecure_login_blocked";

export function maskEmail(email: string | undefined | null): string {
  if (!email) return "-";
  const [local, domain] = String(email).toLowerCase().split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function logSecurity(event: SecurityEvent, details: { ip?: string; email?: string; reason?: string } = {}): void {
  const line = {
    ts: new Date().toISOString(),
    event,
    ip: details.ip ?? "-",
    account: maskEmail(details.email),
    ...(details.reason ? { reason: details.reason } : {}),
  };
  console.log(`[security] ${JSON.stringify(line)}`);
}
