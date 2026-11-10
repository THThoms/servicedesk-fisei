// Sprint 4+ — Página puente para deep-links `/tickets/:id`.
//
// La app Android abre esta URL al tocar una notificación push. Como la SPA
// no tiene una página dedicada de detalle de ticket, redirigimos al listado
// apropiado según el rol del usuario, pasando `?openTicket=<id>` como query
// param. Cada listado ya sabe cómo abrir el modal de historial o marcar el
// ticket al scrollear.

import { useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
import { getCurrentUser, isStaffRole } from "../lib/auth";

export default function TicketDeepLink() {
  const { id } = useParams<{ id: string }>();
  const user = getCurrentUser();

  useEffect(() => {
    // Marca el ticket en sessionStorage para que la página destino lo detecte
    // aunque el router pierda el query en algún push/replace intermedio.
    if (id) sessionStorage.setItem("sd_open_ticket", id);
  }, [id]);

  if (!user) {
    return <Navigate to={`/login?next=/tickets/${id ?? ""}`} replace />;
  }

  const query = id ? `?openTicket=${encodeURIComponent(id)}` : "";

  // admin y técnicos → bandeja de aceptados (donde ven detalles).
  if (isStaffRole(user.role)) {
    return <Navigate to={`/mis-aceptados${query}`} replace />;
  }
  // usuario final → sus propios tickets.
  return <Navigate to={`/mis-tickets${query}`} replace />;
}
