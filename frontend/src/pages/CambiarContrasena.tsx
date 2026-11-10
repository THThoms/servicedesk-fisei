import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, extractApiError } from "../lib/api";
import { clearToken, getCurrentUser, landingRouteFor } from "../lib/auth";
import { completeLogin } from "../lib/session";

// Fase R — Cambio de contraseña obligatorio (contraseña temporal del bootstrap
// del administrador o de un reset). Hasta completarlo, el backend rechaza el
// resto de endpoints con 403 password_change_required.
const RULES = [
  { test: (p: string) => p.length >= 12, label: "Al menos 12 caracteres" },
  { test: (p: string) => /[A-Z]/.test(p), label: "Una mayúscula" },
  { test: (p: string) => /[a-z]/.test(p), label: "Una minúscula" },
  { test: (p: string) => /\d/.test(p), label: "Un número" },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: "Un símbolo" },
];

export default function CambiarContrasena() {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  if (!user) return <Navigate to="/login" replace />;
  if (!user.pwdChange) return <Navigate to={landingRouteFor(user.role)} replace />;

  const rulesOk = RULES.every((r) => r.test(next));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails([]);
    if (next !== confirm) {
      setError("La confirmación no coincide con la nueva contraseña.");
      return;
    }
    if (!rulesOk) {
      setError("La nueva contraseña no cumple los requisitos.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ token: string }>("/api/auth/change-password", {
        currentPassword: current,
        newPassword: next,
      });
      const target = completeLogin(res.data.token, "local");
      navigate(target ?? "/", { replace: true });
    } catch (err) {
      setError(extractApiError(err));
      const d = (err as { response?: { data?: { details?: string[] } } }).response?.data?.details;
      if (Array.isArray(d)) setDetails(d);
    } finally {
      setSaving(false);
    }
  }

  function logout() {
    api.post("/api/auth/logout").catch(() => undefined).finally(() => {
      clearToken();
      navigate("/login", { replace: true });
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-uta-50 px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-md space-y-4" autoComplete="off">
        <div>
          <h1 className="text-xl font-semibold text-uta-900">Cambia tu contraseña</h1>
          <p className="mt-1 text-sm text-slate-600">
            Iniciaste sesión con una contraseña temporal. Debes elegir una nueva para continuar.
          </p>
        </div>
        <label className="block text-sm font-medium text-uta-900">
          Contraseña temporal
          <input type="password" className="input mt-1" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="block text-sm font-medium text-uta-900">
          Nueva contraseña
          <input type="password" className="input mt-1" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
        </label>
        <ul className="grid grid-cols-2 gap-1 text-xs">
          {RULES.map((r) => (
            <li key={r.label} className={r.test(next) ? "text-green-700" : "text-slate-500"}>
              {r.test(next) ? "✓" : "•"} {r.label}
            </li>
          ))}
        </ul>
        <label className="block text-sm font-medium text-uta-900">
          Repite la nueva contraseña
          <input type="password" className="input mt-1" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>
        {error && (
          <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700" role="alert">
            {error}
            {details.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {details.map((d) => <li key={d}>{d}</li>)}
              </ul>
            )}
          </div>
        )}
        <button type="submit" className="btn-primary w-full" disabled={saving || !rulesOk || next !== confirm}>
          {saving ? "Guardando…" : "Guardar nueva contraseña"}
        </button>
        <button type="button" onClick={logout} className="w-full text-sm text-slate-600 underline">
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}
