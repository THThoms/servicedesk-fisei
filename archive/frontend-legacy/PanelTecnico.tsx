// HU-07 - Panel Técnico por niveles N1..N4.
// Consume GET /api/tickets/level. El backend impone el nivel real según el JWT;
// el frontend solo ofrece filtros visuales.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";
import { getCurrentUser, levelOfRole, Role } from "../lib/auth";

// HU-08: niveles escalables. N4 es final.
const NEXT_LEVEL: Record<string, string | null> = {
  N1: "N2",
  N2: "N3",
  N3: "N4",
  N4: null,
};

// ---------------------------------------------------------------------------
// Tipos y constantes
// ---------------------------------------------------------------------------
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
  // HU-07: el backend enriquece con name/email del solicitante y nombre del servicio.
  // Pueden ser null si el lookup a auth/catalog falla; el render cae a un fallback.
  userName: string | null;
  userEmail: string | null;
  serviceId: string;
  serviceName: string | null;
  detail: string;
  location: string | null;
  status: "abierto" | "en_proceso" | "escalado" | "resuelto" | "cerrado";
  priority: "baja" | "media" | "alta" | "critica";
  levelAssigned: "N1" | "N2" | "N3" | "N4";
  createdAt: string;
  updatedAt: string;
  attachments: TicketAttachment[];
}

interface LevelResponse {
  tickets: Ticket[];
  total: number;
  filters: {
    level: string;
    status: string | null;
    priority: string | null;
    search: string | null;
    page: number;
    limit: number;
  };
}

const STATUS_OPTIONS = [
  { value: "",          label: "Todos los estados" },
  { value: "pendiente", label: "Pendiente" },
  { value: "en_proceso",label: "En Proceso" },
  { value: "escalado",  label: "Escalado" },
  { value: "resuelto",  label: "Resuelto" },
  { value: "cerrado",   label: "Cerrado" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "",        label: "Todas las prioridades" },
  { value: "baja",    label: "Baja" },
  { value: "media",   label: "Media" },
  { value: "alta",    label: "Alta" },
  { value: "critica", label: "Crítica" },
] as const;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-EC", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function panelTitleFor(role: Role): string {
  const level = levelOfRole(role);
  if (level) return `Panel Técnico - Nivel ${level}`;
  if (role === "admin") return "Panel Técnico - Todos los niveles";
  return "Panel Técnico";
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
export default function PanelTecnico() {
  const user = getCurrentUser();
  const role = user?.role ?? "user";
  const isAdmin = role === "admin";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);  // mensaje de éxito tras escalar
  const [escalatingTicket, setEscalatingTicket] = useState<Ticket | null>(null);
  // HU-09: modal de historial.
  const [historyTicket, setHistoryTicket] = useState<Ticket | null>(null);
  // HU-09: modal de cambio de estado.
  const [statusTicket, setStatusTicket] = useState<Ticket | null>(null);

  // Filtros (controlados)
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [levelFilter, setLevelFilter] = useState<string>(""); // solo admin
  const [page, setPage] = useState(1);
  const limit = 20;

  // El JWT en el frontend solo se usa para pintar UI; el backend decide.
  const myLevel = useMemo(() => levelOfRole(role), [role]);

  // Carga inicial + refresh tras escalar.
  const loadTickets = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (priorityFilter) params.set("priority", priorityFilter);
    if (search.trim()) params.set("search", search.trim());
    if (isAdmin && levelFilter) params.set("level", levelFilter);
    params.set("page", String(page));
    params.set("limit", String(limit));

    api
      .get<LevelResponse>(`/api/tickets/level?${params.toString()}`)
      .then((r) => {
        if (cancelled) return;
        setTickets(r.data.tickets);
        setTotal(r.data.total);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [statusFilter, priorityFilter, search, levelFilter, page, isAdmin]);

  useEffect(() => {
    return loadTickets();
  }, [loadTickets]);

  // HU-08: callback que recibe el ticket recién escalado, muestra mensaje y refresca.
  function onEscalated(payload: { number: string; previousLevel: string; newLevel: string }) {
    setFlash(
      `Ticket ${payload.number} escalado de ${payload.previousLevel} a ${payload.newLevel} correctamente.`
    );
    setEscalatingTicket(null);
    loadTickets();
    window.setTimeout(() => setFlash(null), 6000);
  }

  // HU-09: callback tras cambiar estado.
  function onStatusChanged(payload: { number: string; previousStatus: string; newStatus: string }) {
    setFlash(
      `Ticket ${payload.number}: estado actualizado de ${payload.previousStatus} a ${payload.newStatus}.`
    );
    setStatusTicket(null);
    loadTickets();
    window.setTimeout(() => setFlash(null), 6000);
  }

  // Contadores resumen — calculados sobre la página actual.
  // Los totales reales por estado requerirían un endpoint aparte; el mockup
  // muestra contadores sobre lo visible.
  const counts = {
    pendientes: tickets.filter((t) => t.status === "abierto").length,
    enProceso:  tickets.filter((t) => t.status === "en_proceso").length,
    escalados:  tickets.filter((t) => t.status === "escalado").length,
    resueltos:  tickets.filter((t) => t.status === "resuelto").length,
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  // HU-07 - Empty state inteligente:
  //   - Con filtros activos -> "Sin resultados con esos filtros" + botón limpiar.
  //   - Sin filtros y técnico -> "No hay tickets asignados a tu nivel".
  //   - Sin filtros y admin   -> "No hay tickets en el sistema".
  const hasActiveFilters = Boolean(
    statusFilter || priorityFilter || search.trim() || (isAdmin && levelFilter)
  );

  function resetFilters() {
    setStatusFilter("");
    setPriorityFilter("");
    setSearch("");
    setLevelFilter("");
    setPage(1);
  }

  function onFilterChange<T extends string>(setter: (v: T) => void) {
    return (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
      setter(e.target.value as T);
      setPage(1);
    };
  }

  return (
    <Layout>
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-uta-900">{panelTitleFor(role)}</h1>
            <p className="mt-1 text-sm text-gray-600">
              {user?.name} · <span className="uppercase">{role}</span>
              {myLevel && <> · {total} ticket{total === 1 ? "" : "s"} en tu bandeja</>}
            </p>
          </div>
        </div>

        {/* Tarjetas resumen (página actual) */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard label="Pendientes"  value={counts.pendientes} color="text-blue-600"   border="border-blue-200" />
          <SummaryCard label="En Proceso"  value={counts.enProceso}  color="text-amber-600"  border="border-amber-200" />
          <SummaryCard label="Escalados"   value={counts.escalados}  color="text-purple-600" border="border-purple-200" />
          <SummaryCard label="Resueltos"   value={counts.resueltos}  color="text-green-600"  border="border-green-200" />
        </div>

        {/* Filtros */}
        <div className="card mb-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label" htmlFor="filter-status">Estado</label>
              <select
                id="filter-status"
                className="input"
                value={statusFilter}
                onChange={onFilterChange(setStatusFilter)}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="filter-priority">Prioridad</label>
              <select
                id="filter-priority"
                className="input"
                value={priorityFilter}
                onChange={onFilterChange(setPriorityFilter)}
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="filter-search">Buscar</label>
              <input
                id="filter-search"
                className="input"
                placeholder="Número o detalle…"
                value={search}
                onChange={onFilterChange(setSearch)}
              />
            </div>

            {isAdmin && (
              <div>
                <label className="label" htmlFor="filter-level">Nivel</label>
                <select
                  id="filter-level"
                  className="input"
                  value={levelFilter}
                  onChange={onFilterChange(setLevelFilter)}
                >
                  <option value="">Todos los niveles</option>
                  <option value="N1">N1</option>
                  <option value="N2">N2</option>
                  <option value="N3">N3</option>
                  <option value="N4">N4</option>
                </select>
              </div>
            )}
          </div>

          {(statusFilter || priorityFilter || search || (isAdmin && levelFilter)) && (
            <div className="mt-3 text-right">
              <button
                type="button"
                onClick={resetFilters}
                className="text-sm text-uta-700 hover:underline"
              >
                Limpiar filtros
              </button>
            </div>
          )}
        </div>

        {/* Flash de éxito (HU-08) */}
        {flash && (
          <div className="mb-4 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
            {flash}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600"></div>
            <p className="text-sm text-gray-500">Cargando tickets…</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && tickets.length === 0 && (
          <div className="card py-12 text-center">
            <svg className="mx-auto mb-3 h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            {hasActiveFilters ? (
              <>
                <p className="text-sm font-medium text-gray-600">
                  No hay tickets que coincidan con los filtros aplicados.
                </p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-3 inline-flex items-center rounded-md border border-uta-300 bg-white px-3 py-1.5 text-xs font-semibold text-uta-700 hover:bg-uta-50"
                >
                  Limpiar filtros
                </button>
              </>
            ) : isAdmin ? (
              <p className="text-sm font-medium text-gray-500">
                No hay tickets en el sistema todavía.
              </p>
            ) : (
              <p className="text-sm font-medium text-gray-500">
                No hay tickets asignados a tu nivel.
              </p>
            )}
          </div>
        )}

        {/* Tabla */}
        {!loading && !error && tickets.length > 0 && (
          <div className="card overflow-x-auto p-0">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Ticket</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Solicitante</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Servicio</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Prioridad</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Nivel</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Creado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {tickets.map((t) => (
                  <TicketRow
                    key={t.id}
                    ticket={t}
                    onEscalate={() => setEscalatingTicket(t)}
                    onViewHistory={() => setHistoryTicket(t)}
                    onChangeStatus={() => setStatusTicket(t)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal de escalamiento (HU-08) */}
        {escalatingTicket && (
          <EscalateModal
            ticket={escalatingTicket}
            onClose={() => setEscalatingTicket(null)}
            onSuccess={onEscalated}
          />
        )}

        {/* Modal de historial (HU-09) */}
        {historyTicket && (
          <HistoryModal
            ticket={historyTicket}
            onClose={() => setHistoryTicket(null)}
          />
        )}

        {/* Modal de cambio de estado (HU-09) */}
        {statusTicket && (
          <StatusChangeModal
            ticket={statusTicket}
            onClose={() => setStatusTicket(null)}
            onSuccess={onStatusChanged}
          />
        )}

        {/* Paginación */}
        {!loading && total > limit && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>
              Página {page} de {totalPages} · {total} tickets en total
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------
function SummaryCard({
  label, value, color, border,
}: { label: string; value: number; color: string; border: string }) {
  return (
    <div className={`card text-center ${border}`}>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
      <p className="text-xs font-semibold text-gray-500">{label}</p>
    </div>
  );
}

function TicketRow({
  ticket,
  onEscalate,
  onViewHistory,
  onChangeStatus,
}: {
  ticket: Ticket;
  onEscalate: () => void;
  onViewHistory: () => void;
  onChangeStatus: () => void;
}) {
  const s = STATUS_BADGE[ticket.status] ?? { label: ticket.status, classes: "bg-gray-100 text-gray-700" };
  const p = PRIORITY_BADGE[ticket.priority] ?? { label: ticket.priority, classes: "bg-gray-100 text-gray-700" };
  const solicitanteLabel = ticket.userName ?? `usuario ${ticket.userId.slice(0, 8)}…`;
  const solicitanteTitle = ticket.userEmail
    ? `${ticket.userName ?? ticket.userId} · ${ticket.userEmail}`
    : ticket.userId;
  const servicioLabel = ticket.serviceName ?? "—";

  // HU-08: el ticket sólo se puede escalar si no está en N4 ni en estado terminal.
  const isTerminal = ticket.status === "resuelto" || ticket.status === "cerrado";
  const canEscalate = NEXT_LEVEL[ticket.levelAssigned] !== null && !isTerminal;
  const escalateTitle = isTerminal
    ? `No se puede escalar un ticket ${ticket.status}`
    : NEXT_LEVEL[ticket.levelAssigned] === null
    ? "Ya está en N4 (nivel final)"
    : `Escalar a ${NEXT_LEVEL[ticket.levelAssigned]}`;

  return (
    <tr className="hover:bg-gray-50">
      <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-uta-900">{ticket.number}</td>
      <td className="px-4 py-3 text-gray-700 truncate max-w-[200px]" title={solicitanteTitle}>
        <div className="flex flex-col leading-tight">
          <span className="font-medium">{solicitanteLabel}</span>
          {ticket.userEmail && (
            <span className="text-xs text-gray-500">{ticket.userEmail}</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-gray-700 truncate max-w-[220px]" title={servicioLabel}>
        {servicioLabel}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${p.classes}`}>
          {p.label}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.classes}`}>
          {s.label}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <span className="inline-flex rounded bg-uta-50 px-2 py-0.5 text-xs font-bold text-uta-900">
          {ticket.levelAssigned}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
        {formatDate(ticket.createdAt)}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onViewHistory}
            className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            title="Ver historial del ticket"
          >
            Historial
          </button>
          <button
            type="button"
            onClick={onChangeStatus}
            disabled={isTerminal}
            title={isTerminal ? "Ticket en estado terminal" : "Cambiar estado"}
            className="rounded border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200"
          >
            Estado
          </button>
          <button
            type="button"
            onClick={onEscalate}
            disabled={!canEscalate}
            title={escalateTitle}
            className="rounded bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            Escalar
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// HU-08 - Modal de escalamiento
// ---------------------------------------------------------------------------
function EscalateModal({
  ticket,
  onClose,
  onSuccess,
}: {
  ticket: Ticket;
  onClose: () => void;
  onSuccess: (payload: { number: string; previousLevel: string; newLevel: string }) => void;
}) {
  const nextLevel = NEXT_LEVEL[ticket.levelAssigned];
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = reason.trim();
  const reasonInvalid = trimmed.length < 5;

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (reasonInvalid) {
      setError("El motivo del escalamiento es obligatorio (mínimo 5 caracteres).");
      return;
    }
    setSubmitting(true);
    try {
      await api.put("/api/tickets/escalate", {
        ticketId: ticket.id,
        reason: trimmed,
      });
      onSuccess({
        number: ticket.number,
        previousLevel: ticket.levelAssigned,
        newLevel: nextLevel ?? "?",
      });
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="escalate-title"
    >
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <form onSubmit={handleConfirm}>
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 id="escalate-title" className="text-lg font-bold text-uta-900">
              Escalar Ticket
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Ticket <span className="font-mono font-semibold">{ticket.number}</span>:
              {" "}{ticket.levelAssigned} → <span className="font-bold text-amber-700">{nextLevel}</span>
            </p>
          </div>

          <div className="space-y-4 px-6 py-5">
            <div>
              <label htmlFor="escalate-reason" className="label">
                Motivo del escalamiento <span className="text-red-600">*</span>
              </label>
              <textarea
                id="escalate-reason"
                className="input min-h-[120px]"
                placeholder="Describe por qué se requiere escalar este ticket…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                autoFocus
              />
              {reasonInvalid && reason.length > 0 && (
                <p className="mt-1 text-xs text-red-600">
                  El motivo del escalamiento es obligatorio (mínimo 5 caracteres).
                </p>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || reasonInvalid}
              className="rounded bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitting ? "Escalando…" : "Confirmar escalamiento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HU-09 - Modal de historial (timeline vertical)
// ---------------------------------------------------------------------------
interface HistoryEvent {
  id: string;
  actionType: "CREATED" | "ESCALATED" | "STATUS_CHANGED" | "ASSIGNED" | "COMMENTED" | "CLOSED";
  description: string;
  previousStatus: string | null;
  newStatus: string | null;
  previousLevel: string | null;
  newLevel: string | null;
  reason: string | null;
  performedBy: { id: string; name: string };
  createdAt: string;
}

interface HistoryResponse {
  ticketId: string;
  ticket: {
    id: string;
    number: string;
    serviceId: string;
    status: string;
    priority: string;
    levelAssigned: string;
    createdAt: string;
  };
  history: HistoryEvent[];
}

const ACTION_LABEL: Record<HistoryEvent["actionType"], { label: string; classes: string }> = {
  CREATED:        { label: "Creación",          classes: "bg-blue-100 text-blue-800" },
  ESCALATED:      { label: "Escalamiento",      classes: "bg-amber-100 text-amber-800" },
  STATUS_CHANGED: { label: "Cambio de estado",  classes: "bg-purple-100 text-purple-800" },
  ASSIGNED:       { label: "Asignación",        classes: "bg-cyan-100 text-cyan-800" },
  COMMENTED:      { label: "Comentario",        classes: "bg-gray-100 text-gray-800" },
  CLOSED:         { label: "Cierre",            classes: "bg-green-100 text-green-800" },
};

function HistoryModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<HistoryResponse>(`/api/tickets/history/${ticket.id}`)
      .then((r) => {
        if (!cancelled) setData(r.data);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 id="history-title" className="text-lg font-bold text-uta-900">
            Historial del Ticket
          </h2>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-600">
            <span className="font-mono font-semibold">{ticket.number}</span>
            <span>·</span>
            <span>{ticket.serviceName ?? "—"}</span>
            <span>·</span>
            <span>Estado: <strong>{STATUS_BADGE[ticket.status]?.label ?? ticket.status}</strong></span>
            <span>·</span>
            <span>Prioridad: <strong>{PRIORITY_BADGE[ticket.priority]?.label ?? ticket.priority}</strong></span>
            <span>·</span>
            <span>Nivel: <strong>{ticket.levelAssigned}</strong></span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="py-12 text-center text-sm text-gray-500">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600" />
              Cargando historial…
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          {!loading && !error && data && data.history.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500">
              No hay acciones registradas para este ticket.
            </p>
          )}

          {!loading && !error && data && data.history.length > 0 && (
            <ol className="relative space-y-5 border-l-2 border-gray-200 pl-6">
              {data.history.map((e) => {
                const meta = ACTION_LABEL[e.actionType] ?? { label: e.actionType, classes: "bg-gray-100 text-gray-700" };
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[33px] flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-uta-600 text-[10px] font-bold text-white">
                      ●
                    </span>
                    <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.classes}`}>
                          {meta.label}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(e.createdAt).toLocaleString("es-EC", {
                            year: "numeric", month: "short", day: "2-digit",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800">{e.description}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Responsable: <strong>{e.performedBy.name}</strong>
                      </p>
                      {(e.previousLevel || e.newLevel) && (
                        <p className="mt-1 text-xs text-gray-500">
                          Nivel: <strong>{e.previousLevel ?? "—"}</strong> → <strong>{e.newLevel ?? "—"}</strong>
                        </p>
                      )}
                      {(e.previousStatus || e.newStatus) && (
                        <p className="mt-1 text-xs text-gray-500">
                          Estado: <strong>{STATUS_BADGE[(e.previousStatus ?? "") as Ticket["status"]]?.label ?? e.previousStatus ?? "—"}</strong>
                          {" → "}
                          <strong>{STATUS_BADGE[(e.newStatus ?? "") as Ticket["status"]]?.label ?? e.newStatus ?? "—"}</strong>
                        </p>
                      )}
                      {e.reason && (
                        <p className="mt-2 rounded bg-gray-50 px-2 py-1 text-xs italic text-gray-700">
                          "{e.reason}"
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="flex justify-end border-t border-gray-200 bg-gray-50 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HU-09 - Modal de cambio de estado (necesario para AC2)
// ---------------------------------------------------------------------------
const STATUS_TRANSITIONS = [
  { value: "abierto",    label: "Pendiente" },
  { value: "en_proceso", label: "En Proceso" },
  { value: "resuelto",   label: "Resuelto" },
  { value: "cerrado",    label: "Cerrado" },
] as const;

function StatusChangeModal({
  ticket,
  onClose,
  onSuccess,
}: {
  ticket: Ticket;
  onClose: () => void;
  onSuccess: (payload: { number: string; previousStatus: string; newStatus: string }) => void;
}) {
  const [status, setStatus] = useState<Ticket["status"]>(ticket.status);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noChange = status === ticket.status;

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (noChange) {
      setError("Selecciona un estado distinto al actual.");
      return;
    }
    setSubmitting(true);
    try {
      await api.patch(`/api/tickets/${ticket.id}/status`, {
        status,
        ...(comment.trim().length >= 3 ? { comment: comment.trim() } : {}),
      });
      onSuccess({
        number: ticket.number,
        previousStatus: STATUS_BADGE[ticket.status]?.label ?? ticket.status,
        newStatus: STATUS_BADGE[status]?.label ?? status,
      });
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <form onSubmit={handleConfirm}>
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-bold text-uta-900">Cambiar estado</h2>
            <p className="mt-1 text-sm text-gray-600">
              Ticket <span className="font-mono font-semibold">{ticket.number}</span>:
              {" "}{STATUS_BADGE[ticket.status]?.label ?? ticket.status} → <strong>{STATUS_BADGE[status]?.label ?? status}</strong>
            </p>
          </div>

          <div className="space-y-4 px-6 py-5">
            <div>
              <label htmlFor="new-status" className="label">Nuevo estado</label>
              <select
                id="new-status"
                className="input"
                value={status}
                onChange={(e) => setStatus(e.target.value as Ticket["status"])}
                disabled={submitting}
              >
                {STATUS_TRANSITIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="status-comment" className="label">
                Comentario <span className="text-xs font-normal text-gray-500">(opcional, mín 3 caracteres)</span>
              </label>
              <textarea
                id="status-comment"
                className="input min-h-[80px]"
                placeholder="Notas sobre el cambio…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || noChange}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitting ? "Guardando…" : "Confirmar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
