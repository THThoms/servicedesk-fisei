// Sprint 2 (rev) - Modal "Dar de alta / Resolver ticket".
// Dos modos mutuamente exclusivos:
//   - existingKnowledge: buscar en /api/knowledge/search y seleccionar uno.
//   - newKnowledge: rellenar el formulario que crea el artículo y resuelve.
// El backend nunca permite enviar resolvedById desde el cliente: lo toma del JWT.

import { useEffect, useMemo, useState } from "react";
import { api, extractApiError } from "../lib/api";
import { getResponsibleAreaLabel, ResponsibleAreaRef } from "../lib/technician";

export interface ResolveTicketRef {
  id: string;
  number: string;
  serviceId: string;
  serviceName: string | null;
  responsibleArea: ResponsibleAreaRef;
}

interface Props {
  ticket: ResolveTicketRef;
  onClose: () => void;
  onSuccess: () => void;
}

interface KnowledgeResult {
  id: string;
  title: string;
  problemDescription: string;
  solution: string;
  keywords: string[];
  service: { id: string; name: string } | null;
}

interface CatalogServiceItem {
  id: string;
  name: string;
  isActive: boolean;
}

type Mode = "existingKnowledge" | "newKnowledge";

export default function ResolveTicketModal({ ticket, onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<Mode>("existingKnowledge");

  // Estado de búsqueda en base de conocimiento
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<KnowledgeResult | null>(null);

  // Formulario para nueva solución
  const [title, setTitle] = useState("");
  const [problemDescription, setProblemDescription] = useState("");
  const [solution, setSolution] = useState("");
  const [keywordsRaw, setKeywordsRaw] = useState("");
  const [services, setServices] = useState<CatalogServiceItem[]>([]);
  const [newServiceId, setNewServiceId] = useState<string>(ticket.serviceId);

  // Compartidos
  const [finalNote, setFinalNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carga catálogo para el desplegable de servicio en modo nuevo.
  useEffect(() => {
    api
      .get<{ services: CatalogServiceItem[] }>("/api/catalog/services")
      .then((r) => setServices(r.data.services))
      .catch(() => {
        /* opcional: no bloquea el modal */
      });
  }, []);

  const newKeywords = useMemo(
    () =>
      keywordsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    [keywordsRaw]
  );

  const newKnowledgeInvalid =
    title.trim().length < 3 ||
    problemDescription.trim().length < 10 ||
    solution.trim().length < 10 ||
    newKeywords.length === 0;

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("Ingresa al menos 2 caracteres para buscar.");
      return;
    }
    setSearching(true);
    try {
      const r = await api.get<{ results: KnowledgeResult[] }>(
        `/api/knowledge/search?q=${encodeURIComponent(trimmed)}`
      );
      setResults(r.data.results);
    } catch (err) {
      setError(extractApiError(err));
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  async function submitResolve() {
    setError(null);
    if (mode === "existingKnowledge") {
      if (!selected) {
        setError("Selecciona una solución existente o cambia al modo 'Crear nueva'.");
        return;
      }
    } else {
      if (newKnowledgeInvalid) {
        setError("Completa título, descripción, solución y al menos una palabra clave.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const body =
        mode === "existingKnowledge"
          ? {
              mode,
              knowledgeArticleId: selected!.id,
              finalNote: finalNote.trim() || undefined,
            }
          : {
              mode,
              title: title.trim(),
              problemDescription: problemDescription.trim(),
              solution: solution.trim(),
              keywords: newKeywords,
              serviceId: newServiceId || undefined,
              finalNote: finalNote.trim() || undefined,
            };
      await api.post(`/api/tickets/${ticket.id}/resolve`, body);
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
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-bold text-uta-900">Resolver ticket</h2>
          <p className="mt-1 text-sm text-gray-600">
            <span className="font-mono font-semibold">{ticket.number}</span> ·{" "}
            {ticket.serviceName ?? "—"} · área {getResponsibleAreaLabel(ticket.responsibleArea)}
          </p>
        </div>

        {/* Selector de modo */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          <button
            type="button"
            className={`flex-1 px-4 py-3 text-sm font-semibold transition ${
              mode === "existingKnowledge"
                ? "border-b-2 border-uta-700 bg-white text-uta-900"
                : "text-gray-600 hover:bg-gray-100"
            }`}
            onClick={() => {
              setMode("existingKnowledge");
              setError(null);
            }}
            disabled={submitting}
          >
            Usar solución existente
          </button>
          <button
            type="button"
            className={`flex-1 px-4 py-3 text-sm font-semibold transition ${
              mode === "newKnowledge"
                ? "border-b-2 border-uta-700 bg-white text-uta-900"
                : "text-gray-600 hover:bg-gray-100"
            }`}
            onClick={() => {
              setMode("newKnowledge");
              setError(null);
            }}
            disabled={submitting}
          >
            Crear nueva solución
          </button>
        </div>

        {/* Cuerpo scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {mode === "existingKnowledge" ? (
            <>
              <form onSubmit={runSearch} className="mb-3 flex gap-2">
                <input
                  type="text"
                  className="input flex-1"
                  placeholder="Buscar por título, palabra clave, descripción o servicio"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={submitting}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={searching || submitting}
                  className="rounded bg-uta-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-uta-800 disabled:bg-gray-300"
                >
                  {searching ? "Buscando…" : "Buscar"}
                </button>
              </form>

              {results === null && (
                <p className="rounded border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                  Realiza una búsqueda para ver soluciones registradas.
                </p>
              )}
              {results && results.length === 0 && (
                <p className="rounded border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                  No se encontraron soluciones. Cambia el término o crea una nueva.
                </p>
              )}
              {results && results.length > 0 && (
                <ul className="space-y-2">
                  {results.map((r) => {
                    const isSelected = selected?.id === r.id;
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(r)}
                          disabled={submitting}
                          className={`w-full rounded border p-3 text-left transition ${
                            isSelected
                              ? "border-uta-700 bg-uta-50 ring-1 ring-uta-700"
                              : "border-gray-200 bg-white hover:border-uta-300"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <strong className="text-sm text-uta-900">{r.title}</strong>
                            {isSelected && (
                              <span className="rounded-full bg-uta-700 px-2 py-0.5 text-[10px] font-bold text-white">
                                Seleccionada
                              </span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                            {r.problemDescription}
                          </p>
                          {r.keywords.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {r.keywords.map((k) => (
                                <span
                                  key={k}
                                  className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
                                >
                                  {k}
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-4">
                <label htmlFor="final-note-existing" className="label">
                  Nota final (opcional)
                </label>
                <textarea
                  id="final-note-existing"
                  className="input min-h-[70px]"
                  placeholder="Ej: Se aplicó la solución y el servicio quedó funcionando."
                  value={finalNote}
                  onChange={(e) => setFinalNote(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="label">
                  Título de la solución <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={submitting}
                  autoFocus
                />
              </div>
              <div>
                <label className="label">
                  Descripción del problema <span className="text-red-600">*</span>
                </label>
                <textarea
                  className="input min-h-[80px]"
                  placeholder="¿Qué reportó el usuario?"
                  value={problemDescription}
                  onChange={(e) => setProblemDescription(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="label">
                  Solución aplicada <span className="text-red-600">*</span>
                </label>
                <textarea
                  className="input min-h-[80px]"
                  placeholder="¿Qué se hizo para resolverlo?"
                  value={solution}
                  onChange={(e) => setSolution(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="label">
                  Palabras clave <span className="text-red-600">*</span>{" "}
                  <span className="text-xs text-gray-500">(separadas por coma)</span>
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="wifi, red, conexion"
                  value={keywordsRaw}
                  onChange={(e) => setKeywordsRaw(e.target.value)}
                  disabled={submitting}
                />
                {newKeywords.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {newKeywords.map((k) => (
                      <span
                        key={k}
                        className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="label">Categoría / servicio relacionado</label>
                <select
                  className="input"
                  value={newServiceId}
                  onChange={(e) => setNewServiceId(e.target.value)}
                  disabled={submitting}
                >
                  <option value="">— Sin servicio —</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Nota final (opcional)</label>
                <textarea
                  className="input min-h-[60px]"
                  placeholder="Mensaje para el solicitante."
                  value={finalNote}
                  onChange={(e) => setFinalNote(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-6 py-3">
          <span className="text-xs text-gray-500">
            {mode === "existingKnowledge"
              ? selected
                ? `Resolverás con "${selected.title}"`
                : "Selecciona una solución para continuar"
              : "Se creará una nueva entrada en la base de conocimiento"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submitResolve}
              disabled={
                submitting ||
                (mode === "existingKnowledge" ? !selected : newKnowledgeInvalid)
              }
              className="rounded bg-green-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitting
                ? "Resolviendo…"
                : mode === "existingKnowledge"
                ? "Resolver ticket"
                : "Guardar solución y resolver"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
