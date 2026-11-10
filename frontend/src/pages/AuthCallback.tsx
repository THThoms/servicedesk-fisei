import { useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { exchangeSsoCode } from "../lib/session";

// Fase R — Vuelta de Microsoft SSO (web). La URL trae un código opaco de un
// solo uso (?code=…), NUNCA el JWT. Se canjea por POST y se limpia la URL.
export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return; // StrictMode monta dos veces: el código es de un solo uso
    done.current = true;
    const code = params.get("code");
    const errorCode = params.get("error");
    window.history.replaceState(null, "", window.location.pathname); // el código sale de la barra de direcciones

    if (!code) {
      navigate(`/login?error=${encodeURIComponent(errorCode ?? "missing_code")}`, { replace: true });
      return;
    }
    exchangeSsoCode(code)
      .then((next) => navigate(next, { replace: true }))
      .catch(() => navigate("/login?error=auth_failed", { replace: true }));
  }, [params, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-uta-50">
      <div className="card text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-100 border-t-uta-500" />
        <p className="text-sm text-uta-900">Procesando inicio de sesión…</p>
      </div>
    </div>
  );
}
