import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { getCurrentUser, Role } from "../lib/auth";
import { CHANGE_PASSWORD_ROUTE } from "../lib/session";

interface ProtectedRouteProps {
  children: ReactNode;
  /** Si se pasan, solo esos roles pueden entrar */
  roles?: Role[];
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const user = getCurrentUser();
  if (!user) return <Navigate to="/login" replace />;
  // Fase R: con contraseña temporal solo se permite cambiarla.
  if (user.pwdChange) return <Navigate to={CHANGE_PASSWORD_ROUTE} replace />;
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/tickets/nuevo" replace />;
  }
  return <>{children}</>;
}
