// Sprint 2 (rev) - Vista "Mis Tickets" para técnicos / admin, separada en
// dos pestañas:
//   - Activos:   tickets asignados al técnico que aún NO están resueltos ni
//                cerrados. Acciones: Aportar, Reescalar, Resolver, Ver historial.
//   - Historial: tickets resueltos o cerrados donde el técnico fue asignado o
//                resolutor. Solo lectura + Ver historial + resumen de solución.
//
// El backend ya filtra: /api/tickets/my-assigned (activos) y
// /api/tickets/my-assigned?history=true (historial). No mezclamos en cliente.

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { api, extractApiError, isCancelled } from "../lib/api";
import { getCurrentUser } from "../lib/auth";
import { ContributionModal, EscalateV2Modal } from "../components/TicketActionModals";
import ResolveTicketModal from "../components/ResolveTicketModal";
import TicketHistoryModal from "../components/TicketHistoryModal";
import {
  getResponsibleAreaLabel,
  getTechnicianNameLabel,
  ResponsibleAreaRef,
} from "../lib/technician";

interface Ticket {
  id: string;
  number: string;
  userName: string | null;
  userEmail: string | null;
  serviceId: string;
  serviceName: string | null;
  detail: string;
  status: "abierto" | "en_proceso" | "escalado" | "resuelto" | "cerrado";
  priority: "baja" | "media" | "alta" | "critica";
  responsibleArea: ResponsibleAreaRef;
  assignmentStatus: "unassigned" | "available" | "accepted" | "assigned_by_admin";
  assignedTechnicianId: string | null;
  assignedTechnicianName: string | null;
  acceptedAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  knowledgeArticleId: string | null;
  resolutionSummary: string | null;
  createdAt: string;
}

interface MyAssignedResponse {
  tickets: Ticket[];
  total: number;
  filters: { technicianId: string; includeClosed: boolean; history?: boolean };
}

type Tab = "active" | "history";

const STATUS_BADGE: Record<Ticket["status"], { label: string; classes: string }> = {
  abierto: { label: "Pendiente", classes: "bg-blue-100 text-blue-800" },
  en_proceso: { label: "En Proceso", classes: "bg-amber-100 text-amber-800" },
  escalado: { label: "Escalado", classes: "bg-purple-100 text-purple-800" },
  resuelto: { label: "Resuelto", classes: "bg-green-100 text-green-800" },
  cerrado: { label: "Cerrado", classes: "bg-gray-200 text-gray-700" },
};

const PRIORITY_BADGE: Record<Ticket["priority"], { label: string; classes: string }> = {
  baja: { label: "Baja", classes: "bg-gray-100 text-gray-700" },
  media: { label: "Media", classes: "bg-blue-100 text-blue-700" },
  alta: { label: "Alta", classes: "bg-orange-100 text-orange-800" },
  critica: { label: "Crítica", classes: "bg-red-100 text-red-800" },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MisTicketsAceptados() {
  const user = getCurrentUser();
  const [tab, setTab] = useState<Tab>("active");
  const [active, setActive] = useState<Ticket[]>([]);
  const [history, setHistory] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [actionTicket, setActionTicket] = useState<{
    ticket: Ticket;
    mode: "contribute" | "escalate" | "resolve";
  } | null>(null);
  const [historyTicket, setHistoryTicket] = useState<Ticket | null>(null);
  // Fase T: ticket abierto por enlace que no está en la lista (admin, o personal
  // del área que aún no lo aceptó). El backend decide si puede verlo.
  const [linkedTicket, setLinkedTicket] = useState<{ id: string; number: string; serviceName: string | null } | null>(null);

  // Sprint E (frontend hardening): AbortController para cancelar fetches al
  // desmontar el componente y evitar que se acumulen requests zombies.
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [act, hist] = await Promise.all([
        api.get<MyAssignedResponse>("/api/tickets/my-assigned", { signal }),
        api.get<MyAssignedResponse>("/api/tickets/my-assigned?history=true", { signal }),
      ]);
      setActive(act.data.tickets);
      setHistory(hist.data.tickets);
    } catch (err) {
      if (isCancelled(err)) return;
      setError(extractApiError(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // Sprint 4+ · Deep-link desde una notificación push: `?openTicket=<id>`
  // (o el fallback en sessionStorage) abre automáticamente el modal de
  // historial del ticket cuando termina de cargar.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (loading) return;
    const wanted =
      searchParams.get("openTicket") ??
      (sessionStorage.getItem("sd_open_ticket") || null);
    if (!wanted) return;
    const found =
      active.find((t) => t.id.toLowerCase() === wanted.toLowerCase()) ??
      history.find((t) => t.id.toLowerCase() === wanted.toLowerCase()) ??
      null;
    if (found) {
      setHistoryTicket(found);
      // Cambia a la pestaña adecuada si el ticket está en histórico.
      if (history.some((t) => t.id.toLowerCase() === wanted.toLowerCase())) setTab("history");
      // Consumir el param una sola vez.
      sessionStorage.removeItem("sd_open_ticket");
      if (searchParams.get("openTicket")) {
        const next = new URLSearchParams(searchParams);
        next.delete("openTicket");
        setSearchParams(next, { replace: true });
      }
    } else {
      // No está en mis listas: se pregunta al backend (403 si no tiene acceso).
      sessionStorage.removeItem("sd_open_ticket");
      if (searchParams.get("openTicket")) {
        const next = new URLSearchParams(searchParams);
        next.delete("openTicket");
        setSearchParams(next, { replace: true });
      }
      api
        .get<{ ticket: { number: string; serviceName: string | null } }>(`/api/tickets/history/${encodeURIComponent(wanted)}`)
        .then((r) => setLinkedTicket({ id: wanted, number: r.data.ticket.number, serviceName: r.data.ticket.serviceName }))
        .catch((err) => setError(extractApiError(err)));
    }
  }, [loading, active, history, searchParams, setSearchParams]);

  const acceptedByMe = (t: Ticket) =>
    t.assignedTechnicianId !== null && t.assignedTechnicianId === user?.userId;

  const tickets = tab === "active" ? active : history;

  return (
    <Layout>
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-uta-900">Mis Tickets</h1>
          <p className="mt-1 text-sm text-gray-600">
            Tickets que tomaste de la bandeja o que el administrador te asignó.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="card border-amber-200 text-center">
            <p className="text-3xl font-bold text-amber-600">{active.length}</p>
            <p className="text-xs font-semibold text-gray-500">Activos</p>
          </div>
          <div className="card border-emerald-200 text-center">
            <p className="text-3xl font-bold text-emerald-600">{history.length}</p>
            <p className="text-xs font-semibold text-gray-500">Resueltos / cerrados</p>
          </div>
        </div>

        <div className="mb-4 flex gap-2 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={`px-4 py-2 text-sm font-semibold transition ${
              tab === "active"
                ? "border-b-2 border-uta-700 text-uta-900"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Activos ({active.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("history")}
            className={`px-4 py-2 text-sm font-semibold transition ${
              tab === "history"
                ? "border-b-2 border-uta-700 text-uta-900"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Historial ({history.length})
          </button>
        </div>

        {flash && (
          <div className="mb-4 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
            {flash}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600" />
            <p className="text-sm text-gray-500">Cargando tickets…</p>
          </div>
        )}

        {!loading && !error && tickets.length === 0 && (
          <div className="card py-12 text-center text-sm text-gray-500">
            {tab === "active" ? (
              <>
                <p>No tienes tickets activos.</p>
                <p className="mt-2">
                  Ve a{" "}
                  <Link to="/panel" className="font-semibold text-uta-700 hover:underline">
                    Panel Técnico
                  </Link>{" "}
                  y toma uno desde <strong>Disponibles</strong>.
                </p>
              </>
            ) : (
              <p>Aún no has resuelto ni cerrado ningún ticket.</p>
            )}
          </div>
        )}

        {!loading && tickets.length > 0 && (
          <div className="space-y-3">
            {tickets.map((t) => {
              const s = STATUS_BADGE[t.status] ?? {
                label: t.status,
                classes: "bg-gray-100 text-gray-700",
              };
              const p = PRIORITY_BADGE[t.priority] ?? {
                label: t.priority,
                classes: "bg-gray-100 text-gray-700",
              };
              return (
                <div
                  key={t.id}
                  className="card cursor-pointer transition hover:border-uta-300 hover:shadow-md"
                  role="button"
                  tabIndex={0}
                  onClick={() => setHistoryTicket(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setHistoryTicket(t);
                    }
                  }}
                  aria-label={`Abrir detalle del ticket ${t.number}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-uta-900">
                          {t.number}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.classes}`}
                        >
                          {s.label}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${p.classes}`}
                        >
                          {p.label}
                        </span>
                        <span className="inline-flex rounded-full bg-uta-50 px-2 py-0.5 text-xs font-bold text-uta-900">
                          {getResponsibleAreaLabel(t.responsibleArea)}
                        </span>
                        {tab === "active" && acceptedByMe(t) && (
                          <span className="inline-flex rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-800">
                            ✓ Aceptado por mí
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-700 line-clamp-2">{t.detail}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Solicitante: <strong>{t.userName ? getTechnicianNameLabel(t.userName) : "—"}</strong> · Servicio:{" "}
                        <strong>{t.serviceName ?? "—"}</strong>
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Creado: {formatDate(t.createdAt)} · Aceptado: {formatDate(t.acceptedAt)}
                        {tab === "history" && t.resolvedAt && (
                          <>
                            {" · Resuelto: "}
                            <span className="text-emerald-700">{formatDate(t.resolvedAt)}</span>
                          </>
                        )}
                      </p>
                      {tab === "history" && t.resolvedByName && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          Resuelto por <strong>{getTechnicianNameLabel(t.resolvedByName)}</strong>
                          {t.knowledgeArticleId ? " · solución vinculada en KB" : null}
                        </p>
                      )}
                      {tab === "history" && t.resolutionSummary && (
                        <p className="mt-2 rounded bg-green-50 px-2 py-1 text-xs italic text-green-900">
                          Nota final: {t.resolutionSummary}
                        </p>
                      )}
                    </div>

                    <div
                      className="flex flex-wrap items-start justify-end gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setHistoryTicket(t);
                        }}
                        className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Ver detalle
                      </button>
                      {tab === "active" && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionTicket({ ticket: t, mode: "contribute" });
                            }}
                            className="rounded border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            Aportar
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionTicket({ ticket: t, mode: "escalate" });
                            }}
                            className="rounded bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                          >
                            Reescalar
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionTicket({ ticket: t, mode: "resolve" });
                            }}
                            className="rounded bg-green-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-800"
                          >
                            Dar de alta / Resolver
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {actionTicket?.mode === "contribute" && (
          <ContributionModal
            ticket={actionTicket.ticket}
            onClose={() => setActionTicket(null)}
            onSuccess={() => {
              setActionTicket(null);
              setFlash("Aportación registrada");
              load();
              window.setTimeout(() => setFlash(null), 5000);
            }}
          />
        )}
        {actionTicket?.mode === "escalate" && (
          <EscalateV2Modal
            ticket={actionTicket.ticket}
            onClose={() => setActionTicket(null)}
            onSuccess={() => {
              setActionTicket(null);
              setFlash("Ticket escalado correctamente");
              load();
              window.setTimeout(() => setFlash(null), 5000);
            }}
          />
        )}
        {actionTicket?.mode === "resolve" && (
          <ResolveTicketModal
            ticket={{
              id: actionTicket.ticket.id,
              number: actionTicket.ticket.number,
              serviceId: actionTicket.ticket.serviceId,
              serviceName: actionTicket.ticket.serviceName,
              responsibleArea: actionTicket.ticket.responsibleArea,
            }}
            onClose={() => setActionTicket(null)}
            onSuccess={() => {
              setActionTicket(null);
              setFlash("Ticket resuelto correctamente");
              load();
              window.setTimeout(() => setFlash(null), 5000);
            }}
          />
        )}

        {historyTicket && (
          <TicketHistoryModal
            ticket={{
              id: historyTicket.id,
              number: historyTicket.number,
              serviceName: historyTicket.serviceName,
            }}
            audience="staff"
            onClose={() => setHistoryTicket(null)}
          />
        )}

        {linkedTicket && (
          <TicketHistoryModal ticket={linkedTicket} audience="staff" onClose={() => setLinkedTicket(null)} />
        )}
      </div>
    </Layout>
  );
}
