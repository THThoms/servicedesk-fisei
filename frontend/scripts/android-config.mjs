// Fase T — configuración del dominio para la app Android (Capacitor).
//
// El APK lleva la URL del servidor "horneada" en el build (VITE_API_URL). Para
// cambiar de servidor basta UNA variable:
//   VITE_API_URL=https://servicedesk.nuevo-dominio.edu.ec npm run build:android
// Este script se niega a continuar si la URL falta, no es https, apunta a
// localhost/IP privada o lleva ruta: así no se publica un APK que no funcione.
// (appId ec.uta.servicedesk y el deep link ec.uta.servicedesk://auth no cambian.)
export function validateAndroidApiUrl(raw) {
  if (!raw) return { ok: false, error: "Falta VITE_API_URL (ej. https://servicedesk.ejemplo.edu.ec)" };
  let u;
  try { u = new URL(raw); } catch { return { ok: false, error: `VITE_API_URL no es una URL válida: ${raw}` }; }
  if (u.protocol !== "https:") return { ok: false, error: "VITE_API_URL debe usar https:// (Android bloquea http y el SSO exige https)" };
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0)/.test(u.hostname)) {
    return { ok: false, error: `VITE_API_URL apunta a una dirección local (${u.hostname}): el teléfono no podrá conectarse` };
  }
  if (u.pathname !== "/" || u.search || u.hash) return { ok: false, error: "VITE_API_URL debe ser solo el origen, sin ruta (la app añade /api/...)" };
  return { ok: true, origin: u.origin };
}

// Ejecutado como script (no importado desde los tests).
if ((process.argv[1] ?? "").endsWith("android-config.mjs")) {
  const r = validateAndroidApiUrl(process.env.VITE_API_URL);
  if (!r.ok) { console.error(`✘ ${r.error}`); process.exit(1); }
  console.log(`✔ App Android apuntará a ${r.origin}`);
}
