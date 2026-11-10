// Sprint 2 (rev) - Vista "Mis Tickets" para el usuario solicitante.
// Lista los tickets que él creó, muestra estado de aceptación y permite ver
// el historial público de cada uno.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";
import TicketHistoryModal from "../components/TicketHistoryModal";
import SolutionAcceptanceModal, { type AcceptanceResult } from "../components/SolutionAcceptanceModal";
import { getResponsibleAreaLabel, getTechnicianNameLabel, ResponsibleAreaRef } from "../lib/technician";

interface Ticket {
  id: string;
  number: string;
  serviceName: string | null;
  detail: string;
  // Sprint I · P4 — nuevo status "pendiente_validacion" que le pide al
  // solicitante aceptar o rechazar la solución del técnico antes de cerrar.
  status: "abierto" | "en_proceso" | "escalado" | "pendiente_validacion" | "resuelto" | "cerrado";
  priority: "baja" | "media" | "alta" | "critica";
  responsibleArea: ResponsibleAreaRef;
  assignmentStatus: "unassigned" | "available" | "accepted" | "assigned_by_admin";
  assignedTechnicianId: string | null;
  assignedTechnicianName: string | null;
  acceptedAt: string | null;
  createdAt: string;
  resolvedByName?: string | null;
  resolutionSummary?: string | null;
}

interface MyResponse {
  tickets: Ticket[];
  total: number;
}

const STATUS_LABEL: Record<Ticket["status"], { label: string; classes: string }> = {
  abierto:                { label: "Pendiente",             classes: "bg-blue-100 text-blue-800" },
  en_proceso:             { label: "En Proceso",            classes: "bg-amber-100 text-amber-800" },
  escalado:               { label: "Escalado",              classes: "bg-purple-100 text-purple-800" },
  // Sprint I · P4
  pendiente_validacion:   { label: "Pendiente validación",  classes: "bg-fuchsia-100 text-fuchsia-800" },
  resuelto:               { label: "Resuelto",              classes: "bg-green-100 text-green-800" },
  cerrado:                { label: "Cerrado",               classes: "bg-gray-200 text-gray-700" },
};

function assignmentMessage(t: Ticket): { text: string; tone: "wait" | "ok" } {
  if (!t.assignedTechnicianId) {
    return { text: "Pendiente de aceptación por un técnico", tone: "wait" };
  }
  const verb = t.assignmentStatus === "assigned_by_admin" ? "asignado por admin a" : "aceptado por";
  return {
    text: `Ticket ${verb} ${getTechnicianNameLabel(t.assignedTechnicianName)}`,
    tone: "ok",
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MisTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyTicket, setHistoryTicket] = useState<Ticket | null>(null);
  // Sprint I · P4 — modal de rechazo de solución (motivo obligatorio).
  // Fase T: revisión completa + constancia de aceptación digital (aceptar o rechazar).
  const [reviewTicket, setReviewTicket] = useState<Ticket | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationFlash, setValidationFlash] = useState<string | null>(null);

  function onDecided(r: AcceptanceResult) {
    const tk = reviewTicket;
    setReviewTicket(null);
    setValidationError(null);
    const when = new Date(r.decidedAt).toLocaleString("es-EC");
    setValidationFlash(
      r.decision === "ACCEPTED"
        ? `Ticket ${tk?.number ?? ""} cerrado. Constancia de aceptación digital ${r.code} (${when}).`
        : `Ticket ${tk?.number ?? ""} vuelve a proceso; el técnico fue notificado. Constancia de rechazo ${r.code} (${when}).`
    );
    load();
  }

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<MyResponse>("/api/tickets/my")
      .then((r) => {
        if (!cancelled) setTickets(r.data.tickets);
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
  }, []);

  useEffect(() => load(), [load]);

  // Sprint 4+ · Deep-link `?openTicket=<id>` desde una notificación push:
  // busca el ticket en la lista cargada y abre el modal de historial.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (loading) return;
    const wanted =
      searchParams.get("openTicket") ??
      (sessionStorage.getItem("sd_open_ticket") || null);
    if (!wanted) return;
    const found = tickets.find((t) => t.id.toLowerCase() === wanted.toLowerCase());
    if (found) {
      setHistoryTicket(found);
      sessionStorage.removeItem("sd_open_ticket");
      if (searchParams.get("openTicket")) {
        const next = new URLSearchParams(searchParams);
        next.delete("openTicket");
        setSearchParams(next, { replace: true });
      }
    }
  }, [loading, tickets, searchParams, setSearchParams]);

  return (
    <Layout>
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-uta-900">Mis Tickets</h1>
          <p className="mt-1 text-sm text-gray-600">
            Historial de incidencias que has reportado.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600" />
            <p className="text-sm text-gray-500">Cargando tus tickets…</p>
          </div>
        )}

        {!loading && !error && tickets.length === 0 && (
          <div className="card py-12 text-center text-sm text-gray-500">
            Todavía no has creado tickets.
          </div>
        )}

        {!loading && tickets.length > 0 && (
          <div className="space-y-3">
            {tickets.map((t) => {
              const status = STATUS_LABEL[t.status] ?? { label: t.status, classes: "bg-gray-100 text-gray-700" };
              const assign = assignmentMessage(t);
              return (
                <div key={t.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-bold text-uta-900">{t.number}</span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${status.classes}`}>
                          {status.label}
                        </span>
                        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700">
                          {getResponsibleAreaLabel(t.responsibleArea)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 line-clamp-2">{t.detail}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {t.serviceName ?? "—"} · creado el {formatDate(t.createdAt)}
                      </p>
                      <p className={`mt-2 text-xs font-medium ${assign.tone === "ok" ? "text-green-700" : "text-amber-700"}`}>
                        {assign.text}
                      </p>

                      {/* Sprint I · P4 — Panel de validación de la solución. */}
                      {t.status === "pendiente_validacion" && (
                        <div className="mt-3 rounded border border-fuchsia-200 bg-fuchsia-50 p-3">
                          <p className="text-xs font-semibold text-fuchsia-900">
                            El técnico propuso una solución. Por favor valídala.
                          </p>
                          {t.resolutionSummary && (
                            <p className="mt-1 text-xs text-gray-700 whitespace-pre-wrap">
                              <span className="font-semibold">Resumen:</span> {t.resolutionSummary}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setReviewTicket(t);
                                setValidationError(null);
                                setValidationFlash(null);
                              }}
                              className="rounded bg-uta-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-uta-900"
                              data-testid="review-solution"
                            >
                              Revisar y validar la solución
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setHistoryTicket(t)}
                      className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Ver historial
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {validationFlash && (
          <div className="mt-4 rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800">
            {validationFlash}
          </div>
        )}
        {validationError && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
            {validationError}
          </div>
        )}

        {reviewTicket && (
          <SolutionAcceptanceModal
            ticket={{ id: reviewTicket.id, number: reviewTicket.number }}
            onClose={() => setReviewTicket(null)}
            onDecided={onDecided}
          />
        )}

        {historyTicket && (
          <TicketHistoryModal
            ticket={{
              id: historyTicket.id,
              number: historyTicket.number,
              serviceName: historyTicket.serviceName,
            }}
            audience="requester"
            onClose={() => setHistoryTicket(null)}
          />
        )}
      </div>
    </Layout>
  );
}
