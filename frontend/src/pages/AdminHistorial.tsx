// Sprint 2 (rev) - Historial general del administrador.
// Lista todos los tickets (incluye resueltos y cerrados) con filtros por
// estado, técnico, servicio, área, prioridad y rango de fechas. Consume
// GET /api/admin/tickets/history con paginación.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError, isCancelled } from "../lib/api";
import TicketHistoryModal from "../components/TicketHistoryModal";
import {
  getResponsibleAreaLabel,
  getTechnicianDisplayLabel,
  getTechnicianNameLabel,
  ResponsibleAreaRef,
} from "../lib/technician";

interface HistoryTicket {
  id: string;
  number: string;
  requesterName: string | null;
  requesterEmail: string | null;
  serviceName: string | null;
  serviceId: string;
  responsibleArea: ResponsibleAreaRef;
  location: string | null;
  priority: "baja" | "media" | "alta" | "critica";
  status: "abierto" | "en_proceso" | "escalado" | "resuelto" | "cerrado";
  assignmentStatus: string;
  assignedTechnicianId: string | null;
  assignedTechnicianName: string | null;
  acceptedAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolutionSummary: string | null;
  knowledgeArticleId: string | null;
  createdAt: string;
}

interface HistoryResponse {
  tickets: HistoryTicket[];
  total: number;
  page: number;
  limit: number;
}

interface Technician {
  id: string;
  name: string;
  email: string;
  role: string;
  areas: string[];
}

interface CatalogService {
  id: string;
  name: string;
}

const STATUS_BADGE: Record<HistoryTicket["status"], { label: string; classes: string }> = {
  abierto: { label: "Pendiente", classes: "bg-blue-100 text-blue-800" },
  en_proceso: { label: "En Proceso", classes: "bg-amber-100 text-amber-800" },
  escalado: { label: "Escalado", classes: "bg-purple-100 text-purple-800" },
  resuelto: { label: "Resuelto", classes: "bg-green-100 text-green-800" },
  cerrado: { label: "Cerrado", classes: "bg-gray-200 text-gray-700" },
};

const STATUSES: Array<HistoryTicket["status"]> = [
  "abierto",
  "en_proceso",
  "escalado",
  "resuelto",
  "cerrado",
];

// El label del técnico se delega a `getTechnicianDisplayLabel` para
// garantizar formato uniforme en todos los selects del sistema.
const PRIORITIES: Array<HistoryTicket["priority"]> = ["baja", "media", "alta", "critica"];
const AREAS: Array<HistoryTicket["responsibleArea"]> = ["TECHNICIANS", "DTIC"];

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

export default function AdminHistorial() {
  const [filters, setFilters] = useState({
    status: "",
    technicianId: "",
    serviceId: "",
    responsibleArea: "",
    priority: "",
    from: "",
    to: "",
  });
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [services, setServices] = useState<CatalogService[]>([]);
  const [historyTicket, setHistoryTicket] = useState<HistoryTicket | null>(null);

  // Carga catálogos para los selects (técnicos + servicios). Sprint E:
  // AbortController para no dejar fetches zombies al cambiar de vista rápido.
  useEffect(() => {
    const ctrl = new AbortController();
    api
      .get<{ technicians: Technician[] }>("/api/admin/technicians", { signal: ctrl.signal })
      .then((r) => setTechnicians(r.data.technicians))
      .catch((err) => {
        if (!isCancelled(err)) {
          /* opcional, no bloquea */
        }
      });
    api
      .get<{ services: CatalogService[] }>("/api/catalog/services?includeInactive=true", { signal: ctrl.signal })
      .then((r) => setServices(r.data.services))
      .catch((err) => {
        if (!isCancelled(err)) {
          /* opcional, no bloquea */
        }
      });
    return () => ctrl.abort();
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) {
        if (k === "from" || k === "to") {
          // Convertir datetime-local -> ISO 8601 con segundos para zod .datetime()
          const d = new Date(v);
          if (!isNaN(d.getTime())) params.set(k, d.toISOString());
        } else {
          params.set(k, v);
        }
      }
    });
    params.set("page", String(page));
    params.set("limit", String(limit));
    return params.toString();
  }, [filters, page, limit]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<HistoryResponse>(`/api/admin/tickets/history?${query}`, { signal });
      setData(r.data);
    } catch (err) {
      if (isCancelled(err)) return;
      setError(extractApiError(err));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  function updateFilter<K extends keyof typeof filters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters({
      status: "",
      technicianId: "",
      serviceId: "",
      responsibleArea: "",
      priority: "",
      from: "",
      to: "",
    });
    setPage(1);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <Layout>
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-uta-900">Historial general</h1>
          <p className="mt-1 text-sm text-gray-600">
            Auditoría de tickets — incluye resueltos y cerrados. Filtros opcionales.
          </p>
        </div>

        {/* Filtros */}
        <div className="card mb-4 grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          <Filter label="Estado">
            <select
              className="input"
              value={filters.status}
              onChange={(e) => updateFilter("status", e.target.value)}
            >
              <option value="">Todos</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_BADGE[s].label}
                </option>
              ))}
            </select>
          </Filter>

          <Filter label="Técnico">
            <select
              className="input"
              value={filters.technicianId}
              onChange={(e) => updateFilter("technicianId", e.target.value)}
            >
              <option value="">Todos</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {getTechnicianDisplayLabel(t, { includeEmail: false })}
                </option>
              ))}
            </select>
          </Filter>

          <Filter label="Servicio">
            <select
              className="input"
              value={filters.serviceId}
              onChange={(e) => updateFilter("serviceId", e.target.value)}
            >
              <option value="">Todos</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Filter>

          <Filter label="Área">
            <select
              className="input"
              value={filters.responsibleArea}
              onChange={(e) => updateFilter("responsibleArea", e.target.value)}
            >
              <option value="">Todas</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {getResponsibleAreaLabel(a)}
                </option>
              ))}
            </select>
          </Filter>

          <Filter label="Prioridad">
            <select
              className="input"
              value={filters.priority}
              onChange={(e) => updateFilter("priority", e.target.value)}
            >
              <option value="">Todas</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Filter>

          <Filter label="Desde">
            <input
              type="datetime-local"
              className="input"
              value={filters.from}
              onChange={(e) => updateFilter("from", e.target.value)}
            />
          </Filter>

          <Filter label="Hasta">
            <input
              type="datetime-local"
              className="input"
              value={filters.to}
              onChange={(e) => updateFilter("to", e.target.value)}
            />
          </Filter>

          <div className="flex items-end">
            <button
              type="button"
              onClick={clearFilters}
              className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Limpiar filtros
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600" />
            <p className="text-sm text-gray-500">Cargando historial…</p>
          </div>
        )}

        {!loading && data && data.tickets.length === 0 && (
          <div className="card py-12 text-center text-sm text-gray-500">
            Ningún ticket coincide con los filtros.
          </div>
        )}

        {!loading && data && data.tickets.length > 0 && (
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
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Técnico</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Creado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Resuelto</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">Historial</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {data.tickets.map((t) => {
                  const s = STATUS_BADGE[t.status] ?? { label: t.status, classes: "bg-gray-100 text-gray-700" };
                  return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-uta-900">{t.number}</td>
                      <td className="px-4 py-3 text-gray-700">{t.requesterName ? getTechnicianNameLabel(t.requesterName) : "—"}</td>
                      <td className="px-4 py-3 text-gray-700 truncate max-w-[160px]">{t.serviceName ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex rounded bg-uta-50 px-2 py-0.5 text-xs font-bold text-uta-900">
                          {getResponsibleAreaLabel(t.responsibleArea)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{t.priority}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${s.classes}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{t.assignedTechnicianName ? getTechnicianNameLabel(t.assignedTechnicianName) : "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{formatDate(t.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{formatDate(t.resolvedAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setHistoryTicket(t)}
                          className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          Ver historial
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {data && data.total > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>
              {data.total} ticket{data.total === 1 ? "" : "s"} · página {page} / {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-gray-300 bg-white px-3 py-1 disabled:opacity-50"
              >
                ← Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-gray-300 bg-white px-3 py-1 disabled:opacity-50"
              >
                Siguiente →
              </button>
            </div>
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

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
