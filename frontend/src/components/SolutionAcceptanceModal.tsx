// Fase T — Revisión y aceptación digital de la solución por el solicitante.
//
// Muestra todo lo que el usuario debe revisar (problema, trabajo realizado,
// solución, imágenes con vista ampliada e historial), los términos vigentes y
// una casilla obligatoria. Después puede ACEPTAR (constancia + ticket cerrado)
// o RECHAZAR con motivo obligatorio (la casilla no sustituye al motivo).
// El backend vuelve a validarlo todo: este componente solo presenta.
import { useEffect, useState } from "react";
import { api, extractApiError } from "../lib/api";
import AuthenticatedImage from "./AuthenticatedImage";
import { getTechnicianNameLabel } from "../lib/technician";

interface Attachment {
  id: string;
  imageUrl: string | null;
}
interface HistoryEvent {
  id: string;
  actionType: string;
  description: string;
  reason: string | null;
  workDone?: string | null;
  eventDescription?: string | null;
  visibility?: string;
  performedBy: { id: string; name: string };
  createdAt: string;
}
interface TicketMeta {
  number?: string;
  serviceName?: string | null;
  detail?: string | null;
  location?: string | null;
  status?: string | null;
  assignedTechnicianName?: string | null;
  resolvedByName?: string | null;
  resolvedAt?: string | null;
  resolutionSummary?: string | null;
  createdAt?: string | null;
  attachments?: Attachment[];
}
interface Terms {
  version: string;
  title: string;
  text: string;
  available: boolean;
}
export interface AcceptanceResult {
  code: string;
  decision: "ACCEPTED" | "REJECTED";
  decidedAt: string;
}

interface Props {
  ticket: { id: string; number: string };
  onClose: () => void;
  onDecided: (r: AcceptanceResult) => void;
}

function fmt(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric", month: "long", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export default function SolutionAcceptanceModal({ ticket, onClose, onDecided }: Props) {
  const [meta, setMeta] = useState<TicketMeta | null>(null);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [mode, setMode] = useState<"review" | "reject">("review");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<{ ticket: TicketMeta; history: HistoryEvent[] }>(`/api/tickets/history/${ticket.id}`),
      api.get<Terms>("/api/tickets/acceptance-terms"),
    ])
      .then(([h, t]) => {
        if (cancelled) return;
        setMeta(h.data.ticket ?? null);
        setEvents((h.data.history ?? []).filter((e) => e.visibility !== "internal"));
        setTerms(t.data);
      })
      .catch((err) => !cancelled && setLoadError(extractApiError(err)));
    return () => {
      cancelled = true;
    };
  }, [ticket.id]);

  // Solución vigente = último evento RESOLVED; trabajo realizado = aportaciones públicas.
  const lastResolved = [...events].reverse().find((e) => e.actionType === "RESOLVED");
  const work = events.filter((e) => e.actionType === "CONTRIBUTED" && (e.eventDescription || e.workDone));

  async function decide(kind: "accept" | "reject") {
    if (!terms) return;
    if (!agreed) {
      setError("Debes marcar la casilla de aceptación de los términos.");
      return;
    }
    if (kind === "reject" && reason.trim().length < 5) {
      setError("Indica el motivo del rechazo (mínimo 5 caracteres).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body =
        kind === "accept"
          ? { termsAccepted: true, termsVersion: terms.version }
          : { termsAccepted: true, termsVersion: terms.version, reason: reason.trim() };
      const r = await api.post<{ acceptance: AcceptanceResult }>(
        `/api/tickets/${ticket.id}/${kind === "accept" ? "user-accept" : "user-reject"}`,
        body
      );
      onDecided(r.data.acceptance);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="sa-title">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="border-b-4 border-uta-700 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-uta-700">Validación de la solución</p>
          <h2 id="sa-title" className="text-lg font-bold text-uta-900">
            Ticket {ticket.number}
            {meta?.serviceName ? <span className="font-normal text-gray-600"> · {meta.serviceName}</span> : null}
          </h2>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {loadError && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800">{loadError}</div>}
          {!meta && !loadError && <p className="text-gray-500">Cargando…</p>}

          {meta && (
            <>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Descripción del problema</h3>
                <p className="mt-1 whitespace-pre-wrap text-gray-800">{meta.detail ?? "—"}</p>
                <p className="mt-1 text-xs text-gray-500">
                  Reportado el {fmt(meta.createdAt)}{meta.location ? ` · Ubicación: ${meta.location}` : ""}
                </p>
              </section>

              {work.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Trabajo realizado</h3>
                  <ul className="mt-1 space-y-1">
                    {work.map((e) => (
                      <li key={e.id} className="rounded bg-gray-50 px-2 py-1">
                        <span className="text-xs text-gray-500">{fmt(e.createdAt)} · {e.performedBy.name}: </span>
                        {e.eventDescription || e.workDone}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="rounded border border-emerald-200 bg-emerald-50 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Solución registrada por el técnico</h3>
                {lastResolved?.workDone && <p className="mt-1 font-semibold text-emerald-900">{lastResolved.workDone}</p>}
                {(lastResolved?.eventDescription || meta.resolutionSummary) && (
                  <p className="mt-1 whitespace-pre-wrap text-gray-800">{lastResolved?.eventDescription || meta.resolutionSummary}</p>
                )}
                <p className="mt-1 text-xs text-gray-600">
                  Técnico responsable: <strong>{getTechnicianNameLabel(meta.resolvedByName ?? meta.assignedTechnicianName ?? "—")}</strong>
                  {meta.resolvedAt ? ` · ${fmt(meta.resolvedAt)}` : ""}
                </p>
              </section>

              {(meta.attachments?.length ?? 0) > 0 && (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Imágenes adjuntas ({meta.attachments!.length}) · pulsa para ampliar
                  </h3>
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {meta.attachments!.map((a) =>
                      a.imageUrl ? (
                        <button key={a.id} type="button" onClick={() => setLightbox(a.imageUrl)} className="overflow-hidden rounded border border-gray-200 hover:border-uta-600" title="Ampliar">
                          <AuthenticatedImage src={a.imageUrl} alt="Adjunto del ticket" className="h-24 w-full object-cover" />
                        </button>
                      ) : null
                    )}
                  </div>
                </section>
              )}

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Historial</h3>
                <ol className="mt-1 space-y-1 border-l-2 border-uta-100 pl-3">
                  {events.map((e) => (
                    <li key={e.id} className="text-xs text-gray-700">
                      <span className="text-gray-500">{fmt(e.createdAt)}</span> · {e.description}
                      {e.reason ? <span className="text-gray-500"> — {e.reason}</span> : null}
                    </li>
                  ))}
                </ol>
              </section>

              {terms && (
                <section className="rounded border-2 border-uta-700 bg-uta-50 p-3">
                  <h3 className="text-sm font-bold text-uta-900">
                    {terms.title} <span className="text-xs font-normal text-uta-700">(versión {terms.version})</span>
                  </h3>
                  <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-white p-2 text-xs leading-relaxed text-gray-800" data-testid="acceptance-terms">
                    {terms.text}
                  </div>
                  <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm font-medium text-uta-900">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      data-testid="acceptance-checkbox"
                    />
                    He revisado la solución y acepto los términos de la constancia de aceptación digital (versión {terms.version}).
                  </label>
                  {!terms.available && (
                    <p className="mt-2 text-xs text-red-700">La aceptación digital no está disponible en este momento. Inténtalo más tarde.</p>
                  )}
                </section>
              )}

              {mode === "reject" && (
                <section>
                  <label htmlFor="sa-reason" className="block text-xs font-semibold text-gray-700">
                    Motivo del rechazo <span className="text-red-600">*</span> (obligatorio, mínimo 5 caracteres)
                  </label>
                  <textarea
                    id="sa-reason"
                    rows={3}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-uta-600 focus:outline-none"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explica qué sigue sin funcionar…"
                  />
                </section>
              )}

              {error && <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800" role="alert">{error}</div>}
            </>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cerrar
          </button>
          {mode === "review" ? (
            <>
              <button
                type="button"
                onClick={() => { setMode("reject"); setError(null); }}
                disabled={busy || !terms?.available}
                className="rounded border border-red-500 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Rechazar solución
              </button>
              <button
                type="button"
                onClick={() => decide("accept")}
                disabled={busy || !agreed || !terms?.available}
                className="rounded bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                data-testid="acceptance-accept"
              >
                {busy ? "Registrando…" : "Aceptar solución"}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setMode("review")} disabled={busy} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                Volver
              </button>
              <button
                type="button"
                onClick={() => decide("reject")}
                disabled={busy || !agreed}
                className="rounded bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "Registrando…" : "Confirmar rechazo"}
              </button>
            </>
          )}
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-[92vw]">
            <AuthenticatedImage src={lightbox} alt="Adjunto ampliado" className="max-h-[90vh] max-w-[92vw] rounded shadow-2xl" placeholderClassName="h-64" />
          </div>
          <button type="button" onClick={() => setLightbox(null)} className="absolute right-6 top-6 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-gray-800">
            Cerrar ✕
          </button>
        </div>
      )}
    </div>
  );
}
