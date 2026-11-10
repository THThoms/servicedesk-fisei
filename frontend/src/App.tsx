import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import Login from "./pages/Login";
import AuthCallback from "./pages/AuthCallback";
import NuevoTicket from "./pages/NuevoTicket";
import AdminCatalogo from "./pages/AdminCatalogo";
import PanelTecnicoV2 from "./pages/PanelTecnicoV2";
import BaseConocimiento from "./pages/BaseConocimiento";
import MisTickets from "./pages/MisTickets";
import MisTicketsAceptados from "./pages/MisTicketsAceptados";
import AdminStats from "./pages/AdminStats";
import AdminHistorial from "./pages/AdminHistorial";
import AdminBloques from "./pages/AdminBloques";
import AdminReporteTecnicos from "./pages/AdminReporteTecnicos";
import AdminKnowledge from "./pages/AdminKnowledge";
import AdminUbicaciones from "./pages/AdminUbicaciones";
import TicketDeepLink from "./pages/TicketDeepLink";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { getCurrentUser, landingRouteFor, STAFF_ROLES } from "./lib/auth";
import { CHANGE_PASSWORD_ROUTE, exchangeSsoCode } from "./lib/session";
import CambiarContrasena from "./pages/CambiarContrasena";
import { initPushNotifications } from "./lib/pushNotifications";
import {
  closeSsoBrowser,
  isCapacitorAndroid,
  parseSsoDeepLink,
} from "./lib/ssoMobile";

function RootRedirect() {
  const user = getCurrentUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.pwdChange) return <Navigate to={CHANGE_PASSWORD_ROUTE} replace />;
  return <Navigate to={landingRouteFor(user.role)} replace />;
}

/**
 * Sprint 4+ — Inicializador de push notifications (Android/Capacitor).
 * En web es no-op. Se ejecuta cuando hay usuario autenticado.
 */
function PushInitializer() {
  const navigate = useNavigate();
  useEffect(() => {
    const user = getCurrentUser();
    if (!user) return;
    // Fire-and-forget: nunca debe romper el arranque de la SPA.
    initPushNotifications({
      onNavigate: (path) => navigate(path),
    }).catch((err) => console.warn("[push] init falló:", err));
  }, [navigate]);
  return null;
}

/**
 * Sprint 4+ — Captura de deep-links Microsoft SSO en Android.
 * En web no hace nada. En Android registra `App.addListener('appUrlOpen')`;
 * cuando el backend redirige a `ec.uta.servicedesk://auth/success?code=…`
 * (tras autenticar en Chrome Custom Tabs), canjeamos el código, persistimos
 * la sesión y navegamos al panel correspondiente al rol.
 */
function SsoDeepLinkHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isCapacitorAndroid()) return;
    let subHandle: { remove: () => Promise<void> } | undefined;
    (async () => {
      const { App } = await import("@capacitor/app");
      subHandle = await App.addListener("appUrlOpen", ({ url }) => {
        const result = parseSsoDeepLink(url);
        if (!result) return;
        // Cierra la pestaña del navegador para que Android traiga la app al frente.
        void closeSsoBrowser();
        if (result.error) {
          const q = new URLSearchParams({ error: result.error });
          if (result.domain) q.set("domain", result.domain);
          navigate(`/login?${q.toString()}`, { replace: true });
          return;
        }
        // Fase R: canje del código de un solo uso por POST (sin JWT en la URL).
        const code = result.code;
        if (!code) {
          navigate("/login?error=missing_code", { replace: true });
          return;
        }
        exchangeSsoCode(code)
          .then((next) => navigate(next, { replace: true }))
          .catch(() => navigate("/login?error=auth_failed", { replace: true }));
      });
    })().catch((err) => console.warn("[sso] deep-link listener falló:", err));
    return () => {
      subHandle?.remove().catch(() => undefined);
    };
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <>
      <SsoDeepLinkHandler />
      <PushInitializer />
      <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/auth/success" element={<AuthCallback />} />
      <Route path={CHANGE_PASSWORD_ROUTE} element={<CambiarContrasena />} />
      <Route
        path="/tickets/nuevo"
        element={
          <ProtectedRoute>
            <NuevoTicket />
          </ProtectedRoute>
        }
      />
      <Route
        path="/panel"
        element={
          <ProtectedRoute roles={STAFF_ROLES}>
            <PanelTecnicoV2 />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mis-tickets"
        element={
          <ProtectedRoute>
            <MisTickets />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mis-aceptados"
        element={
          <ProtectedRoute roles={STAFF_ROLES}>
            <MisTicketsAceptados />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/stats"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminStats />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/historial"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminHistorial />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/bloques"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminBloques />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/reportes"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminReporteTecnicos />
          </ProtectedRoute>
        }
      />
      <Route
        path="/conocimiento"
        element={
          <ProtectedRoute roles={STAFF_ROLES}>
            <BaseConocimiento />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/catalogo"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminCatalogo />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/conocimiento"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminKnowledge />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/ubicaciones"
        element={
          <ProtectedRoute roles={["admin"]}>
            <AdminUbicaciones />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tickets/:id"
        element={
          <ProtectedRoute>
            <TicketDeepLink />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
