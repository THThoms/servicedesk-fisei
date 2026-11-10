// Modal compartido de historial de ticket. Lo consumen MisTickets (usuario),
// MisTicketsAceptados, PanelTecnicoV2 y AdminHistorial.
//
// El filtrado de eventos `internal` se hace en el backend cuando el caller es
// el solicitante. Aquí se mantiene un filtro defensivo extra por `audience`.
//
// HU-14: botón "Imprimir historial". Imprime desde un marco oculto, sin abrir ventanas,
// con encabezado institucional, datos del ticket y los eventos
// cronológicos. Se imprime EXACTAMENTE el mismo arreglo de eventos que se ve en
// pantalla, por lo que el solicitante nunca imprime eventos internos.

import { useEffect, useState } from "react";
import { api, extractApiError } from "../lib/api";
import { getResponsibleAreaLabel, getTechnicianNameLabel } from "../lib/technician";
import AuthenticatedImage from "./AuthenticatedImage";
import { printDocument, type DigitalValidationView } from "../lib/institutionalReport";

export type HistoryAudience = "requester" | "staff";

export interface TicketHistoryRef {
  id: string;
  number: string;
  serviceName?: string | null;
}

interface HistoryEvent {
  id: string;
  actionType: string;
  description: string;
  reason: string | null;
  workDone?: string | null;
  eventDescription?: string | null;
  previousArea?: string | null;
  newArea?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  visibility?: "public" | "internal";
  performedBy: { id: string; name: string };
  createdAt: string;
}

// Sprint I · P3 — attachments los devuelve el backend con imageUrl absoluta
// (Cloudinary) o relativa (/uploads/...).
interface Attachment {
  id: string;
  imageUrl: string | null;
  filePath: string | null;
  storageProvider: string;
  mimeType?: string | null;
  fileSize?: number | null;
}

// Metadatos del ticket que entrega GET /tickets/history/:id (extendido en HU-14).
interface TicketMeta {
  number?: string;
  userName?: string | null;
  serviceName?: string | null;
  responsibleArea?: string | null;
  status?: string | null;
  priority?: string | null;
  assignedTechnicianName?: string | null;
  acceptedAt?: string | null;
  resolvedAt?: string | null;
  resolvedByName?: string | null;
  resolutionSummary?: string | null;
  createdAt?: string | null;
  attachments?: Attachment[];
}

interface Props {
  ticket: TicketHistoryRef;
  audience: HistoryAudience;
  onClose: () => void;
}

const ACTION_BADGE: Record<string, string> = {
  CREATED: "bg-blue-100 text-blue-800",
  CATEGORIZED: "bg-indigo-100 text-indigo-800",
  AVAILABLE: "bg-sky-100 text-sky-800",
  ACCEPTED: "bg-green-100 text-green-800",
  ASSIGNED: "bg-cyan-100 text-cyan-800",
  CONTRIBUTED: "bg-amber-100 text-amber-800",
  STATUS_CHANGED: "bg-purple-100 text-purple-800",
  ESCALATED: "bg-orange-100 text-orange-800",
  REASSIGNED: "bg-yellow-100 text-yellow-800",
  COMMENTED: "bg-gray-100 text-gray-700",
  RESOLVED: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-slate-200 text-slate-800",
};

const STATUS_LABEL: Record<string, string> = {
  abierto: "Pendiente",
  en_proceso: "En Proceso",
  escalado: "Escalado",
  resuelto: "Resuelto",
  cerrado: "Cerrado",
};
const PRIORITY_LABEL: Record<string, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  critica: "Crítica",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Escapa texto para insertarlo de forma segura en el HTML del documento de impresión.
function esc(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Sprint L · P2 — el backend ahora serializa attachments con URLs que el
// navegador puede consumir:
//   · absoluta https://...      → Cloudinary público
//   · relativa /api/tickets/... → endpoint autenticado del gateway
// AuthenticatedImage decide cómo cargar cada una.
function attachmentSrc(a: Attachment): string | null {
  if (!a.imageUrl) return null;
  return a.imageUrl;
}

export default function TicketHistoryModal({ ticket, audience, onClose }: Props) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [meta, setMeta] = useState<TicketMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Sprint I · P3 — imagen ampliada (lightbox simple).
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Fase T — validación digital del usuario (constancias reales del backend).
  const [validation, setValidation] = useState<DigitalValidationView | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ validation: DigitalValidationView }>(`/api/tickets/${ticket.id}/acceptances`)
      .then((r) => !cancelled && setValidation(r.data.validation))
      .catch(() => !cancelled && setValidation(null));
    return () => {
      cancelled = true;
    };
  }, [ticket.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<{ ticket: TicketMeta; history: HistoryEvent[] }>(`/api/tickets/history/${ticket.id}`)
      .then((r) => {
        if (cancelled) return;
        const all = r.data.history ?? [];
        // Defensa en frontend: solicitantes solo ven eventos públicos.
        setEvents(
          audience === "requester" ? all.filter((e) => e.visibility !== "internal") : all
        );
        setMeta(r.data.ticket ?? null);
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
  }, [ticket.id, audience]);

  function buildPrintHtml(): string {
    const m = meta ?? {};
    const numero = esc(m.number ?? ticket.number);
    const servicio = esc(m.serviceName ?? ticket.serviceName ?? "—");
    const area = m.responsibleArea ? esc(getResponsibleAreaLabel(m.responsibleArea)) : "—";
    const estado = m.status ? esc(STATUS_LABEL[m.status] ?? m.status) : "—";
    const prioridad = m.priority ? esc(PRIORITY_LABEL[m.priority] ?? m.priority) : "—";
    const tecnico = m.assignedTechnicianName
      ? esc(getTechnicianNameLabel(m.assignedTechnicianName))
      : "—";
    const printedAt = new Date().toLocaleString("es-EC", {
      year: "numeric",
      month: "long",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const rows: Array<[string, string]> = [
      ["Número de ticket", numero],
      ["Solicitante", esc(m.userName ?? "—")],
      ["Servicio / categoría", servicio],
      ["Área responsable", area],
      ["Prioridad", prioridad],
      ["Estado actual", estado],
      ["Técnico asignado", tecnico],
      ["Fecha de creación", esc(formatDate(m.createdAt))],
      ["Fecha de aceptación", esc(formatDate(m.acceptedAt))],
      ["Fecha de resolución", esc(formatDate(m.resolvedAt))],
    ];
    if (m.resolvedByName) rows.push(["Resuelto por", esc(getTechnicianNameLabel(m.resolvedByName))]);
    if (m.resolutionSummary) rows.push(["Resumen de resolución", esc(m.resolutionSummary)]);

    const dataRows = rows
      .map(
        ([k, v]) =>
          `<tr><th>${k}</th><td>${v}</td></tr>`
      )
      .join("");

    const eventsHtml =
      events.length === 0
        ? `<p class="empty">No hay eventos registrados para este ticket.</p>`
        : events
            .map((e, i) => {
              const parts: string[] = [];
              parts.push(
                `<div class="ev-head"><span class="ev-action">${esc(e.actionType)}</span><span class="ev-date">${esc(
                  formatDate(e.createdAt)
                )}</span></div>`
              );
              parts.push(`<p class="ev-desc">${esc(e.description)}</p>`);
              parts.push(
                `<p class="ev-by">Responsable: <strong>${esc(
                  getTechnicianNameLabel(e.performedBy?.name)
                )}</strong></p>`
              );
              if (e.previousStatus && e.newStatus && e.previousStatus !== e.newStatus) {
                parts.push(
                  `<p class="ev-meta">Estado: ${esc(
                    STATUS_LABEL[e.previousStatus] ?? e.previousStatus
                  )} → ${esc(STATUS_LABEL[e.newStatus] ?? e.newStatus)}</p>`
                );
              }
              if (e.previousArea && e.newArea && e.previousArea !== e.newArea) {
                parts.push(
                  `<p class="ev-meta">Área: ${esc(getResponsibleAreaLabel(e.previousArea))} → ${esc(
                    getResponsibleAreaLabel(e.newArea)
                  )}</p>`
                );
              }
              if (e.reason) parts.push(`<p class="ev-meta">Motivo: ${esc(e.reason)}</p>`);
              if (e.workDone) parts.push(`<p class="ev-meta">Trabajo realizado: ${esc(e.workDone)}</p>`);
              if (e.eventDescription)
                parts.push(`<p class="ev-meta">${esc(e.eventDescription)}</p>`);
              return `<li class="event"><div class="ev-num">${i + 1}</div><div class="ev-body">${parts.join(
                ""
              )}</div></li>`;
            })
            .join("");

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Historial del Ticket ${numero}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 24px; font-size: 12px; }
  header.doc { border-bottom: 2px solid #1e3a8a; padding-bottom: 10px; margin-bottom: 16px; }
  .inst { font-size: 16px; font-weight: bold; color: #1e3a8a; }
  .sys { font-size: 12px; color: #444; }
  h1 { font-size: 18px; margin: 12px 0 4px; }
  .printed { font-size: 11px; color: #555; }
  table.meta { width: 100%; border-collapse: collapse; margin: 12px 0 20px; }
  table.meta th, table.meta td { text-align: left; padding: 4px 8px; border: 1px solid #ddd; vertical-align: top; }
  table.meta th { width: 220px; background: #f5f5f5; font-weight: 600; }
  h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  ul.events { list-style: none; padding: 0; margin: 0; }
  li.event { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid #eee; page-break-inside: avoid; }
  .ev-num { flex: 0 0 24px; height: 24px; width: 24px; border-radius: 50%; background: #1e3a8a; color: #fff; text-align: center; line-height: 24px; font-weight: bold; }
  .ev-body { flex: 1; }
  .ev-head { display: flex; justify-content: space-between; gap: 8px; }
  .ev-action { font-weight: bold; }
  .ev-date { color: #555; }
  .ev-desc { margin: 4px 0; }
  .ev-by { margin: 2px 0; color: #333; }
  .ev-meta { margin: 2px 0; color: #444; font-style: italic; }
  .empty { padding: 16px; text-align: center; color: #555; font-style: italic; }
  footer.doc { margin-top: 24px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 10px; color: #666; text-align: center; }
  @media print { body { margin: 0; } @page { margin: 16mm; } }
</style>
</head>
<body>
  <header class="doc">
    <div class="inst">Universidad Técnica de Ambato</div>
    <div class="sys">Sistema ServiceDesk / HelpDesk</div>
    <h1>Historial del Ticket</h1>
    <div class="printed">Fecha de impresión: ${esc(printedAt)}</div>
  </header>

  <table class="meta">${dataRows}</table>

  <h2>Eventos del ticket</h2>
  <ul class="events">${eventsHtml}</ul>

  <footer class="doc">
    Documento generado desde el sistema ServiceDesk / HelpDesk.<br/>
    Página impresa como evidencia de seguimiento de incidencia.
  </footer>
</body>
</html>`;
  }

  function printHistory() {
    if (!printDocument(buildPrintHtml())) {
      setError("No se pudo preparar la impresión. Recarga la página e inténtalo de nuevo.");
    }
  }

  const canPrint = !loading && !error;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-uta-900">Historial del ticket</h2>
            <p className="mt-1 text-xs text-gray-600">
              <span className="font-mono font-semibold">{ticket.number}</span>
              {ticket.serviceName ? <> · {ticket.serviceName}</> : null}
            </p>
          </div>
          <button
            type="button"
            onClick={printHistory}
            disabled={!canPrint}
            title="Abrir vista imprimible del historial"
            className="inline-flex items-center gap-1.5 rounded border border-uta-700 bg-white px-3 py-1.5 text-sm font-semibold text-uta-700 hover:bg-uta-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden>🖨</span> Imprimir historial
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="py-6 text-center text-sm text-gray-500">Cargando historial…</div>
          )}
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
          {/* Sprint L · P1 — Detalle rápido del ticket (número, servicio,
              solicitante, ubicación, prioridad, área, estado, técnico y
              fechas). Se muestra ANTES del historial para que quien reciba
              el ticket vea de inmediato la información completa sin tener
              que entrar al historial impreso. */}
          {!loading && !error && meta && (
            <div className="mb-5 rounded-md border border-gray-200 bg-gray-50 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Detalle del ticket
              </h3>
              <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
                {meta.number && (
                  <>
                    <dt className="font-semibold text-gray-600">Número</dt>
                    <dd className="font-mono text-gray-800">{meta.number}</dd>
                  </>
                )}
                {meta.serviceName && (
                  <>
                    <dt className="font-semibold text-gray-600">Servicio</dt>
                    <dd className="text-gray-800">{meta.serviceName}</dd>
                  </>
                )}
                {meta.userName && (
                  <>
                    <dt className="font-semibold text-gray-600">Solicitante</dt>
                    <dd className="text-gray-800">{meta.userName}</dd>
                  </>
                )}
                {meta.responsibleArea && (
                  <>
                    <dt className="font-semibold text-gray-600">Área</dt>
                    <dd className="text-gray-800">{getResponsibleAreaLabel(meta.responsibleArea)}</dd>
                  </>
                )}
                {meta.priority && (
                  <>
                    <dt className="font-semibold text-gray-600">Prioridad</dt>
                    <dd className="text-gray-800">{PRIORITY_LABEL[meta.priority] ?? meta.priority}</dd>
                  </>
                )}
                {meta.status && (
                  <>
                    <dt className="font-semibold text-gray-600">Estado</dt>
                    <dd className="text-gray-800">{STATUS_LABEL[meta.status] ?? meta.status}</dd>
                  </>
                )}
                {meta.assignedTechnicianName && (
                  <>
                    <dt className="font-semibold text-gray-600">Técnico asignado</dt>
                    <dd className="text-gray-800">{getTechnicianNameLabel(meta.assignedTechnicianName)}</dd>
                  </>
                )}
                {meta.createdAt && (
                  <>
                    <dt className="font-semibold text-gray-600">Creado</dt>
                    <dd className="text-gray-800">{formatDate(meta.createdAt)}</dd>
                  </>
                )}
                {meta.acceptedAt && (
                  <>
                    <dt className="font-semibold text-gray-600">Aceptado</dt>
                    <dd className="text-gray-800">{formatDate(meta.acceptedAt)}</dd>
                  </>
                )}
                {meta.resolvedAt && (
                  <>
                    <dt className="font-semibold text-gray-600">Resuelto</dt>
                    <dd className="text-gray-800">{formatDate(meta.resolvedAt)}</dd>
                  </>
                )}
                {meta.resolvedByName && (
                  <>
                    <dt className="font-semibold text-gray-600">Resuelto por</dt>
                    <dd className="text-gray-800">{getTechnicianNameLabel(meta.resolvedByName)}</dd>
                  </>
                )}
              </dl>
              {meta.resolutionSummary && (
                <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-900">
                  <span className="font-semibold">Resumen de resolución:</span>{" "}
                  {meta.resolutionSummary}
                </div>
              )}
            </div>
          )}

          {/* Fase T — Validación digital del usuario */}
          {!loading && !error && validation && validation.status !== "SIN_SOLUCION" && (
            <div className="mb-5 rounded border border-uta-300 bg-uta-50 p-3 text-xs" data-testid="digital-validation">
              <h3 className="mb-1 font-semibold uppercase tracking-wide text-uta-900">Validación digital del usuario</h3>
              <p className="font-bold text-uta-900">{validation.label}</p>
              {validation.record && (
                <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                  <div><dt className="inline text-gray-500">Usuario: </dt><dd className="inline">{validation.record.userName} ({validation.record.userEmail})</dd></div>
                  <div><dt className="inline text-gray-500">Código: </dt><dd className="inline font-mono">{validation.record.code}</dd></div>
                  <div><dt className="inline text-gray-500">Fecha y hora: </dt><dd className="inline">{formatDate(validation.record.decidedAt)}</dd></div>
                  <div><dt className="inline text-gray-500">Términos: </dt><dd className="inline">versión {validation.record.termsVersion}</dd></div>
                  {validation.record.reason && (
                    <div className="sm:col-span-2"><dt className="inline text-gray-500">Motivo del rechazo: </dt><dd className="inline">{validation.record.reason}</dd></div>
                  )}
                </dl>
              )}
              {validation.history.length > 1 && (
                <p className="mt-1 text-gray-600">Decisiones registradas: {validation.history.length} (el historial conserva todas).</p>
              )}
            </div>
          )}

          {/* Sprint I · P3 + Sprint L · P2 — Galería de attachments con
              AuthenticatedImage. Cada thumbnail carga vía fetch autenticado
              (JWT Bearer + blob URL) para los attachments locales; los
              Cloudinary usan directamente el CDN público. */}
          {!loading && !error && (meta?.attachments?.length ?? 0) > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Imágenes adjuntas ({meta?.attachments?.length})
              </h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {meta?.attachments?.map((a) => {
                  const url = attachmentSrc(a);
                  if (!url) return null;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setLightbox(url)}
                      className="group relative overflow-hidden rounded border border-gray-200 bg-gray-50 hover:border-uta-600"
                      title="Click para ampliar"
                    >
                      <AuthenticatedImage
                        src={url}
                        alt="Adjunto del ticket"
                        className="h-24 w-full object-cover transition group-hover:opacity-90"
                        placeholderClassName="h-24"
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!loading && !error && events.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-500">
              No hay eventos registrados para este ticket.
            </p>
          )}
          {!loading && !error && events.length > 0 && (
            <ol className="relative space-y-4 border-l-2 border-gray-200 pl-6">
              {events.map((e) => {
                const badge = ACTION_BADGE[e.actionType] ?? "bg-gray-100 text-gray-700";
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[33px] flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-uta-600 text-[10px] font-bold text-white">
                      ●
                    </span>
                    <div className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge}`}
                          >
                            {e.actionType}
                          </span>
                          {audience === "staff" && e.visibility === "internal" && (
                            <span className="inline-flex rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                              Interno
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">{formatDate(e.createdAt)}</span>
                      </div>
                      <p className="text-sm text-gray-800">{e.description}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        por <strong>{getTechnicianNameLabel(e.performedBy.name)}</strong>
                      </p>
                      {e.reason && (
                        <p className="mt-2 rounded bg-gray-50 px-2 py-1 text-xs italic text-gray-700">
                          Motivo: {e.reason}
                        </p>
                      )}
                      {e.workDone && (
                        <p className="mt-1 rounded bg-gray-50 px-2 py-1 text-xs italic text-gray-700">
                          Trabajo: {e.workDone}
                        </p>
                      )}
                      {e.eventDescription && (
                        <p className="mt-1 rounded bg-gray-50 px-2 py-1 text-xs text-gray-700">
                          {e.eventDescription}
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

      {/* Sprint I · P3 + Sprint L · P2 — lightbox overlay con carga autenticada */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-[92vw]">
            <AuthenticatedImage
              src={lightbox}
              alt="Adjunto ampliado"
              className="max-h-[90vh] max-w-[92vw] rounded shadow-2xl"
              placeholderClassName="h-64"
            />
          </div>
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute right-6 top-6 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-gray-800 hover:bg-white"
            aria-label="Cerrar imagen ampliada"
          >
            Cerrar ✕
          </button>
        </div>
      )}
    </div>
  );
}
