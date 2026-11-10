// Sprint 2 (rev) - Panel técnico: bandeja de tickets DISPONIBLES para que el
// técnico los acepte. La vista de tickets ya aceptados vive en /mis-aceptados
// (página separada con tabs Activos / Historial), por lo que aquí solo
// mostramos la bandeja de disponibles + el botón "Aceptar".

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import TicketHistoryModal from "../components/TicketHistoryModal";
import { api, extractApiError, isCancelled } from "../lib/api";
import { getCurrentUser } from "../lib/auth";
import {
  getAccountNameLabel,
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
  createdAt: string;
}

const STATUS_BADGE: Record<Ticket["status"], { label: string; classes: string }> = {
  abierto:    { label: "Pendiente",  classes: "bg-blue-100 text-blue-800" },
  en_proceso: { label: "En Proceso", classes: "bg-amber-100 text-amber-800" },
  escalado:   { label: "Escalado",   classes: "bg-purple-100 text-purple-800" },
  resuelto:   { label: "Resuelto",   classes: "bg-green-100 text-green-800" },
  cerrado:    { label: "Cerrado",    classes: "bg-gray-200 text-gray-700" },
};

const PRIORITY_BADGE: Record<Ticket["priority"], { label: string; classes: string }> = {
  baja:    { label: "Baja",    classes: "bg-gray-100 text-gray-700" },
  media:   { label: "Media",   classes: "bg-blue-100 text-blue-700" },
  alta:    { label: "Alta",    classes: "bg-orange-100 text-orange-800" },
  critica: { label: "Crítica", classes: "bg-red-100 text-red-800" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function PanelTecnicoV2() {
  const user = getCurrentUser();
  const isAdmin = user?.role === "admin";
  const [available, setAvailable] = useState<Ticket[]>([]);
  const [areas, setAreas] = useState<ResponsibleAreaRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [historyTicket, setHistoryTicket] = useState<Ticket | null>(null);

  // Sprint E (frontend hardening): las cargas usan AbortController para que al
  // desmontar el componente (navegación rápida entre paneles) las requests en
  // vuelo se cancelen; sin esto el navegador satura sus 6 conexiones por
  // origen y aparenta congelarse.
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ tickets: Ticket[]; areas: ResponsibleAreaRef[] }>(
        "/api/tickets/available",
        { signal }
      );
      setAvailable(r.data.tickets);
      setAreas(r.data.areas ?? []);
    } catch (err) {
      if (isCancelled(err)) return; // request abortada al desmontar — silencio.
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

  async function acceptTicket(t: Ticket) {
    setError(null);
    try {
      await api.post(`/api/tickets/${t.id}/accept`);
      setFlash(`Aceptaste el ticket ${t.number}. Lo encontrarás en "Mis Aceptados".`);
      await load();
      window.setTimeout(() => setFlash(null), 6000);
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  return (
    <Layout>
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-uta-900">Panel Técnico</h1>
            <p className="mt-1 text-sm text-gray-600">
              {getAccountNameLabel(user)} · áreas: {areas.map(getResponsibleAreaLabel).join(", ") || "—"}
            </p>
          </div>
          <Link
            to="/mis-aceptados"
            className="rounded border border-uta-700 bg-white px-3 py-1.5 text-sm font-semibold text-uta-700 hover:bg-uta-50"
          >
            Ir a Mis Aceptados →
          </Link>
        </div>

        <div className="mb-6">
          <div className="card border-blue-200 text-center">
            <p className="text-3xl font-bold text-blue-600">{available.length}</p>
            <p className="text-xs font-semibold text-gray-500">Tickets disponibles</p>
          </div>
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
            <p className="text-sm text-gray-500">Cargando tickets disponibles…</p>
          </div>
        )}

        {!loading && available.length === 0 && (
          <div className="card py-12 text-center text-sm text-gray-500">
            No hay tickets disponibles en tus áreas en este momento.
          </div>
        )}

        {!loading && available.length > 0 && (
          <div className="card overflow-x-auto p-0">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Ticket</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Solicitante</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Servicio</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Área</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Prioridad</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Creado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {available.map((t) => {
                  const s = STATUS_BADGE[t.status] ?? { label: t.status, classes: "bg-gray-100 text-gray-700" };
                  const p = PRIORITY_BADGE[t.priority] ?? { label: t.priority, classes: "bg-gray-100 text-gray-700" };
                  return (
                    <tr
                      key={t.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => setHistoryTicket(t)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setHistoryTicket(t);
                        }
                      }}
                      aria-label={`Abrir detalle del ticket ${t.number}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-uta-900">{t.number}</td>
                      <td className="px-4 py-3 text-gray-700 truncate max-w-[180px]" title={t.userEmail ?? ""}>
                        {t.userName ? getTechnicianNameLabel(t.userName) : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-700 truncate max-w-[180px]">{t.serviceName ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex rounded bg-uta-50 px-2 py-0.5 text-xs font-bold text-uta-900">
                          {getResponsibleAreaLabel(t.responsibleArea)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${p.classes}`}>{p.label}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.classes}`}>{s.label}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {formatDate(t.createdAt)}
                      </td>
                      <td
                        className="whitespace-nowrap px-4 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex flex-wrap gap-1.5">
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
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              acceptTicket(t);
                            }}
                            disabled={isAdmin}
                            title={isAdmin ? "El admin debe usar la asignación manual" : "Aceptar ticket"}
                            className="rounded bg-uta-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-uta-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            Aceptar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
      </div>
    </Layout>
  );
}
