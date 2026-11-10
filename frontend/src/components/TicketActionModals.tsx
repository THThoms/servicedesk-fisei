// Sprint 2 (rev) - Modales compartidos para acciones de ticket:
//   - ContributionModal: POST /api/tickets/:id/contributions
//   - EscalateV2Modal:   PUT  /api/tickets/:id/escalate
// Se extrajeron de PanelTecnicoV2 para reusarlos en MisTicketsAceptados.

import { useState } from "react";
import { api, extractApiError } from "../lib/api";
import { getResponsibleAreaLabel, ResponsibleAreaRef } from "../lib/technician";

export interface TicketActionRef {
  id: string;
  number: string;
  responsibleArea: ResponsibleAreaRef;
}

interface ModalProps {
  ticket: TicketActionRef;
  onClose: () => void;
  onSuccess: () => void;
}

export function ContributionModal({ ticket, onClose, onSuccess }: ModalProps) {
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "internal">("public");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = description.trim().length < 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) {
      setError("La aportación debe tener al menos 5 caracteres.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/tickets/${ticket.id}/contributions`, {
        description: description.trim(),
        visibility,
      });
      onSuccess();
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
        <form onSubmit={submit}>
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-bold text-uta-900">Agregar aportación</h2>
            <p className="mt-1 text-sm text-gray-600">
              Ticket <span className="font-mono font-semibold">{ticket.number}</span>
            </p>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div>
              <label htmlFor="contrib-desc" className="label">
                Descripción / avance
              </label>
              <textarea
                id="contrib-desc"
                className="input min-h-[120px]"
                placeholder="Ej: Se revisó el router del bloque B y se reinició el AP."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="contrib-vis" className="label">
                Visibilidad
              </label>
              <select
                id="contrib-vis"
                className="input"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as "public" | "internal")}
                disabled={submitting}
              >
                <option value="public">Pública — el usuario solicitante la verá</option>
                <option value="internal">Interna — solo técnicos / admin</option>
              </select>
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
              disabled={submitting || invalid}
              className="rounded bg-uta-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-uta-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitting ? "Guardando…" : "Guardar aportación"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EscalateV2Modal({ ticket, onClose, onSuccess }: ModalProps) {
  const [reason, setReason] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [targetArea, setTargetArea] = useState<ResponsibleAreaRef>(ticket.responsibleArea);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalid = reason.trim().length < 5 || workDone.trim().length < 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) {
      setError("Motivo y trabajo previo son obligatorios (mínimo 5 caracteres cada uno).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.put(`/api/tickets/${ticket.id}/escalate`, {
        reason: reason.trim(),
        workDone: workDone.trim(),
        targetArea,
        description: description.trim() || undefined,
      });
      onSuccess();
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
        <form onSubmit={submit}>
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-bold text-uta-900">Escalar ticket</h2>
            <p className="mt-1 text-sm text-gray-600">
              <span className="font-mono font-semibold">{ticket.number}</span> · área actual:{" "}
              {getResponsibleAreaLabel(ticket.responsibleArea)}
            </p>
          </div>
          <div className="space-y-3 px-6 py-5">
            <div>
              <label className="label">
                Motivo del escalamiento <span className="text-red-600">*</span>
              </label>
              <textarea
                className="input min-h-[80px]"
                placeholder="¿Por qué se debe escalar?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                autoFocus
              />
            </div>
            <div>
              <label className="label">
                ¿Qué se hizo antes de escalar? <span className="text-red-600">*</span>
              </label>
              <textarea
                className="input min-h-[80px]"
                placeholder="Trabajo previo realizado por el técnico."
                value={workDone}
                onChange={(e) => setWorkDone(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div>
              <label className="label">Área destino</label>
              <select
                className="input"
                value={targetArea}
                onChange={(e) => setTargetArea(e.target.value as ResponsibleAreaRef)}
                disabled={submitting}
              >
                <option value="TECHNICIANS">{getResponsibleAreaLabel("TECHNICIANS")}</option>
                <option value="DTIC">{getResponsibleAreaLabel("DTIC")}</option>
              </select>
            </div>
            <div>
              <label className="label">Descripción adicional (opcional)</label>
              <input
                type="text"
                className="input"
                placeholder="Notas para el área destino."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
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
              disabled={submitting || invalid}
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
