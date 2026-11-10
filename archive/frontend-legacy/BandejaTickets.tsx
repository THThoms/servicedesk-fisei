import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";
import { getCurrentUser } from "../lib/auth";

interface TicketAttachment {
  id: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
}

interface Ticket {
  id: string;
  number: string;
  userId: string;
  serviceId: string;
  detail: string;
  location: string | null;
  status: string;
  levelAssigned: string;
  createdAt: string;
  updatedAt: string;
  attachments: TicketAttachment[];
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  abierto:    { label: "Abierto",    color: "bg-blue-100 text-blue-800" },
  en_proceso: { label: "En proceso", color: "bg-amber-100 text-amber-800" },
  resuelto:   { label: "Resuelto",   color: "bg-green-100 text-green-800" },
  cerrado:    { label: "Cerrado",    color: "bg-gray-200 text-gray-700" },
};

const LEVEL_LABELS: Record<string, string> = {
  N1: "Nivel 1 — Básico",
  N2: "Nivel 2 — Profesional",
  N3: "Nivel 3 — DITIC",
  N4: "Nivel 4 — Especializado",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

function getRoleLevelLabel(role: string): string {
  const map: Record<string, string> = {
    tech_n1: "Nivel 1 — Soporte Básico",
    tech_n2: "Nivel 2 — Soporte Profesional",
    tech_n3: "Nivel 3 — DITIC",
    tech_n4: "Nivel 4 — Especializado",
    admin:   "Administrador — Todos los niveles",
  };
  return map[role] ?? "Tickets";
}

export default function BandejaTickets() {
  const user = getCurrentUser();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("todos");

  useEffect(() => {
    api
      .get<{ tickets: Ticket[] }>("/api/tickets")
      .then((r) => setTickets(r.data.tickets))
      .catch((err) => setError(extractApiError(err)))
      .finally(() => setLoading(false));
  }, []);

  const filteredTickets =
    filterStatus === "todos"
      ? tickets
      : tickets.filter((t) => t.status === filterStatus);

  const counts = {
    todos: tickets.length,
    abierto: tickets.filter((t) => t.status === "abierto").length,
    en_proceso: tickets.filter((t) => t.status === "en_proceso").length,
    resuelto: tickets.filter((t) => t.status === "resuelto").length,
    cerrado: tickets.filter((t) => t.status === "cerrado").length,
  };

  return (
    <Layout>
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-uta-900">Bandeja de Tickets</h1>
          <p className="mt-1 text-sm text-gray-600">
            {user && getRoleLevelLabel(user.role)}
          </p>
        </div>

        {/* Stats cards */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="card text-center">
            <p className="text-3xl font-bold text-uta-700">{counts.todos}</p>
            <p className="text-xs font-semibold text-gray-500">Total</p>
          </div>
          <div className="card text-center border-blue-200">
            <p className="text-3xl font-bold text-blue-600">{counts.abierto}</p>
            <p className="text-xs font-semibold text-gray-500">Abiertos</p>
          </div>
          <div className="card text-center border-amber-200">
            <p className="text-3xl font-bold text-amber-600">{counts.en_proceso}</p>
            <p className="text-xs font-semibold text-gray-500">En proceso</p>
          </div>
          <div className="card text-center border-green-200">
            <p className="text-3xl font-bold text-green-600">{counts.resuelto}</p>
            <p className="text-xs font-semibold text-gray-500">Resueltos</p>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap gap-2">
          {(["todos", "abierto", "en_proceso", "resuelto", "cerrado"] as const).map(
            (status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  filterStatus === status
                    ? "bg-uta-700 text-white shadow-sm"
                    : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                }`}
              >
                {status === "todos" ? "Todos" : STATUS_LABELS[status]?.label ?? status}{" "}
                <span className="ml-1 text-xs opacity-70">
                  ({counts[status as keyof typeof counts]})
                </span>
              </button>
            )
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-md border border-uta-300 bg-uta-100 px-4 py-3 text-sm font-medium text-uta-900">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600"></div>
            <p className="text-sm text-gray-500">Cargando tickets...</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && filteredTickets.length === 0 && (
          <div className="card py-12 text-center">
            <svg className="mx-auto mb-3 h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm font-medium text-gray-500">
              {filterStatus === "todos"
                ? "No hay tickets asignados a tu nivel."
                : `No hay tickets con estado "${STATUS_LABELS[filterStatus]?.label ?? filterStatus}".`}
            </p>
          </div>
        )}

        {/* Ticket list */}
        {!loading && filteredTickets.length > 0 && (
          <div className="space-y-3">
            {filteredTickets.map((ticket) => {
              const statusInfo = STATUS_LABELS[ticket.status] ?? {
                label: ticket.status,
                color: "bg-gray-100 text-gray-700",
              };
              return (
                <div
                  key={ticket.id}
                  className={`card cursor-pointer transition hover:shadow-md hover:border-uta-300 ${
                    selectedTicket?.id === ticket.id
                      ? "ring-2 ring-uta-500 border-uta-400"
                      : ""
                  }`}
                  onClick={() =>
                    setSelectedTicket(
                      selectedTicket?.id === ticket.id ? null : ticket
                    )
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-mono text-sm font-bold text-uta-900">
                          {ticket.number}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                        <span className="badge-level">
                          {ticket.levelAssigned}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 line-clamp-2">
                        {ticket.detail}
                      </p>
                      {ticket.location && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {ticket.location}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 text-right">
                      <p className="text-xs text-gray-400">
                        {timeAgo(ticket.createdAt)}
                      </p>
                      {ticket.attachments.length > 0 && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          {ticket.attachments.length}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Ticket detail expanded */}
                  {selectedTicket?.id === ticket.id && (
                    <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
                      <div className="grid gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase">Número</p>
                          <p className="font-mono font-medium text-gray-900">{ticket.number}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase">Nivel asignado</p>
                          <p className="font-medium text-gray-900">
                            {LEVEL_LABELS[ticket.levelAssigned] ?? ticket.levelAssigned}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase">Fecha de creación</p>
                          <p className="font-medium text-gray-900">
                            {new Date(ticket.createdAt).toLocaleDateString("es-EC", {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>

                      {ticket.location && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase">Ubicación</p>
                          <p className="mt-0.5 text-sm font-medium text-amber-800 flex items-center gap-1">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {ticket.location}
                          </p>
                        </div>
                      )}

                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase">Descripción completa</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                          {ticket.detail}
                        </p>
                      </div>

                      {ticket.attachments.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase mb-1">
                            Adjuntos ({ticket.attachments.length})
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {ticket.attachments.map((att) => (
                              <span
                                key={att.id}
                                className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs text-gray-600"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {att.filePath}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
