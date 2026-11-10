// Fase T — readiness del gateway: listo solo si los 3 microservicios están
// listos (cada uno comprueba su base de datos). Límite de tiempo por servicio.
export async function checkUpstream(baseUrl: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}/health/ready`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}
